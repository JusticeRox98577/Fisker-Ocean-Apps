// /calculators: charging time and cost, and the 12V check. Pure arithmetic on what the visitor
// types; nothing is sent anywhere. The 12V thresholds are the owner guide's (written into the page
// by tools/build-more.mjs).

const num = (el) => {
  const v = parseFloat(String(el.value).replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};
const fmt = (n, digits = 1) => n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
function duration(hours) {
  const mins = Math.round(hours * 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
function say(out, lines, error = false) {
  out.replaceChildren(...lines.map((t) => { const p = document.createElement("p"); p.textContent = t; return p; }));
  out.classList.toggle("is-error", error);
}

function chargeCalc(form) {
  const $ = (id) => form.querySelector("#" + id);
  const model = $("c-model"), kwh = $("c-kwh"), start = $("c-start"), end = $("c-end"), kw = $("c-kw"), loss = $("c-loss"), price = $("c-price"), cur = $("c-cur");
  const out = form.querySelector(".calc-out");
  model.addEventListener("change", () => { if (model.value !== "custom") kwh.value = model.value; update(); });
  kwh.addEventListener("input", () => { if (model.value !== "custom" && num(kwh) !== Number(model.value)) model.value = "custom"; });
  function update() {
    const cap = num(kwh), a = num(start), b = num(end), p = num(kw), l = Number.isFinite(num(loss)) ? num(loss) : 0, pr = num(price);
    if (!(cap > 0)) return say(out, ["Enter the usable battery in kWh."], true);
    if (!(a >= 0 && a <= 100 && b >= 0 && b <= 100)) return say(out, ["Start and end charge are percentages from 0 to 100."], true);
    if (!(b > a)) return say(out, ["The end charge has to be higher than the start."], true);
    if (!(p > 0)) return say(out, ["Enter the average charging power in kW."], true);
    if (!(l >= 0 && l < 100)) return say(out, ["Losses are a percentage under 100."], true);
    const into = cap * (b - a) / 100;
    const from = into / (1 - l / 100);
    const lines = [
      `About ${fmt(into)} kWh goes into the battery (${fmt(a, 0)}% to ${fmt(b, 0)}% of ${fmt(cap)} kWh)${l ? `, about ${fmt(from)} kWh from the charger with ${fmt(l, 0)}% losses` : ""}.`,
      `At an average of ${fmt(p)} kW that takes about ${duration(from / p)}.`,
    ];
    if (pr >= 0) lines.push(`At ${(cur.value || "").trim()}${fmt(pr, 3)} per kWh it costs about ${(cur.value || "").trim()}${fmt(from * pr, 2)}.`);
    else lines.push("Enter your price per kWh to see the cost.");
    say(out, lines);
  }
  form.addEventListener("input", update);
  form.addEventListener("submit", (e) => { e.preventDefault(); update(); });
  update();
}

function twelveCalc(form) {
  const volts = form.querySelector("#t-volts");
  const out = form.querySelector(".calc-out");
  function update() {
    const v = num(volts);
    const rest = form.querySelector('input[name="t-when"]:checked')?.value !== "awake";
    if (!volts.value.trim()) return say(out, ["Enter a voltage, like 12.55."]);
    if (!(v > 0 && v < 20)) return say(out, ["That doesn't look like a 12V battery reading."], true);
    const lines = [];
    if (v > 13.2) lines.push("Over 13.2 V: the car's DC-DC converter is charging the 12V. That's normal while the car is awake.");
    else if (v < 12.0) lines.push("Under 12.0 V: the car may not wake up.");
    else if (rest) lines.push(v >= 12.4 ? "12.4 V or more at rest: healthy." : "Under 12.4 V at rest: the 12V battery is weak or something draws power while parked.");
    else lines.push("The guide's 12.4 V threshold is for a resting reading, taken after the car has slept and before it starts charging the 12V. Check again at rest.");
    if (rest && v <= 13.2) lines.push("A healthy car loses only a few hundredths of a volt a night.");
    say(out, lines, v < 12.0);
  }
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", (e) => { e.preventDefault(); update(); });
  update();
}

for (const form of document.querySelectorAll("form.calc")) {
  if (form.dataset.calc === "charge") chargeCalc(form);
  else if (form.dataset.calc === "twelve") twelveCalc(form);
}
