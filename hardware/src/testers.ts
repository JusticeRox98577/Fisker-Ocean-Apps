/**
 * Picking beta testers. There are only BOARDS test boards, so open invitations plus acceptances can
 * never go above that. Picking someone emails them a link (token in the #fragment) to /invite, where
 * they say yes or no. A no frees the board for someone else. ADMIN_EMAIL gets an email either way.
 */
import { type Env, boards } from "./env";
import { sendEmail } from "./mail";
import { DISCLOSURE_VERSION, signature } from "./preorders";
import { line } from "./form";
import { json, randomToken, sha256 } from "./util";

type Pick = "" | "invited" | "accepted" | "declined";

interface Person {
  email: string;
  name: string;
  pick: Pick;
  products: string;
  sig_name: string;
}

async function person(db: D1Database, email: string): Promise<Person | null> {
  return db.prepare("SELECT email, name, pick, products, sig_name FROM responses WHERE email = ?1")
    .bind(email.trim().toLowerCase())
    .first<Person>();
}

async function taken(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM responses WHERE pick IN ('invited', 'accepted')").first<{ n: number }>();
  return r?.n ?? 0;
}

// EDIT: the invitation email. {link} is the page where they read and sign the disclosure, then say yes or no.
function invitation(name: string, link: string, total: number): { subject: string; text: string } {
  const hi = name ? `Hi ${name},` : "Hi,";
  return {
    subject: "You've been picked to beta test Nova",
    text:
      `${hi}\n\n` +
      `Thanks for signing up to beta test Nova. There are only ${total} test boards, and I'd like one of them to go in your Ocean.\n\n` +
      `Please tell me whether you're in:\n\n${link}\n\n` +
      `That page explains what testing involves. Nova is first-generation hardware, so before saying yes you'll read and sign ` +
      `the same first-generation disclosure that pre-order customers sign (it takes a few minutes). ` +
      `Please answer either way: a No passes the board to the next person.\n\n` +
      `Once you say yes, I'll email you about shipping and installing it. Questions? Just reply to this email.\n\n` +
      `Justice\nOcean Live LLC`,
  };
}

/** POST /api/admin/pick { email }: invites someone, or sends a fresh link to someone already invited. */
export async function pick(env: Env, email: string, now: number): Promise<Response> {
  const p = await person(env.DB, email);
  if (!p) return json({ error: "There's no sign-up with that email." }, 404);
  if (p.pick === "accepted") return json({ error: "They've already said yes." }, 409);
  const total = boards(env);
  if (p.pick !== "invited" && (await taken(env.DB)) >= total) {
    return json({ error: `All ${total} boards are spoken for. Un-pick someone first.` }, 409);
  }
  const token = randomToken();
  const link = `${env.SITE_URL}/invite#${token}`;
  const mail = invitation(p.name, link, total);
  const sent = await sendEmail(env, { to: p.email, ...mail });
  if (!sent.ok) return json({ error: sent.error }, 502);
  // Only after the email went out, so a failed send doesn't take a board.
  await env.DB.prepare(
    "UPDATE responses SET pick = 'invited', pick_token_hash = ?2, picked_at = ?3, answered_at = NULL WHERE email = ?1",
  )
    .bind(p.email, await sha256(token), now)
    .run();
  return json({ ok: true, resent: p.pick === "invited" });
}

/** POST /api/admin/unpick { email }: frees their board. Their old link stops working. No email is sent. */
export async function unpick(env: Env, email: string): Promise<Response> {
  const p = await person(env.DB, email);
  if (!p) return json({ error: "There's no sign-up with that email." }, 404);
  await env.DB.prepare("UPDATE responses SET pick = '', pick_token_hash = NULL, picked_at = NULL, answered_at = NULL WHERE email = ?1")
    .bind(p.email)
    .run();
  return json({ ok: true });
}

async function byToken(db: D1Database, token: string): Promise<Person | null> {
  return db.prepare("SELECT email, name, pick, products, sig_name FROM responses WHERE pick_token_hash = ?1")
    .bind(await sha256(token))
    .first<Person>();
}

const productsOf = (p: Person): string[] => {
  try {
    const a = JSON.parse(p.products);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
};

/** POST /api/invite { token }: what the yes/no page shows. */
export async function inviteInfo(env: Env, token: string): Promise<Response> {
  const p = token ? await byToken(env.DB, token) : null;
  if (!p) return json({ error: "This link isn't valid any more. If you think that's a mistake, reply to the email it came in." }, 404);
  return json({ name: p.name, status: p.pick, boards: boards(env), products: productsOf(p), signed: !!p.sig_name, version: DISCLOSURE_VERSION });
}

/** POST /api/invite/answer { token, answer: "yes" | "no", signedName, signature }: a yes needs the
 * first-generation disclosure signed (typed full name and a drawn signature, kept with the answer). */
export async function inviteAnswer(env: Env, ctx: ExecutionContext, body: Record<string, unknown>, token: string, now: number): Promise<Response> {
  const answer = body.answer;
  if (answer !== "yes" && answer !== "no") return json({ error: "Answer yes or no." }, 400);
  const p = token ? await byToken(env.DB, token) : null;
  if (!p) return json({ error: "This link isn't valid any more. If you think that's a mistake, reply to the email it came in." }, 404);

  const next: Pick = answer === "yes" ? "accepted" : "declined";
  if (p.pick === next) return json({ ok: true, status: next });
  // Saying yes after a no works while a board is still free (the "Changed your mind?" button).
  if (next === "accepted" && p.pick !== "invited" && (p.pick !== "declined" || (await taken(env.DB)) >= boards(env))) {
    return json({ error: "Your board has gone to someone else. Reply to the invitation email if you'd still like to test." }, 409);
  }
  if (next === "accepted") {
    const signed = line(body.signedName, 100);
    const png = signature(body.signature);
    if (signed.length < 3 || !png) return json({ error: "Please read and sign the first-generation disclosure to say yes." }, 400);
    await env.DB.prepare(
      "UPDATE responses SET pick = 'accepted', answered_at = ?2, sig_name = ?3, sig_png = ?4, sig_at = ?2, sig_version = ?5 WHERE email = ?1",
    ).bind(p.email, now, signed, png, DISCLOSURE_VERSION).run();
  } else {
    await env.DB.prepare("UPDATE responses SET pick = ?2, answered_at = ?3 WHERE email = ?1").bind(p.email, next, now).run();
  }

  const who = p.name ? `${p.name} (${p.email})` : p.email;
  ctx.waitUntil(
    sendEmail(env, {
      to: env.ADMIN_EMAIL,
      subject: next === "accepted" ? `Nova beta: ${who} said yes` : `Nova beta: ${who} said no`,
      text:
        next === "accepted"
          ? `${who} accepted a Nova test board and signed the first-generation disclosure (version ${DISCLOSURE_VERSION}). Write to them at ${p.email} about shipping.\n\n${env.SITE_URL}/admin`
          : `${who} said no to a Nova test board, so it's free again. Pick someone else:\n\n${env.SITE_URL}/admin`,
    }).then((r) => {
      if (!r.ok) console.error("admin notice not sent", r.error);
    }),
  );
  return json({ ok: true, status: next });
}
