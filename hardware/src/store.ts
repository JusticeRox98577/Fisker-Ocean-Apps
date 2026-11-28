/** Saving and reading answers in D1. */
import { MAX_FEATURES, type SignUp } from "./form";

export interface Row {
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
  createdAt: string;
  updatedAt: string;
  /** '' not picked, invited, accepted, declined. */
  pick: string;
  pickedAt: string;
  answeredAt: string;
  /** The first-generation disclosure, signed when they said yes. */
  signedName: string;
  signedAt: string;
  signedVersion: string;
}

interface DbRow {
  email: string;
  name: string;
  region: string;
  car: string;
  phone: string;
  products: string;
  features: string;
  other_feature: string;
  install: string;
  notes: string;
  created_at: number;
  updated_at: number;
  pick: string;
  picked_at: number | null;
  answered_at: number | null;
  sig_name: string;
  sig_at: number | null;
  sig_version: string;
}

/** Saves an answer. Signing up again with the same address replaces the earlier answer. */
export async function saveSignUp(db: D1Database, s: SignUp, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO responses (email, name, region, car, phone, products, features, other_feature, install, notes, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
       ON CONFLICT(email) DO UPDATE SET
         name = excluded.name, region = excluded.region, car = excluded.car, phone = excluded.phone,
         products = excluded.products, features = excluded.features, other_feature = excluded.other_feature,
         install = excluded.install, notes = excluded.notes, updated_at = excluded.updated_at`,
    )
    .bind(
      s.email, s.name, s.region, s.car, s.phone,
      JSON.stringify(s.products), JSON.stringify(s.features),
      s.otherFeature, s.install, s.notes, now,
    )
    .run();
}

function list(v: string): string[] {
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

export async function allRows(db: D1Database): Promise<Row[]> {
  const { results } = await db.prepare(
    "SELECT email, name, region, car, phone, products, features, other_feature, install, notes, created_at, updated_at, pick, picked_at, answered_at, sig_name, sig_at, sig_version FROM responses ORDER BY created_at",
  ).all<DbRow>();
  return results.map((r) => ({
    email: r.email,
    name: r.name,
    region: r.region,
    car: r.car,
    phone: r.phone,
    products: list(r.products),
    features: list(r.features),
    otherFeature: r.other_feature,
    install: r.install,
    notes: r.notes,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    pick: r.pick,
    pickedAt: r.picked_at ? new Date(r.picked_at).toISOString() : "",
    answeredAt: r.answered_at ? new Date(r.answered_at).toISOString() : "",
    signedName: r.sig_name ?? "",
    signedAt: r.sig_at ? new Date(r.sig_at).toISOString() : "",
    signedVersion: r.sig_version ?? "",
  }));
}

export async function deleteSignUp(db: D1Database, email: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM responses WHERE email = ?1").bind(email.trim().toLowerCase()).run();
  return (r.meta.changes ?? 0) > 0;
}

export interface Tally {
  feature: string;
  /** How many people picked it at all. */
  picks: number;
  /** How many put it first. */
  first: number;
  /** 5 points for 1st place, 4 for 2nd ... 1 for 5th. */
  points: number;
}

/** Which features matter most, across everyone. Highest points first. */
export function tally(rows: Row[]): { responses: number; features: Tally[]; products: Record<string, number> } {
  const byFeature = new Map<string, Tally>();
  const products: Record<string, number> = {};
  for (const r of rows) {
    r.features.slice(0, MAX_FEATURES).forEach((f, i) => {
      const t = byFeature.get(f) ?? { feature: f, picks: 0, first: 0, points: 0 };
      t.picks += 1;
      t.points += MAX_FEATURES - i;
      if (i === 0) t.first += 1;
      byFeature.set(f, t);
    });
    for (const p of r.products) products[p] = (products[p] ?? 0) + 1;
  }
  const features = [...byFeature.values()].sort(
    (a, b) => b.points - a.points || b.first - a.first || a.feature.localeCompare(b.feature),
  );
  return { responses: rows.length, features, products };
}

/** CSV for a spreadsheet. Cells that a spreadsheet would run as a formula are prefixed with '. */
export function toCsv(rows: Row[]): string {
  const head = [
    "email", "name", "region", "car", "phone", "products",
    ...Array.from({ length: MAX_FEATURES }, (_, i) => `feature_${i + 1}`),
    "other_feature", "install", "notes", "created_at", "updated_at", "picked", "picked_at", "answered_at",
    "signed_name", "signed_at", "signed_version",
  ];
  const cell = (v: string) => {
    let s = v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(",")];
  for (const r of rows) {
    const feats = Array.from({ length: MAX_FEATURES }, (_, i) => r.features[i] ?? "");
    lines.push(
      [r.email, r.name, r.region, r.car, r.phone, r.products.join(" "), ...feats, r.otherFeature, r.install, r.notes, r.createdAt, r.updatedAt, r.pick, r.pickedAt, r.answeredAt, r.signedName, r.signedAt, r.signedVersion]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export interface PublicStats {
  /** Everyone who signed up. */
  responses: number;
  /** People interested in each product, by product id. */
  interest: Record<string, number>;
  /** Test boards in total, and how many are taken by an open invitation or an acceptance. */
  boards: number;
  spokenFor: number;
}

/** The numbers anyone may see: counts only, nothing about a person. */
export async function publicStats(db: D1Database, boards: number): Promise<PublicStats> {
  const [total, interest, taken] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT COUNT(*) AS n FROM responses"),
    db.prepare("SELECT j.value AS product, COUNT(*) AS n FROM responses, json_each(responses.products) AS j GROUP BY j.value"),
    db.prepare("SELECT COUNT(*) AS n FROM responses WHERE pick IN ('invited', 'accepted')"),
  ]);
  const byProduct: Record<string, number> = {};
  for (const r of interest.results) byProduct[String(r.product)] = Number(r.n);
  return {
    responses: Number(total.results[0]?.n ?? 0),
    interest: byProduct,
    boards,
    spokenFor: Math.min(boards, Number(taken.results[0]?.n ?? 0)),
  };
}
