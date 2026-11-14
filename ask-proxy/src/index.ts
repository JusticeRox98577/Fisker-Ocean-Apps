/**
 * Ocean Live "Any questions?" proxy.
 *
 * The apps send a question here; this Worker holds the Anthropic API key, applies per-device
 * and per-network daily limits and a monthly spend cap, and asks Claude with the Fisker Ocean
 * knowledge guide as a cached system prompt. Fault codes are looked up on demand from KV
 * (see scripts/build-dtc-kv.mjs) so the big table never goes into the prompt.
 *
 * Research log: every answered question is saved to D1 (table `questions`, see migrations/) with
 * the conversation, the answer, the car readings sent with it, the install ID, the phone's
 * language and the cost. A daily cron deletes entries older than LOG_RETENTION_DAYS (90).
 * Owners are told in the app and in PRIVACY.md. IP addresses are never logged.
 */
import Anthropic from "@anthropic-ai/sdk";
import guide from "../knowledge/ocean-guide.md";

export interface Env {
  ANTHROPIC_API_KEY: string;
  /** Random string used to hash IP addresses for the per-network limit. */
  IP_SALT?: string;
  ASK_KV: KVNamespace;
  MONTHLY_CAP_USD?: string;
  DEVICE_DAILY_LIMIT?: string;
  IP_DAILY_LIMIT?: string;
  /** Research log. Without the binding nothing is logged. */
  LOG_DB?: D1Database;
  LOG_RETENTION_DAYS?: string;
}

const MODEL = "claude-opus-5-5";
// Claude Opus 5.5 list prices in US dollars per million tokens.
const PRICE = { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 };

const MAX_TURNS = 12;
const MAX_TEXT = 2000;
const MAX_CAR = 4000;
const MAX_CODES = 40;
const MAX_TOOL_ROUNDS = 3;

const SYSTEM_INSTRUCTIONS = `You are the "Any questions?" helper inside Ocean Live, an independent owner-made app for the Fisker Ocean electric SUV. You answer owners' questions about their Fisker Ocean and about the Ocean Live app.

How to answer:
- Answer in the language the owner writes in.
- Be practical and short: a few sentences or a short list. Plain text only, no Markdown headings or tables; simple "- " bullets are fine.
- Use the knowledge guide below and the lookup_fault_codes tool. For any specific fault code, call the tool before explaining it.
- When the owner's message includes readings from their car, use them, and say what they suggest. The readings are a snapshot taken by the app; they may be old.
- If you are not sure, or the guide does not cover it, say so plainly. Never invent specifications, part numbers, prices or procedures.
- Safety first: high-voltage, airbag, brake and steering problems go to a qualified EV shop. Never tell the owner to open high-voltage parts, bypass safety systems or use security access.
- Ocean Live can only read the car and, when asked, clear codes or restart a module while parked. It cannot change settings, update software or unlock features. Don't suggest it can.
- Fisker Inc. is bankrupt; don't send owners to Fisker. Point them to owner groups, independent shops and official recall lookups instead.
- You are not affiliated with Fisker. Don't claim to be a Fisker service.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "lookup_fault_codes",
    description:
      "Looks up Fisker Ocean diagnostic trouble codes (DTCs) such as B208896 or U199701 in the owner-collected service table. Returns, for each code, its name, the module (ECU) that reports it, a severity and a suggested fix when known, or null when the code is not in the table. Call it for every specific code you explain, with all codes in one call.",
    input_schema: {
      type: "object",
      properties: {
        codes: {
          type: "array",
          items: { type: "string", description: "A 7-character code like B208896, or a 5-character base code like P0A80." },
          description: "The codes to look up, at most 40.",
        },
      },
      required: ["codes"],
      additionalProperties: false,
    },
    strict: true,
  },
];

// Same bytes every request, so the tools + system prefix is cached.
const SYSTEM: Anthropic.Beta.BetaTextBlockParam[] = [
  { type: "text", text: SYSTEM_INSTRUCTIONS },
  { type: "text", text: `<knowledge_guide>\n${guide}\n</knowledge_guide>`, cache_control: { type: "ephemeral" } },
];

interface Turn {
  role: "user" | "assistant";
  text: string;
}

interface AskBody {
  device: string;
  messages: Turn[];
  car?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/ask") return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method" }, 405);

    let body: AskBody;
    try {
      body = validate(await request.json());
    } catch {
      return json({ error: "bad_request" }, 400);
    }

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const deviceKey = `d:${body.device}:${day}`;
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const ipKey = `ip:${await sha256(`${env.IP_SALT ?? ""}|${ip}`)}:${day}`;
    const spendKey = `spend:${month}`;

    const capMicros = Math.round(numVar(env.MONTHLY_CAP_USD, 10) * 1_000_000);

    const [deviceCount, ipCount, spent, override] = await Promise.all([
      readInt(env.ASK_KV, deviceKey),
      readInt(env.ASK_KV, ipKey),
      readInt(env.ASK_KV, spendKey),
      // Per-device daily limit set by hand: `limit:<install ID>` = a number (0 blocks the device).
      env.ASK_KV.get(`limit:${body.device}`),
    ]);
    const custom = override === null ? null : intVar(override, NaN);
    const hasCustom = custom !== null && Number.isFinite(custom);
    const deviceLimit = hasCustom ? custom : intVar(env.DEVICE_DAILY_LIMIT, 20);
    // A device with its own limit isn't held back by the shared per-network limit.
    const ipLimit = hasCustom ? Infinity : intVar(env.IP_DAILY_LIMIT, 40);

    if (spent >= capMicros) return json({ error: "budget" }, 503);
    if (deviceCount >= deviceLimit || ipCount >= ipLimit) return json({ error: "rate_limited" }, 429);

    // Count the question before asking, so parallel requests can't slip past the limit.
    const dayTtl = 60 * 60 * 26;
    await Promise.all([
      env.ASK_KV.put(deviceKey, String(deviceCount + 1), { expirationTtl: dayTtl }),
      env.ASK_KV.put(ipKey, String(ipCount + 1), { expirationTtl: dayTtl }),
    ]);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
    let costMicros = 0;
    try {
      const { answer, micros } = await ask(client, env, body);
      costMicros = micros;
      ctx.waitUntil(log(env, request, body, answer, micros));
      if (!answer) return json({ error: "no_answer" }, 422);
      return json({ answer, remainingToday: Math.max(0, deviceLimit - deviceCount - 1) });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 503);
      if (e instanceof Anthropic.APIError) return json({ error: "upstream", status: e.status ?? 0 }, 502);
      return json({ error: "upstream" }, 502);
    } finally {
      if (costMicros > 0) {
        // KV is eventually consistent, so the cap can be overshot by a few questions at most.
        const latest = await readInt(env.ASK_KV, spendKey);
        await env.ASK_KV.put(spendKey, String(latest + costMicros), { expirationTtl: 60 * 60 * 24 * 40 });
      }
    }
  },

  /** Daily: deletes research log entries past the retention period. */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    if (!env.LOG_DB) return;
    const days = intVar(env.LOG_RETENTION_DAYS, 90);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    await env.LOG_DB.prepare("DELETE FROM questions WHERE ts < ?").bind(cutoff).run();
  },
} satisfies ExportedHandler<Env>;

/** Saves one answered (or declined) question to the research log. Never fails the request. */
async function log(env: Env, request: Request, body: AskBody, answer: string, micros: number): Promise<void> {
  if (!env.LOG_DB) return;
  const last = body.messages[body.messages.length - 1];
  try {
    await env.LOG_DB.prepare(
      "INSERT INTO questions (ts, device, lang, question, history, car, answer, cost_micros, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        new Date().toISOString(),
        body.device,
        (request.headers.get("Accept-Language") ?? "").slice(0, 35) || null,
        last.text,
        JSON.stringify(body.messages.slice(0, -1)),
        body.car ?? null,
        answer || null,
        micros,
        MODEL,
      )
      .run();
  } catch {
    // Logging is best effort: a missing table or a full database never breaks an answer.
  }
}

async function ask(client: Anthropic, env: Env, body: AskBody): Promise<{ answer: string; micros: number }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = body.messages.map((m, i) => {
    const last = i === body.messages.length - 1;
    if (!last || !body.car) return { role: m.role, content: m.text };
    return {
      role: "user",
      content: [
        { type: "text", text: `<car_readings source="Ocean Live" note="snapshot from the app, may be old">\n${body.car}\n</car_readings>` },
        { type: "text", text: m.text },
      ],
    };
  });

  let micros = 0;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 6000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    micros += cost(response.usage);

    if (response.stop_reason === "refusal") {
      return { answer: "", micros };
    }
    if (response.stop_reason !== "tool_use" || round === MAX_TOOL_ROUNDS) {
      const answer = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { answer, micros };
    }

    // Keep every block (thinking included) unchanged, then answer each tool call.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const codes = (block.input as { codes?: unknown }).codes;
      if (block.name !== "lookup_fault_codes" || !Array.isArray(codes)) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: "Unknown tool or bad input.", is_error: true });
        continue;
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(await lookup(env.ASK_KV, codes)) });
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: "", micros };
}

/**
 * Looks codes up in KV. Codes are stored in groups by their first three characters
 * ("dtc:B20" holds every B20xxxx code; see scripts/build-dtc-kv.mjs). A 7-character code
 * falls back to its 5-character base code.
 */
async function lookup(kv: KVNamespace, raw: unknown[]): Promise<Record<string, unknown>> {
  const codes = [...new Set(raw.filter((c): c is string => typeof c === "string").map((c) => c.trim().toUpperCase()))]
    .filter((c) => /^[PCBU][0-9A-F]{4}([0-9A-F]{2})?$/.test(c))
    .slice(0, MAX_CODES);
  const prefixes = [...new Set(codes.map((c) => c.slice(0, 3)))];
  const groups = new Map<string, Record<string, unknown>>();
  await Promise.all(
    prefixes.map(async (p) => groups.set(p, (await kv.get<Record<string, unknown>>(`dtc:${p}`, "json")) ?? {})),
  );
  const out: Record<string, unknown> = {};
  for (const c of codes) {
    const group = groups.get(c.slice(0, 3)) ?? {};
    out[c] = group[c] ?? (c.length === 7 ? group[c.slice(0, 5)] : undefined) ?? null;
  }
  return out;
}

function cost(u: Anthropic.Beta.BetaUsage): number {
  const dollars =
    (u.input_tokens * PRICE.input +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      u.output_tokens * PRICE.output) /
    1_000_000;
  return Math.ceil(dollars * 1_000_000);
}

function validate(v: unknown): AskBody {
  const o = v as Record<string, unknown>;
  const device = o?.device;
  if (typeof device !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(device)) throw new Error("device");
  const list = o.messages;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TURNS) throw new Error("messages");
  const messages: Turn[] = list.map((m) => {
    const t = m as Record<string, unknown>;
    if ((t.role !== "user" && t.role !== "assistant") || typeof t.text !== "string") throw new Error("turn");
    const text = t.text.trim().slice(0, MAX_TEXT);
    if (!text) throw new Error("empty");
    return { role: t.role, text };
  });
  if (messages[0].role !== "user" || messages[messages.length - 1].role !== "user") throw new Error("order");
  for (let i = 1; i < messages.length; i++) if (messages[i].role === messages[i - 1].role) throw new Error("alternate");
  const car = typeof o.car === "string" && o.car.trim() ? o.car.trim().slice(0, MAX_CAR) : undefined;
  return { device, messages, car };
}

async function readInt(kv: KVNamespace, key: string): Promise<number> {
  const v = await kv.get(key);
  const n = v ? parseInt(v, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function intVar(v: string | undefined, fallback: number): number {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function numVar(v: string | undefined, fallback: number): number {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
