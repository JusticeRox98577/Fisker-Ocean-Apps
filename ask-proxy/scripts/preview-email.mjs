// Writes the sign-in email in all five languages to .email-preview/ so it can be opened in a browser.
//   node scripts/preview-email.mjs
// Node 22.18+ runs src/email.ts directly (type stripping). Nothing is sent.
// Each language gets <lang>.html (banner from the local site build, as it looks once the site is live),
// <lang>.images-off.html (banner blocked, alt text only) and <lang>.txt (the text/plain part).
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { signInEmail, HEADER_IMAGE } from "../src/email.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../.email-preview");
const localHeader = resolve(here, "../../../site/site/public/email/header.png");
const headerUrl = existsSync(localHeader) ? pathToFileURL(localHeader).href : HEADER_IMAGE;
mkdirSync(out, { recursive: true });

const index = [];
for (const lang of ["en", "de", "nl", "fr", "es"]) {
  const mail = signInEmail(lang, "482913", 10);
  writeFileSync(resolve(out, `${lang}.html`), mail.html.replace(HEADER_IMAGE, headerUrl));
  writeFileSync(resolve(out, `${lang}.images-off.html`), mail.html.replace(HEADER_IMAGE, "about:blank"));
  writeFileSync(resolve(out, `${lang}.txt`), `Subject: ${mail.subject}\n\n${mail.text}`);
  index.push(`<li><a href="${lang}.html">${lang}</a> (<a href="${lang}.images-off.html">images off</a>, <a href="${lang}.txt">text</a>): ${mail.subject}</li>`);
}
writeFileSync(resolve(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Sign-in email previews</title><ul>${index.join("")}</ul>`);
console.log(`Wrote previews to ${out}`);
