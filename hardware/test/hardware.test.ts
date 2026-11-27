import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { checkSignUp } from "../src/form";
import { allRows, tally, toCsv, type Row } from "../src/store";

const ORIGIN = "https://hardware.oceanlive.org";
const ADMIN = "test-admin-token-0123456789abcdef";

const good = {
  email: "Owner@Example.com",
  name: "Sam",
  region: "Oregon, USA",
  car: "extreme",
  phone: "iphone",
  products: ["flare", "supernova"],
  features: ["carplay", "remote-status", "low-drain", "fail-safe", "price"],
  otherFeature: "",
  install: "help",
  notes: "Line one\nLine two",
  consent: true,
  website: "",
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch(`${ORIGIN}/api/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function admin(path: string, init: RequestInit = {}, token = ADMIN) {
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers: { Authorization: `Bearer ${token}` } });
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM responses"), env.DB.prepare("DELETE FROM counters")]);
});

describe("checking a sign-up", () => {
  it("accepts a full answer and tidies it", () => {
    const r = checkSignUp({ ...good, name: "  Sam\u0000  Smith ", features: ["CarPlay", "carplay", "abrp"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.email).toBe("owner@example.com");
    expect(r.value.name).toBe("Sam Smith");
    expect(r.value.features).toEqual(["carplay", "abrp"]);
    expect(r.value.notes).toBe("Line one\nLine two");
  });

  it("needs an email, consent and at least one feature", () => {
    expect(checkSignUp({ ...good, email: "nope" })).toMatchObject({ ok: false });
    expect(checkSignUp({ ...good, consent: false })).toMatchObject({ ok: false });
    expect(checkSignUp({ ...good, features: [] })).toMatchObject({ ok: false });
    expect(checkSignUp({ ...good, features: [], otherFeature: "Heated wipers" })).toMatchObject({ ok: true });
  });

  it("refuses more than five features and odd ids", () => {
    expect(checkSignUp({ ...good, features: ["a", "b", "c", "d", "e", "f"] })).toMatchObject({ ok: false });
    expect(checkSignUp({ ...good, features: ["<script>"] })).toMatchObject({ ok: false });
    expect(checkSignUp({ ...good, features: "carplay" })).toMatchObject({ ok: false });
  });

  it("drops a choice that isn't an id", () => {
    const r = checkSignUp({ ...good, phone: "a phone!" });
    expect(r.ok && r.value.phone).toBe("");
  });
});

describe("POST /api/signup", () => {
  it("saves an answer", async () => {
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await allRows(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "owner@example.com", features: good.features, products: good.products, install: "help" });
  });

  it("replaces the earlier answer for the same address", async () => {
    await post(good);
    await post({ ...good, email: "owner@example.com", features: ["abrp"] });
    const rows = await allRows(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0].features).toEqual(["abrp"]);
  });

  it("says why an answer is refused", async () => {
    const res = await post({ ...good, consent: false });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toMatch(/Tick the box/);
  });

  it("pretends to accept bots that fill the hidden field, and saves nothing", async () => {
    const res = await post({ ...good, website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(await allRows(env.DB)).toHaveLength(0);
  });

  it("refuses other sites, non-JSON and broken JSON", async () => {
    expect((await post(good, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await post(good, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post("{not json")).status).toBe(400);
    expect((await post([1, 2])).status).toBe(400);
  });

  it("limits sign-ups per network", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post({ ...good, email: `p${i}@example.com` }, { "CF-Connecting-IP": "203.0.113.9" })).status).toBe(200);
    }
    expect((await post({ ...good, email: "p6@example.com" }, { "CF-Connecting-IP": "203.0.113.9" })).status).toBe(429);
    expect((await post({ ...good, email: "p7@example.com" }, { "CF-Connecting-IP": "203.0.113.10" })).status).toBe(200);
  });

  it("only takes POST", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/signup`);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});

describe("the admin endpoints", () => {
  it("need the token", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/responses`)).status).toBe(401);
    expect((await admin("/api/responses", {}, "wrong-token-wrong-token")).status).toBe(401);
  });

  it("download the answers as CSV, JSON and a ranking", async () => {
    await post(good);
    await post({ ...good, email: "b@example.com", features: ["remote-status", "carplay"], notes: "=SUM(A1)" });

    const csv = await admin("/api/responses");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Content-Type")).toMatch(/text\/csv/);
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toContain("feature_1,feature_2");
    expect(text).toContain("'=SUM(A1)");
    expect(text).toContain('"Line one\nLine two"');

    const j = await admin("/api/responses?format=json");
    expect((await j.json<{ responses: Row[] }>()).responses).toHaveLength(2);

    const s = await (await admin("/api/responses?format=summary")).json<ReturnType<typeof tally>>();
    expect(s.responses).toBe(2);
    // carplay: 5 + 4 = 9; remote-status: 4 + 5 = 9, tie broken by firsts (1 each), then by name.
    expect(s.features.slice(0, 2).map((f) => [f.feature, f.points])).toEqual([["carplay", 9], ["remote-status", 9]]);
    expect(s.products).toEqual({ flare: 2, supernova: 2 });
  });

  it("delete one person", async () => {
    await post(good);
    const res = await admin("/api/responses?email=OWNER@example.com", { method: "DELETE" });
    expect(await res.json()).toEqual({ ok: true, deleted: true });
    expect(await allRows(env.DB)).toHaveLength(0);
  });
});

describe("the page", () => {
  it("is served, and /api/info says the form is open", async () => {
    const page = await SELF.fetch(`${ORIGIN}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="beta-form"');
    expect(await (await SELF.fetch(`${ORIGIN}/api/info`)).json()).toEqual({ open: true });
    expect((await SELF.fetch(`${ORIGIN}/api/nope`)).status).toBe(404);
  });

  it("has feature ids the API accepts", async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/`)).text();
    const ids = [...html.matchAll(/name="features" value="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(MIN_FEATURES);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(checkSignUp({ ...good, features: [id] }).ok).toBe(true);
  });
});

const MIN_FEATURES = 5;

describe("CSV", () => {
  it("has a header even with no answers", () => {
    expect(toCsv([]).split("\r\n")[0].startsWith("email,name")).toBe(true);
  });
});
