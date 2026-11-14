/**
 * The sign-in code email: subject, plain text and HTML in five languages.
 *
 * The HTML is "bulletproof" email markup: table layout, inline styles, no web fonts, no scripts, no tracking,
 * one hosted image (the blueprint banner) whose cell is navy so it still looks designed with images blocked.
 * It is a dark, blueprint-navy design in both light and dark mode (all text pairs are >= 4.5:1), so a client
 * that forces dark mode has little to change. Outlook desktop gets VML gradients and solid-colour fallbacks.
 */

export type EmailLang = "en" | "de" | "nl" | "fr" | "es";

export interface SignInEmail {
  subject: string;
  text: string;
  html: string;
}

interface Strings {
  subject: (code: string) => string;
  preheader: (m: number) => string;
  label: string;
  heading: string;
  intro: string;
  sentence: (code: string) => string;
  expiry: (m: number) => string;
  digits: string;
  chips: (m: number) => [string, string, string];
  ignore: string;
  sentBecause: string;
  footer: string;
  /** Banner credit (CC BY 4.0). {work}, {author} and {license} are replaced (linked in the HTML). */
  credit: string;
  /** Plain-text body lines before the code. */
  textIntro: string;
}

const NBSP = " ";

// Subjects start with the code on purpose: it can be read (and autofilled on iOS/Android) straight from the
// notification without opening the mail. The trade-off is that the code shows on lock screens, watches and
// inbox lists. The body's first text line holds it too, so a code-free subject would hide little from previews,
// and the code is single use and expires in minutes.
const STRINGS: Record<EmailLang, Strings> = {
  en: {
    subject: (c) => `${c} is your Ocean Live code`,
    preheader: (m) => `Enter it in the app to sign in. It works for ${m} minutes.`,
    label: "Sign-in code",
    heading: "Here's your sign-in code",
    intro: "Enter this code in Ocean Live.",
    sentence: (c) => `Your Ocean Live sign-in code is ${c}.`,
    expiry: (m) => `It works for ${m} minutes.`,
    digits: "6 digits",
    chips: (m) => [`Expires in ${m} min`, "Single use", "Never share it"],
    ignore: "Didn't ask for this? You can ignore this email — nobody can sign in without the code.",
    sentBecause: "Sent because someone entered this address in Ocean Live.",
    footer: "Ocean Live · independent app for the Fisker Ocean · oceanlive.org",
    credit: "Car drawing based on “{work}” by {author}, {license}, changed.",
    textIntro: "Your Ocean Live sign-in code is:",
  },
  de: {
    subject: (c) => `${c} ist dein Ocean-Live-Code`,
    preheader: (m) => `Gib ihn in der App ein, um dich anzumelden. Er gilt ${m} Minuten.`,
    label: "Anmeldecode",
    heading: "Hier ist dein Anmeldecode",
    intro: "Gib diesen Code in Ocean Live ein.",
    sentence: (c) => `Dein Anmeldecode für Ocean Live ist ${c}.`,
    expiry: (m) => `Er gilt ${m} Minuten.`,
    digits: "6 Ziffern",
    chips: (m) => [`Gilt ${m} Min.`, "Nur einmal gültig", "Niemals weitergeben"],
    ignore: "Nicht angefordert? Dann kannst du diese E-Mail ignorieren – ohne den Code kann sich niemand anmelden.",
    sentBecause: "Du bekommst diese E-Mail, weil jemand diese Adresse in Ocean Live eingegeben hat.",
    footer: "Ocean Live · unabhängige App für den Fisker Ocean · oceanlive.org",
    credit: "Autozeichnung nach „{work}“ von {author}, {license}, verändert.",
    textIntro: "Dein Anmeldecode für Ocean Live:",
  },
  nl: {
    subject: (c) => `${c} is je Ocean Live-code`,
    preheader: (m) => `Vul hem in de app in om in te loggen. Hij werkt ${m} minuten.`,
    label: "Inlogcode",
    heading: "Hier is je inlogcode",
    intro: "Vul deze code in Ocean Live in.",
    sentence: (c) => `Je inlogcode voor Ocean Live is ${c}.`,
    expiry: (m) => `Hij werkt ${m} minuten.`,
    digits: "6 cijfers",
    chips: (m) => [`Verloopt na ${m} min`, "Eenmalig te gebruiken", "Deel hem nooit"],
    ignore: "Niet aangevraagd? Dan kun je deze e-mail negeren – zonder de code kan niemand inloggen.",
    sentBecause: "Verstuurd omdat iemand dit adres in Ocean Live heeft ingevuld.",
    footer: "Ocean Live · onafhankelijke app voor de Fisker Ocean · oceanlive.org",
    credit: "Autotekening gebaseerd op “{work}” door {author}, {license}, aangepast.",
    textIntro: "Je inlogcode voor Ocean Live:",
  },
  fr: {
    subject: (c) => `${c} est votre code Ocean Live`,
    preheader: (m) => `Saisissez-le dans l'application pour vous connecter. Il est valable ${m} minutes.`,
    label: "Code de connexion",
    heading: "Voici votre code de connexion",
    intro: "Saisissez ce code dans Ocean Live.",
    sentence: (c) => `Votre code de connexion Ocean Live est ${c}.`,
    expiry: (m) => `Il est valable ${m} minutes.`,
    digits: "6 chiffres",
    chips: (m) => [`Expire dans ${m} min`, "Usage unique", "Ne le partagez jamais"],
    ignore: `Vous ne l'avez pas demandé${NBSP}? Ignorez simplement cet e-mail${NBSP}: personne ne peut se connecter sans le code.`,
    sentBecause: "Envoyé parce que quelqu'un a saisi cette adresse dans Ocean Live.",
    footer: "Ocean Live · application indépendante pour le Fisker Ocean · oceanlive.org",
    credit: `Dessin de la voiture d’après «${NBSP}{work}${NBSP}» par {author}, {license}, modifié.`,
    textIntro: "Votre code de connexion Ocean Live :",
  },
  es: {
    subject: (c) => `${c} es tu código de Ocean Live`,
    preheader: (m) => `Introdúcelo en la app para entrar. Sirve durante ${m} minutos.`,
    label: "Código de acceso",
    heading: "Aquí tienes tu código",
    intro: "Introduce este código en Ocean Live.",
    sentence: (c) => `Tu código para entrar en Ocean Live es ${c}.`,
    expiry: (m) => `Sirve durante ${m} minutos.`,
    digits: "6 dígitos",
    chips: (m) => [`Caduca en ${m} min`, "Un solo uso", "No lo compartas"],
    ignore: "¿No lo has pedido? Puedes ignorar este correo: nadie puede entrar sin el código.",
    sentBecause: "Te llega porque alguien escribió esta dirección en Ocean Live.",
    footer: "Ocean Live · app independiente para el Fisker Ocean · oceanlive.org",
    credit: "Dibujo del coche basado en «{work}» de {author}, {license}, modificado.",
    textIntro: "Tu código para entrar en Ocean Live:",
  },
};

/** The email language for an Accept-Language header (first tag only, English otherwise). */
export function emailLang(acceptLanguage: string): EmailLang {
  const lang = acceptLanguage.slice(0, 2).toLowerCase();
  return lang in STRINGS ? (lang as EmailLang) : "en";
}

// Served by the site (site/site/public/email/header.png). Deploy the site first and check this URL returns
// 200 with Content-Type image/png before deploying the worker, or every sign-in email links a missing image.
export const HEADER_IMAGE = "https://oceanlive.org/email/header.png";
/** The app icon (rounded, 96 px PNG for 32 px display). Served from the website like the banner. */
export const LOGO_IMAGE = "https://oceanlive.org/icons/logo-rounded-96.png";
const SITE = "https://oceanlive.org";

// The banner's car is derived from a CC BY 4.0 model; the licence asks for title, author, source, licence
// and a note that it was changed.
const CREDIT = {
  work: "Fisker Ocean (low-poly)",
  workUrl: "https://sketchfab.com/3d-models/fisker-ocean-low-poly-f506bfe876864c04b68bdfc59070739a",
  author: "LagzDesign",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
};

/** Fills the credit template; `wrap` turns the work title and licence name into links (HTML only). */
function credit(t: Strings, wrap?: (label: string, href: string) => string): string {
  const e = wrap ? esc : (s: string) => s;
  // Split on the tokens first so only the template text is escaped, never the generated markup.
  return t.credit
    .split(/(\{work\}|\{author\}|\{license\})/)
    .map((part) => {
      if (part === "{work}") return wrap ? wrap(CREDIT.work, CREDIT.workUrl) : CREDIT.work;
      if (part === "{author}") return e(CREDIT.author);
      if (part === "{license}") return wrap ? wrap(CREDIT.license, CREDIT.licenseUrl) : CREDIT.license;
      return e(part);
    })
    .join("");
}

// Palette (design-system/ocean-live/pages/home.md). Contrast on the surfaces used:
// ink #EAF4FF ≈ 13:1 on #0E2C50, muted #A9C4E0 ≈ 7.5:1 on #0E2C50 and ≈ 9:1 on #071A33, cyan #5CE1E6 ≈ 9:1 on #071A33.
const C = {
  page: "#061428",
  paper: "#0B2545",
  panel: "#0E2C50",
  deep: "#071A33",
  ink: "#EAF4FF",
  muted: "#A9C4E0",
  cyan: "#5CE1E6",
  glass: "#7FE7C9",
  coral: "#FF8A7A",
  line: "#1E4672",
};

const SANS = "'Space Grotesk','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BODY = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Roboto Mono','Liberation Mono','Courier New',monospace";

export function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Builds the sign-in email for a 6-digit code that works for `minutes`. */
export function signInEmail(lang: EmailLang, code: string, minutes: number): SignInEmail {
  const t = STRINGS[lang] ?? STRINGS.en;
  const subject = t.subject(code);
  const text = [
    t.textIntro,
    "",
    code,
    "",
    `${t.expiry(minutes)} ${t.chips(minutes).slice(1).join(". ")}.`,
    "",
    t.ignore,
    "",
    "--",
    t.sentBecause,
    t.footer.replace("oceanlive.org", SITE),
    "",
    credit(t),
    CREDIT.workUrl,
    CREDIT.licenseUrl,
    "",
  ].join("\n");
  return { subject, text, html: html(lang, t, code, minutes) };
}

function html(lang: EmailLang, t: Strings, code: string, minutes: number): string {
  const [chip1, chip2, chip3] = t.chips(minutes);
  const footer = esc(t.footer).replace(
    "oceanlive.org",
    `<a href="${SITE}" style="color:${C.cyan};text-decoration:underline">oceanlive.org</a>`,
  );
  const creditHtml = credit(
    t,
    (label, href) => `<a href="${href}" style="color:${C.muted};text-decoration:underline">${esc(label)}</a>`,
  );
  // Letter-spacing of the code; the left padding is larger by the same amount so the six glyphs (and the gap
  // between digits 3 and 4, where the thin centre line sits) are optically centred.
  const LS = 12;
  // Chips use the "hybrid" pattern so they work without the <style> block (e.g. Gmail app with a non-Gmail
  // account): inline-block boxes at most 160px wide sit three across in the 480px panel and wrap into a
  // centred stack on narrow screens on their own. The media query only widens them to full rows on phones,
  // and Outlook desktop (no inline-block) gets a fixed 3-column table through conditional comments.
  const chip = (glyph: string, label: string) =>
    `<div class="chipw" style="display:inline-block;width:100%;max-width:160px;vertical-align:top">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0 4px 8px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate">` +
    `<tr><td align="center" bgcolor="${C.deep}" style="background-color:${C.deep};border:1px solid ${C.line};border-radius:18px;padding:9px 10px;font-family:${BODY};font-size:14px;line-height:18px;color:${C.ink};mso-line-height-rule:exactly">` +
    `<span aria-hidden="true" style="color:${C.cyan};font-family:${MONO};font-size:14px">${glyph}</span>${NBSP}<span class="ink">${esc(label)}</span>` +
    `</td></tr></table></td></tr></table></div>`;
  // One half of the dimension line under the code, with an arrow-like end stop.
  const dimLine = (side: "left" | "right") =>
    `<td width="45%" valign="middle" style="font-size:0;line-height:0">` +
    `<div style="height:7px;border-${side}:1px solid ${C.coral};font-size:0;line-height:0;margin-top:0">` +
    `<div style="height:4px;border-bottom:1px solid ${C.coral};font-size:0;line-height:0">&nbsp;</div></div></td>`;
  // Spacer cells carry an explicit pixel line height with mso-line-height-rule:exactly: Outlook's Word engine
  // ignores font-size:0/line-height:0 and would otherwise grow them to a full text line.
  const tick = (sides: string) =>
    `<td width="14" height="14" style="width:14px;height:14px;font-size:14px;line-height:14px;mso-line-height-rule:exactly;${sides}">&nbsp;</td>`;
  const tickGap = `<td style="font-size:14px;line-height:14px;mso-line-height-rule:exactly">&nbsp;</td>`;

  return `<!DOCTYPE html>
<html lang="${esc(lang)}" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(t.subject(code))}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style>body,table,td,p,h1,a,span{font-family:'Segoe UI',Arial,sans-serif !important}.code{font-family:Consolas,'Courier New',monospace !important}</style><![endif]-->
<!-- Two style blocks on purpose: Gmail drops a whole <style> block if it rejects anything in it, so the
     layout rules (plain classes + one media query) are kept apart from the dark-mode / client-hack selectors. -->
<style>
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
@media only screen and (max-width:600px){
 .px{padding-left:20px!important;padding-right:20px!important}
 .h1{font-size:25px!important;line-height:32px!important}
 .code{font-size:34px!important;letter-spacing:8px!important;padding-left:8px!important;padding-right:0!important}
 .chipw{display:block!important;max-width:100%!important}
 .band-label{display:block!important;text-align:left!important;padding-top:0!important}
 .band-mark{display:block!important;padding-bottom:6px!important}
}
</style>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
/* The design is dark in both schemes; pin the colours so clients that recolour in dark mode keep them. */
@media (prefers-color-scheme:dark){
 .bg-page{background-color:${C.page}!important}
 .bg-panel{background-color:${C.panel}!important}
 .ink{color:${C.ink}!important}
 .muted{color:${C.muted}!important}
}
[data-ogsc] .ink{color:${C.ink}!important}
[data-ogsc] .muted{color:${C.muted}!important}
[data-ogsc] .cyan{color:${C.cyan}!important}
</style>
</head>
<body class="bg-page" style="margin:0;padding:0;background-color:${C.page};word-spacing:normal">
<div role="article" aria-roledescription="email" aria-label="${esc(t.subject(code))}" lang="${esc(lang)}" style="background-color:${C.page}">
<!-- preheader -->
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page}">${esc(t.preheader(minutes))}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" class="bg-page" style="background-color:${C.page}">
<tr><td align="center" style="padding:24px 12px 32px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;border-collapse:separate">

<!-- top band: wordmark on a blueprint grid -->
<tr><td bgcolor="${C.deep}" style="background-color:${C.deep};background-image:linear-gradient(rgba(173,216,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(173,216,255,.07) 1px,transparent 1px);background-size:16px 16px;border-radius:16px 16px 0 0">
<!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:560px;height:58px"><v:fill type="gradient" color="${C.deep}" color2="${C.paper}" angle="90"/><v:textbox inset="0,0,0,0"><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td class="px band-mark" valign="middle" style="padding:18px 28px;font-family:${SANS};font-size:15px;line-height:22px;font-weight:700;letter-spacing:3px;color:${C.ink};text-transform:uppercase;white-space:nowrap"><img src="${LOGO_IMAGE}" width="32" height="32" alt="" style="display:inline-block;width:32px;height:32px;border:0;outline:none;vertical-align:middle;border-radius:7px"><span aria-hidden="true">&nbsp;&nbsp;</span><span class="ink">Ocean Live</span></td>
<td class="px band-label" align="right" valign="middle" style="padding:18px 28px 18px 0;font-family:${BODY};font-size:12px;line-height:16px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${C.cyan}"><span class="cyan">${esc(t.label)}</span></td>
</tr>
</table>
<!--[if mso]></v:textbox></v:rect><![endif]-->
</td></tr>

<!-- hero banner (navy cell + large ink alt text when images are blocked) -->
<tr><td bgcolor="${C.paper}" align="center" style="background-color:${C.paper};font-size:0;line-height:0">
<img src="${HEADER_IMAGE}" width="560" alt="Ocean Live" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;text-decoration:none;background-color:${C.paper};color:${C.ink};font-family:${SANS};font-size:28px;line-height:36px;font-weight:700;text-align:center">
</td></tr>

<!-- light bar: cyan to sea-glass -->
<tr><td height="4" bgcolor="${C.cyan}" style="height:4px;font-size:4px;line-height:4px;mso-line-height-rule:exactly;background-color:${C.cyan};background-image:linear-gradient(90deg,${C.cyan},${C.glass} 60%,${C.cyan})"><!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:560px;height:4px"><v:fill type="gradient" color="${C.cyan}" color2="${C.glass}" angle="90"/></v:rect><![endif]--><!--[if !mso]><!-->&nbsp;<!--<![endif]--></td></tr>

<!-- body panel -->
<tr><td class="bg-panel px" bgcolor="${C.panel}" style="background-color:${C.panel};padding:36px 40px 4px">
<h1 class="h1 ink" style="margin:0 0 10px;font-family:${SANS};font-size:30px;line-height:38px;font-weight:700;letter-spacing:-0.3px;color:${C.ink};mso-line-height-rule:exactly">${esc(t.heading)}</h1>
<p class="muted" style="margin:0 0 26px;font-family:${BODY};font-size:17px;line-height:27px;color:${C.muted}">${esc(t.intro)}</p>

<!-- the code: dimension box with corner ticks and a cyan glow -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.deep}" style="background-color:${C.deep};border:1px solid ${C.cyan};border-radius:14px;border-collapse:separate;box-shadow:0 0 0 4px rgba(92,225,230,.10),0 0 28px rgba(92,225,230,.28)">
<tr aria-hidden="true">${tick(`border-top:2px solid ${C.coral};border-left:2px solid ${C.coral}`)}${tickGap}${tick(`border-top:2px solid ${C.coral};border-right:2px solid ${C.coral}`)}</tr>
<tr><td colspan="3" align="center" class="code" style="padding:14px 0 14px ${LS}px;font-family:${MONO};font-size:40px;line-height:48px;font-weight:700;letter-spacing:${LS}px;color:${C.ink};font-variant-numeric:tabular-nums;background-image:linear-gradient(90deg,transparent 49.8%,rgba(92,225,230,.45) 49.8%,rgba(92,225,230,.45) 50.2%,transparent 50.2%);mso-line-height-rule:exactly"><span class="ink">${esc(code)}</span></td></tr>
<!-- dimension line: nested-div drawing, hidden from Outlook desktop, which cannot size it -->
<!--[if !mso]><!-->
<tr aria-hidden="true"><td colspan="3" style="padding:0 22px 4px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${dimLine("left")}
<td align="center" valign="middle" style="padding:0 10px;font-family:${BODY};font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:${C.coral};white-space:nowrap">${esc(t.digits)}</td>
${dimLine("right")}
</tr></table>
</td></tr>
<!--<![endif]-->
<tr aria-hidden="true">${tick(`border-bottom:2px solid ${C.coral};border-left:2px solid ${C.coral}`)}${tickGap}${tick(`border-bottom:2px solid ${C.coral};border-right:2px solid ${C.coral}`)}</tr>
</table>

<p class="muted" style="margin:18px 0 22px;font-family:${BODY};font-size:16px;line-height:25px;color:${C.muted};text-align:center">${esc(t.sentence(code))} ${esc(t.expiry(minutes))}</p>

<!-- spec chips -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" style="font-size:0;line-height:0;text-align:center">
<!--[if mso]><table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0"><tr><td width="160" valign="top"><![endif]-->
${chip("&#9719;", chip1)}
<!--[if mso]></td><td width="160" valign="top"><![endif]-->
${chip("1&#215;", chip2)}
<!--[if mso]></td><td width="160" valign="top"><![endif]-->
${chip("&#8856;", chip3)}
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr></table>
</td></tr>

<!-- not you? -->
<tr><td class="bg-panel px" bgcolor="${C.panel}" style="background-color:${C.panel};padding:20px 40px 34px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="3" bgcolor="${C.glass}" style="width:3px;background-color:${C.glass};border-radius:2px;font-size:1px;line-height:1px;mso-line-height-rule:exactly">&nbsp;</td>
<td class="muted" style="padding:2px 0 2px 16px;font-family:${BODY};font-size:16px;line-height:25px;color:${C.muted}">${esc(t.ignore)}</td>
</tr></table>
</td></tr>

<!-- footer, with a thin light-bar divider -->
<tr><td height="1" bgcolor="${C.line}" style="height:1px;font-size:1px;line-height:1px;mso-line-height-rule:exactly;background-color:${C.line};background-image:linear-gradient(90deg,${C.deep},${C.cyan} 50%,${C.deep})">&nbsp;</td></tr>
<tr><td class="px" bgcolor="${C.deep}" align="center" style="background-color:${C.deep};padding:22px 40px 26px;border-radius:0 0 16px 16px;font-family:${BODY};font-size:13px;line-height:21px;color:${C.muted}">
<p class="muted" style="margin:0 0 6px;font-family:${BODY};font-size:13px;line-height:21px;color:${C.muted}">${footer}</p>
<p class="muted" style="margin:0;font-family:${BODY};font-size:13px;line-height:21px;color:${C.muted}">${esc(t.sentBecause)}</p>
<p class="muted" style="margin:10px 0 0;font-family:${BODY};font-size:12px;line-height:18px;color:${C.muted}">${creditHtml}</p>
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`;
}
