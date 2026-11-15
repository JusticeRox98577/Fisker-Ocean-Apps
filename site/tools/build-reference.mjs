// Writes the reference pages, made only from committed sources:
//   /codes/<code>      one page per fault code confirmed on Ocean cars (public/data/ocean-codes.json,
//                      made from the owner guide by tools/build-codes.mjs)
//   /modules, /modules/<id>   the modules the app scans (the app's own list, Pids.kt), with what
//                      the owner guide says about them
//   /glossary, /glossary/<term>   the readings the app shows, quoted from the owner guide
// Nothing here is written by hand about the car: every fact is pulled from the guide or the code,
// and the build fails if a sentence it expects is no longer in the guide.
// Usage (from site/): node tools/build-codes.mjs, then node tools/build-pages.mjs, then this.
import { readFileSync } from "node:fs";
import { PUB, GUIDE_URL, esc, path, page, docHero, docPage, crumbs, guideBullet, guideSection, md, mdQuote, scannedModules, moduleSlug, codeSlug } from "./site-layout.mjs";

const CODES = JSON.parse(readFileSync(new URL("data/ocean-codes.json", PUB), "utf8"));
const MODULES = scannedModules();
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const sourceNote = (what) => `<p class="file-meta">${what} <a href="${GUIDE_URL}" rel="noopener">Ocean owner guide</a> that "Any questions?" answers from. Not a dealer diagnosis.</p>`;

// Sentences from the guide used on several pages.
const U_CODES = guideBullet("Fault codes", "Many U-codes");
const CLEARING = guideBullet("Fault codes", "Clearing codes does not fix anything");
const STATES = guideBullet("Fault codes", "State:");

// The guide's "go to a qualified shop" list: "Airbag (ACU), brake (ESP, IBOOSTER), ... faults".
const SHOP_IDS = new Set([...CLEARING.matchAll(/\(([A-Z0-9_, ]+)\)/g)].flatMap((m) => m[1].split(/,\s*/)));
const inShopList = (id) => SHOP_IDS.has(id) || SHOP_IDS.has(id.replace(/_.*$/, ""));
// The guide's module groups: "MCU_F / MCU_R (front / rear motor)".
const groupOf = (id) => CODES.modules.find((g) => {
  const parts = g.ids.split(/\s*\/\s*|\s+and\s+/);
  const prefix = (parts[0].match(/^([A-Z0-9]+_)/) || [])[1] || "";
  return parts.some((p) => p === id || prefix + p === id);
});
// A confirmed code relates to a module when the module's name (as the app shows it) is in its meaning.
// "the HV battery module", "the keys and NFC module", "the trailer module": acronyms kept, no "module module".
const moduleNoun = (name) => {
  const base = name.replace(/\s+module$/i, "");
  const first = /^[A-Z][a-z]/.test(base) ? base[0].toLowerCase() + base.slice(1) : base;
  return `${first} module`;
};
const codesForModule = (m) => CODES.codes.filter((e) => e.meaning.toLowerCase().includes(m.name.toLowerCase()));
const modulesForCode = (e) => MODULES.filter((m) => e.meaning.toLowerCase().includes(m.name.toLowerCase()));

let count = 0;
const write = (opts) => { page(opts); count++; };

// ── One page per confirmed fault code ──
const allCodes = CODES.codes.flatMap((e) => e.codes.map((code) => ({ code, entry: e })));
allCodes.forEach(({ code, entry }, i) => {
  const system = CODES.systems[code[0]];
  const suffix = CODES.suffixes[code.slice(5)];
  const siblings = entry.codes.filter((c) => c !== code);
  const mods = modulesForCode(entry);
  const prev = allCodes[i - 1], next = allCodes[i + 1];
  write({
    file: `codes/${codeSlug(code)}.html`,
    title: `${code}: ${esc(entry.meaning)} · Fisker Ocean fault code`,
    description: `What Fisker Ocean fault code ${code} means (${esc(entry.meaning)}), how the code is built, and what to do about it.`,
    canonical: `https://oceanlive.org/codes/${codeSlug(code)}`,
    body: docPage(docHero("Fault code", `<code>${code}</code>`, esc(entry.meaning)), `
    ${crumbs([["/", "Home"], ["/codes", "Fault codes"], [null, code]])}
    <div class="callout sand">
      <p><strong>Confirmed on real Ocean cars.</strong> ${code} means: ${esc(entry.meaning)}.${siblings.length ? ` It is listed together with ${siblings.map((c) => `<a href="/codes/${codeSlug(c)}"><code>${c}</code></a>`).join(", ")}.` : ""}</p>
      ${entry.note ? `<p>${esc(entry.note)}</p>` : ""}
    </div>

    <h2 id="built">How ${code} is built</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Part</th><th scope="col">Here</th><th scope="col">Means</th></tr></thead>
        <tbody>
          <tr><td>System letter</td><td><code>${code[0]}</code></td><td>${system ? esc(cap(system)) : "Not in the guide"}</td></tr>
          <tr><td>Base code</td><td><code>${code.slice(1, 5)}</code></td><td>What part or signal it is about</td></tr>
          <tr><td>Failure type</td><td><code>${code.slice(5)}</code></td><td>${suffix ? `Usually: ${esc(suffix)}` : "Not one of the common failure types in the guide"}</td></tr>
        </tbody>
      </table>
    </div>
    <p>Some scan tools show only the first five characters (<code>${code.slice(0, 5)}</code>) or put a dash before the failure type (<code>${code.slice(0, 5)}-${code.slice(5)}</code>). More on <a href="/codes#built">how codes are built</a>.</p>
${mods.length ? `
    <h2 id="module">Module it names</h2>
    <p>The meaning names a module Ocean Live scans: ${mods.map((m) => `<a href="/modules/${moduleSlug(m.id)}"><strong>${esc(m.id)}</strong> (${esc(m.name)})</a>`).join(", ")}.</p>` : ""}

    <h2 id="what-to-do">What to do</h2>
    ${code[0] === "U" ? `<p>${md(U_CODES)}</p>` : ""}
    <p>${md(CLEARING)}</p>
    <ol>
      <li>Scan in Ocean Live: ${path("Faults", "Scan all modules")}. Tap the code for what it affects, possible causes and how it's fixed, when known.</li>
      <li>Tap <strong>Share report</strong> before clearing anything, to keep the history a workshop would use.</li>
      <li>Not sure? Tap the round <strong>?</strong> and ask "Any questions?".</li>
    </ol>
    <p>The states the app shows: ${md(STATES.replace(/^State:\s*/, ""))}</p>

    <h2 id="more">More codes</h2>
    <ul class="pager">
      ${prev ? `<li><a href="/codes/${codeSlug(prev.code)}" rel="prev">← <code>${prev.code}</code></a></li>` : ""}
      <li><a href="/codes#confirmed">All confirmed codes</a></li>
      ${next ? `<li><a href="/codes/${codeSlug(next.code)}" rel="next"><code>${next.code}</code> →</a></li>` : ""}
    </ul>
    ${sourceNote("From the")}`),
  });
});

// ── Modules: an index and one page per module ──
const restartText = {
  offered: `Ocean Live offers <strong>Restart</strong> for this module, only while the car is parked safely (see <a href="/codes#clearing">clearing codes and restarting</a>). A restart is not a repair.`,
  safety: `Ocean Live never offers <strong>Restart</strong> for this module, whatever state the car is in: it is one of the brakes, steering, airbags, drive, gateway or high-voltage battery modules. Clearing its codes is still possible.`,
  unsupported: `This module doesn't support a restart, so Ocean Live doesn't offer one. Clearing its codes is still possible.`,
};
const BMS_NOTE = guideBullet("What some readings mean", "Readings come from the battery management module");

write({
  file: "modules.html",
  title: "The modules Ocean Live scans · Fisker Ocean",
  description: `The ${MODULES.length} Fisker Ocean modules Ocean Live reads fault codes from, with their short names and what the app can do with each.`,
  canonical: "https://oceanlive.org/modules",
  body: docPage(docHero("Modules", "The modules Ocean Live scans", `<strong>Scan all modules</strong> reads stored fault codes from these ${MODULES.length} modules, in about a minute.`), `
    ${crumbs([["/", "Home"], ["/codes", "Fault codes"], [null, "Modules"]])}
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Short name</th><th scope="col">Module</th><th scope="col">Restart in the app</th></tr></thead>
        <tbody>
${MODULES.map((m) => `          <tr><td><a href="/modules/${moduleSlug(m.id)}"><strong>${esc(m.id)}</strong></a></td><td>${esc(m.name)}</td><td>${m.restart === "offered" ? "Offered" : m.restart === "safety" ? "Never (safety)" : "Not supported"}</td></tr>`).join("\n")}
        </tbody>
      </table>
    </div>
    <p>${md(CLEARING)}</p>
    <p class="file-meta">Made from the app's own module list and the <a href="${GUIDE_URL}" rel="noopener">Ocean owner guide</a>.</p>`),
});

MODULES.forEach((m, i) => {
  const group = groupOf(m.id);
  const codes = codesForModule(m);
  const prev = MODULES[i - 1], next = MODULES[i + 1];
  write({
    file: `modules/${moduleSlug(m.id)}.html`,
    title: `${esc(m.id)} (${esc(m.name)}) · Fisker Ocean module`,
    description: `The Fisker Ocean ${esc(moduleNoun(m.name))} (${esc(m.id)}): what Ocean Live reads from it and what it can and can't do with it.`,
    canonical: `https://oceanlive.org/modules/${moduleSlug(m.id)}`,
    body: docPage(docHero("Module", esc(m.id), esc(m.name)), `
    ${crumbs([["/", "Home"], ["/modules", "Modules"], [null, esc(m.id)]])}
    <p><strong>${esc(m.id)}</strong> is the ${esc(moduleNoun(m.name))}, one of the ${MODULES.length} modules Ocean Live reads fault codes from with ${path("Faults", "Scan all modules")}.${group ? ` The owner guide lists it as <strong>${esc(group.ids)}</strong> (${esc(group.name)}).` : ""}</p>
    ${m.id === "BMS" ? `<p>${md(BMS_NOTE)} See the <a href="/glossary">glossary</a> for what they mean.</p>` : ""}

    <h2 id="actions">What the app can do</h2>
    <ul>
      <li>Read its stored fault codes, and its software version and part number with ${path("Faults", "Module versions", "Read module versions")} (reading changes nothing).</li>
      <li><strong>Clear codes</strong> for this module, only while parked safely. Share the report first: clearing erases the history a workshop would use.</li>
      <li>${restartText[m.restart]}</li>
    </ul>
    ${inShopList(m.id) ? `<div class="callout"><p>${md(CLEARING.slice(CLEARING.indexOf("Airbag")))}</p></div>` : ""}
${codes.length ? `
    <h2 id="codes">Confirmed codes that name it</h2>
    <ul>
${codes.map((e) => `      <li>${e.codes.map((c) => `<a href="/codes/${codeSlug(c)}"><code>${c}</code></a>`).join(", ")}: ${esc(e.meaning)}</li>`).join("\n")}
    </ul>` : ""}

    <h2 id="more">More modules</h2>
    <ul class="pager">
      ${prev ? `<li><a href="/modules/${moduleSlug(prev.id)}" rel="prev">← ${esc(prev.id)}</a></li>` : ""}
      <li><a href="/modules">All modules</a></li>
      ${next ? `<li><a href="/modules/${moduleSlug(next.id)}" rel="next">${esc(next.id)} →</a></li>` : ""}
    </ul>
    <p class="file-meta">Made from the app's own module list and the <a href="${GUIDE_URL}" rel="noopener">Ocean owner guide</a>.</p>`),
  });
});

// ── Glossary: the readings the app shows, each quoted from the guide ──
// [slug, term, short, where in the app, [guide section, bullet start]...]
const TERMS = [
  ["battery-health", "Battery health", "Measured capacity, usable now and rated usable", ["Battery", "Battery health"], [["Battery tab", "**Battery health:**"]]],
  ["usable-capacity", "Usable battery capacity", "The kWh the app uses for range and charge time", ["Settings", "Car"], [["The car", "Trims:"], ["Settings tab", "**Car:**"]]],
  ["state-of-charge-and-range", "Charge and range", "The charge ring on the Live tab", ["Live"], [["Live tab", "Charge ring"], ["Live tab", "Range is estimated"]]],
  ["cell-spread", "Cell spread", "Highest minus lowest cell voltage", ["Battery", "Cells"], [["What some readings mean", "**Cell spread**"], ["Battery tab", "**Cells:**"]]],
  ["insulation-resistance", "Insulation (isolation) resistance", "How well the high-voltage system is isolated from the body", ["Battery", "High voltage"], [["What some readings mean", "**Insulation (isolation) resistance:**"], ["Battery tab", "**High voltage:**"]]],
  ["pack-temperatures", "Pack temperatures", "Battery and coolant temperatures", ["Battery", "Temperatures"], [["What some readings mean", "**Pack temperatures:**"], ["Battery tab", "**Temperatures:**"]]],
  ["power-and-current", "Power and current", "Which way energy flows", ["Live"], [["What some readings mean", "**Power and current**"], ["Settings tab", "**Advanced: Flip current sign**"]]],
  ["12v-resting-voltage", "12V resting voltage", "The 12V battery's voltage after the car has slept", ["Battery", "See the 12V history"], [["Sleep and the 12 V battery", "What the app says about 12 V voltage"], ["The car", "The Ocean has a conventional 12 V battery"]]],
  ["12v-history", "12V history and overnight drop", "The 12V screen", ["Battery", "See the 12V history"], [["Battery tab", "**See the 12V history ›**"], ["Sleep and the 12 V battery", "Watch 12V while the car sleeps"]]],
  ["parked-drain", "Parked drain", "Charge lost per day while parked", ["Battery", "Parked drain"], [["Battery tab", "**Parked drain:**"], ["Live tab", "**While parked**"]]],
  ["charging-curve", "Charging curve", "Charging power against charge level", ["Trips", "a charge"], [["Trips tab", "Tap a charge for its **Charging curve**"], ["The car", "Charging: CCS1"]]],
  ["fault-code-states", "Fault code states", "Active now, pending, stored, warning lamp", ["Faults", "Scan all modules"], [["Fault codes", "State:"], ["Faults tab", "**Scan all modules**"]]],
  ["this-charge-and-drive", "This charge and This drive", "The live session cards", ["Live"], [["Live tab", "While charging:"], ["Live tab", "While driving:"]]],
];
// Check every source sentence is still in the guide before writing anything.
const terms = TERMS.map(([slug, term, short, where, sources]) => ({ slug, term, short, where, quotes: sources.map(([sec, start]) => ({ sec, text: guideBullet(sec, start) })) }));
guideSection("What some readings mean");

write({
  file: "glossary.html",
  title: "Glossary of readings · Ocean Live",
  description: "What the readings in Ocean Live mean for a Fisker Ocean: battery health, cell spread, insulation resistance, 12V resting voltage, parked drain and more.",
  canonical: "https://oceanlive.org/glossary",
  body: docPage(docHero("Glossary", "What the readings mean", "Every reading here is explained with the owner guide's own words, and where to find it in the app."), `
    ${crumbs([["/", "Home"], ["/help", "Help"], [null, "Glossary"]])}
    <dl class="glossary">
${terms.map((t) => `      <dt><a href="/glossary/${t.slug}">${esc(t.term)}</a></dt><dd>${esc(t.short)}. In the app: ${path(...t.where.map(esc))}</dd>`).join("\n")}
    </dl>
    ${sourceNote("Quoted from the")}`),
});

terms.forEach((t, i) => {
  const prev = terms[i - 1], next = terms[i + 1];
  write({
    file: `glossary/${t.slug}.html`,
    title: `${esc(t.term)} · Ocean Live glossary`,
    description: `${esc(t.term)} in Ocean Live for the Fisker Ocean: what it means and where to find it in the app.`,
    canonical: `https://oceanlive.org/glossary/${t.slug}`,
    body: docPage(docHero("Glossary", esc(t.term), esc(t.short) + "."), `
    ${crumbs([["/", "Home"], ["/glossary", "Glossary"], [null, esc(t.term)]])}
    <p>In the app: ${path(...t.where.map(esc))}</p>
${t.quotes.map((q) => `    <h2>From the guide: ${esc(q.sec.replace(" 12 V ", " 12V "))}</h2>
    <blockquote class="guide-quote">${mdQuote(q.text)}</blockquote>`).join("\n")}

    <h2 id="more">More readings</h2>
    <ul class="pager">
      ${prev ? `<li><a href="/glossary/${prev.slug}" rel="prev">← ${esc(prev.term)}</a></li>` : ""}
      <li><a href="/glossary">Glossary</a></li>
      ${next ? `<li><a href="/glossary/${next.slug}" rel="next">${esc(next.term)} →</a></li>` : ""}
    </ul>
    ${sourceNote("Quoted from the")}`),
  });
});

console.log(`build-reference: ${count} pages (${allCodes.length} codes, ${MODULES.length + 1} module pages, ${terms.length + 1} glossary pages)`);
