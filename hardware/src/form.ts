/**
 * Checking a sign-up. The questions and their choices live in public/index.html, so the page can be
 * edited without touching this file: choices are sent as short ids (the `value` of each checkbox or
 * option) and this only checks their shape and how many there are.
 */

export const MAX_FEATURES = 5;
const MAX_PRODUCTS = 10;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
// A plain address check; the real proof is that the address answers when you write to it.
const EMAIL = /^[^\s@"<>]{1,64}@[^\s@"<>]+\.[^\s@"<>.]{2,}$/;

export interface SignUp {
  email: string;
  name: string;
  region: string;
  car: string;
  phone: string;
  products: string[];
  features: string[];
  otherFeature: string;
  install: string;
  notes: string;
}

export type Checked = { ok: true; value: SignUp } | { ok: false; error: string };

/** One line of text: trimmed, control characters and line breaks removed, cut to `max`. */
function line(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Free text that may have line breaks. */
function text(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function choice(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  return ID.test(s) ? s : "";
}

function ids(v: unknown, max: number): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = String(item ?? "").trim().toLowerCase();
    if (!ID.test(s)) return null;
    if (!out.includes(s)) out.push(s);
  }
  return out.length > max ? null : out;
}

export function checkSignUp(body: Record<string, unknown>): Checked {
  const email = line(body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (body.consent !== true) return { ok: false, error: "Tick the box to say we may email you about the beta." };

  const features = ids(body.features, MAX_FEATURES);
  if (features === null) return { ok: false, error: `Pick up to ${MAX_FEATURES} features.` };
  const otherFeature = line(body.otherFeature, 300);
  if (features.length === 0 && !otherFeature) {
    return { ok: false, error: "Pick at least one feature, or write one in." };
  }
  const products = ids(body.products, MAX_PRODUCTS);
  if (products === null) return { ok: false, error: "Something was wrong with the products you picked. Reload the page and try again." };

  return {
    ok: true,
    value: {
      email,
      name: line(body.name, 100),
      region: line(body.region, 100),
      car: line(body.car, 100),
      phone: choice(body.phone),
      products,
      features,
      otherFeature,
      install: choice(body.install),
      notes: text(body.notes, 2000),
    },
  };
}
