/**
 * Mailing-list emails: the sign-up confirmation (five languages) and the news email the owner writes.
 *
 * Same look as the app's sign-in email (ask-proxy/src/email.ts): blueprint navy, the hosted banner, table
 * layout with inline styles, no scripts, no tracking. It is copied in a smaller form, not imported, because
 * the two Workers are separate packages.
 */
import { textToHtml } from "./send";
import { escapeHtml as esc } from "./util";

export type ListLang = "en" | "de" | "fr" | "es" | "nl";
export const LIST_LANGS: readonly ListLang[] = ["en", "de", "fr", "es", "nl"];

export function listLang(input: unknown): ListLang {
  const l = String(input ?? "").slice(0, 2).toLowerCase();
  return (LIST_LANGS as readonly string[]).includes(l) ? (l as ListLang) : "en";
}

export interface Email {
  subject: string;
  text: string;
  html: string;
}

// Served by the site, like the sign-in email's banner.
const HEADER_IMAGE = "https://oceanlive.org/email/header.png";
const LOGO_IMAGE = "https://oceanlive.org/icons/logo-rounded-96.png";

// Palette: same values and contrast pairs as the sign-in email.
const C = {
  page: "#061428",
  paper: "#0B2545",
  panel: "#0E2C50",
  deep: "#071A33",
  ink: "#EAF4FF",
  muted: "#A9C4E0",
  cyan: "#5CE1E6",
  glass: "#7FE7C9",
  onAccent: "#04223A",
  line: "#1E4672",
};
const SANS = "'Space Grotesk','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BODY = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

interface ConfirmStrings {
  subject: string;
  label: string;
  heading: string;
  intro: string;
  button: string;
  orLink: string;
  expiry: string;
  ignore: string;
  footer: string;
}

const CONFIRM: Record<ListLang, ConfirmStrings> = {
  en: {
    subject: "Confirm your Ocean Live news sign-up",
    label: "Ocean Live news",
    heading: "Confirm your sign-up",
    intro:
      "Someone asked to get Ocean Live news at this address: an email when there's a new release or an important fix. A few emails a year, no ads.",
    button: "Confirm my subscription",
    orLink: "Or open this link:",
    expiry: "The link works for 7 days.",
    ignore: "If you didn't ask for this, ignore this email and you won't hear from us.",
    footer: "Ocean Live · independent app for the Fisker Ocean · oceanlive.org",
  },
  de: {
    subject: "Bestätige deine Anmeldung für Ocean-Live-News",
    label: "Ocean-Live-News",
    heading: "Bestätige deine Anmeldung",
    intro:
      "Jemand hat Ocean-Live-News für diese Adresse angefordert: eine E-Mail, wenn es eine neue Version oder eine wichtige Fehlerbehebung gibt. Ein paar E-Mails im Jahr, keine Werbung.",
    button: "Anmeldung bestätigen",
    orLink: "Oder öffne diesen Link:",
    expiry: "Der Link gilt 7 Tage.",
    ignore: "Wenn du das nicht angefordert hast, ignoriere diese E-Mail. Dann hörst du nichts mehr von uns.",
    footer: "Ocean Live · unabhängige App für den Fisker Ocean · oceanlive.org",
  },
  fr: {
    subject: "Confirmez votre inscription aux nouvelles d'Ocean Live",
    label: "Nouvelles d'Ocean Live",
    heading: "Confirmez votre inscription",
    intro:
      "Quelqu'un a demandé à recevoir les nouvelles d'Ocean Live à cette adresse : un e-mail à chaque nouvelle version ou correction importante. Quelques e-mails par an, sans publicité.",
    button: "Confirmer mon inscription",
    orLink: "Ou ouvrez ce lien :",
    expiry: "Le lien est valable 7 jours.",
    ignore: "Si vous n'avez rien demandé, ignorez cet e-mail : vous n'aurez plus de nouvelles de nous.",
    footer: "Ocean Live · application indépendante pour le Fisker Ocean · oceanlive.org",
  },
  es: {
    subject: "Confirma tu suscripción a las novedades de Ocean Live",
    label: "Novedades de Ocean Live",
    heading: "Confirma tu suscripción",
    intro:
      "Alguien pidió recibir las novedades de Ocean Live en esta dirección: un correo cuando haya una nueva versión o una corrección importante. Pocos correos al año, sin publicidad.",
    button: "Confirmar mi suscripción",
    orLink: "O abre este enlace:",
    expiry: "El enlace sirve durante 7 días.",
    ignore: "Si no lo pediste, ignora este correo y no volverás a saber de nosotros.",
    footer: "Ocean Live · app independiente para el Fisker Ocean · oceanlive.org",
  },
  nl: {
    subject: "Bevestig je aanmelding voor Ocean Live-nieuws",
    label: "Ocean Live-nieuws",
    heading: "Bevestig je aanmelding",
    intro:
      "Iemand heeft Ocean Live-nieuws aangevraagd voor dit adres: een e-mail bij een nieuwe versie of een belangrijke oplossing. Een paar e-mails per jaar, geen reclame.",
    button: "Aanmelding bevestigen",
    orLink: "Of open deze link:",
    expiry: "De link werkt 7 dagen.",
    ignore: "Heb je dit niet aangevraagd? Negeer deze e-mail, dan hoor je niets meer van ons.",
    footer: "Ocean Live · onafhankelijke app voor de Fisker Ocean · oceanlive.org",
  },
};

/** The double opt-in email. `link` carries the token in its #fragment. */
export function confirmEmail(lang: ListLang, link: string, site: string): Email {
  const t = CONFIRM[lang] ?? CONFIRM.en;
  const text = [t.heading, "", t.intro, "", `${t.button}:`, link, "", t.expiry, "", t.ignore, "", "--", t.footer.replace("oceanlive.org", site), ""].join(
    "\n",
  );
  const body =
    `<h1 style="margin:0 0 12px;font-family:${SANS};font-size:28px;line-height:36px;font-weight:700;color:${C.ink}">${esc(t.heading)}</h1>` +
    `<p style="margin:0 0 24px;font-family:${BODY};font-size:17px;line-height:27px;color:${C.muted}">${esc(t.intro)}</p>` +
    button(t.button, link) +
    `<p style="margin:22px 0 4px;font-family:${BODY};font-size:14px;line-height:22px;color:${C.muted}">${esc(t.orLink)}</p>` +
    `<p style="margin:0 0 18px;font-family:${BODY};font-size:14px;line-height:22px;word-break:break-all"><a href="${esc(link)}" style="color:${C.cyan}">${esc(link)}</a></p>` +
    `<p style="margin:0 0 18px;font-family:${BODY};font-size:15px;line-height:24px;color:${C.muted}">${esc(t.expiry)}</p>` +
    note(t.ignore);
  const footer = footerLine(t.footer, site);
  return { subject: t.subject, text, html: frame(lang, t.subject, t.label, body, [footer]) };
}

export interface CampaignParts {
  subject: string;
  text: string;
  /** The page link for people (token in the #fragment). */
  unsubscribePage: string;
  postalAddress: string;
  site: string;
}

/** A news email: the owner's text plus the required footer (why you get it, unsubscribe, postal address). */
export function campaignEmail(p: CampaignParts): Email {
  const why = "You signed up for Ocean Live news at oceanlive.org.";
  const postal = p.postalAddress.trim();
  const text = [
    p.text.replace(/\r\n?/g, "\n").trimEnd(),
    "",
    "--",
    why,
    `Unsubscribe: ${p.unsubscribePage}`,
    ...(postal ? [postal] : []),
    "",
  ].join("\n");
  // textToHtml is made for white backgrounds; recolour its links and quotes for the navy panel.
  const content = textToHtml(p.text)
    .replace(/<a href="/g, `<a style="color:${C.cyan}" href="`)
    .replace("color:#455", `color:${C.muted}`)
    .replace('<div style="', `<div style="color:${C.ink};`);
  const footer = [
    `<p style="margin:0 0 6px;font-family:${BODY};font-size:13px;line-height:21px;color:${C.muted}">${esc(why)}</p>`,
    `<p style="margin:0 0 6px;font-family:${BODY};font-size:13px;line-height:21px;color:${C.muted}"><a href="${esc(p.unsubscribePage)}" style="color:${C.cyan};text-decoration:underline">Unsubscribe</a></p>`,
    ...(postal ? [`<p style="margin:0;font-family:${BODY};font-size:12px;line-height:18px;color:${C.muted}">${esc(postal)}</p>`] : []),
  ];
  return { subject: p.subject, text, html: frame("en", p.subject, "Ocean Live news", content, footer) };
}

function button(label: string, href: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>` +
    `<td align="center" bgcolor="${C.cyan}" style="background-color:${C.cyan};border-radius:12px">` +
    `<a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-family:${BODY};font-size:16px;line-height:20px;font-weight:700;color:${C.onAccent};text-decoration:none;border-radius:12px">${esc(label)}</a>` +
    `</td></tr></table>`
  );
}

function note(text: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td width="3" bgcolor="${C.glass}" style="width:3px;background-color:${C.glass};border-radius:2px;font-size:1px;line-height:1px">&nbsp;</td>` +
    `<td style="padding:2px 0 2px 16px;font-family:${BODY};font-size:15px;line-height:24px;color:${C.muted}">${esc(text)}</td>` +
    `</tr></table>`
  );
}

function footerLine(footer: string, site: string): string {
  const linked = esc(footer).replace(
    "oceanlive.org",
    `<a href="${esc(site)}" style="color:${C.cyan};text-decoration:underline">oceanlive.org</a>`,
  );
  return `<p style="margin:0;font-family:${BODY};font-size:13px;line-height:21px;color:${C.muted}">${linked}</p>`;
}

/** The shared shell: logo band, banner, light bar, body panel, footer. `body` and `footer` must already be safe HTML. */
function frame(lang: string, title: string, label: string, body: string, footer: string[]): string {
  return `<!DOCTYPE html>
<html lang="${esc(lang)}" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
@media only screen and (max-width:600px){.px{padding-left:20px!important;padding-right:20px!important}}
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.page}">
<div role="article" aria-label="${esc(title)}" lang="${esc(lang)}" style="background-color:${C.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background-color:${C.page}">
<tr><td align="center" style="padding:24px 12px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;border-collapse:separate">
<tr><td bgcolor="${C.deep}" style="background-color:${C.deep};border-radius:16px 16px 0 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="px" valign="middle" style="padding:18px 28px;font-family:${SANS};font-size:15px;line-height:22px;font-weight:700;letter-spacing:3px;color:${C.ink};text-transform:uppercase;white-space:nowrap"><img src="${LOGO_IMAGE}" width="32" height="32" alt="" style="display:inline-block;width:32px;height:32px;border:0;vertical-align:middle;border-radius:7px">&nbsp;&nbsp;Ocean Live</td>
<td class="px" align="right" valign="middle" style="padding:18px 28px 18px 0;font-family:${BODY};font-size:12px;line-height:16px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${C.cyan}">${esc(label)}</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${C.paper}" align="center" style="background-color:${C.paper};font-size:0;line-height:0">
<img src="${HEADER_IMAGE}" width="560" alt="Ocean Live" style="display:block;width:100%;max-width:560px;height:auto;border:0;background-color:${C.paper};color:${C.ink};font-family:${SANS};font-size:28px;line-height:36px;font-weight:700;text-align:center">
</td></tr>
<tr><td height="4" bgcolor="${C.cyan}" style="height:4px;font-size:4px;line-height:4px;background-color:${C.cyan};background-image:linear-gradient(90deg,${C.cyan},${C.glass} 60%,${C.cyan})">&nbsp;</td></tr>
<tr><td class="px" bgcolor="${C.panel}" style="background-color:${C.panel};padding:32px 40px 32px;color:${C.ink};font-family:${BODY};font-size:16px;line-height:25px">
${body}
</td></tr>
<tr><td height="1" bgcolor="${C.line}" style="height:1px;font-size:1px;line-height:1px;background-color:${C.line}">&nbsp;</td></tr>
<tr><td class="px" bgcolor="${C.deep}" align="center" style="background-color:${C.deep};padding:22px 40px 26px;border-radius:0 0 16px 16px">
${footer.join("\n")}
</td></tr>
</table>
</td></tr>
</table>
</div>
</body>
</html>`;
}
