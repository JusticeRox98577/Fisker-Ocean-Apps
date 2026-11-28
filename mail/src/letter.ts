/**
 * Every email sent from an oceanlive.org address gets the Ocean Live look (the same shell as the news
 * emails: logo band, header picture, light bar, dark panel, footer). Webmail and the Notify service
 * (hardware sign-in links, beta invitations, pre-order emails) send plain text; this turns that text
 * into the branded HTML part. The plain text is sent alongside, unchanged.
 *
 *   - paragraphs are separated by blank lines; single line breaks are kept;
 *   - a link alone on its own line becomes a button (with the link written out under it), any other
 *     link is clickable;
 *   - lines quoted with "> " (replies) are shown as a quote;
 *   - the footer says who sent it: Ocean Live LLC and oceanlive.org.
 */
import { BODY, button, C, frame } from "./list-email";
import { escapeHtml as esc } from "./util";

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;
const SITE = "https://oceanlive.org";

// EDIT: the button text for links that stand on their own line, by what they open.
const BUTTONS: [RegExp, string][] = [
  [/\/admin#login=/, "Sign in"],
  [/\/invite#/, "Open your invitation"],
  [/\/reservation#/, "View your reservation"],
  [/\/list\/confirm/, "Confirm"],
  [/\/list\/unsubscribe/, "Unsubscribe"],
  [/^https:\/\/(?:preorder\.)?oceanlive\.org\/?$/, "Open oceanlive.org"],
];

function buttonLabel(url: string): string {
  for (const [re, label] of BUTTONS) if (re.test(url)) return label;
  return "Open the link";
}

function linkify(line: string): string {
  // escape first, then link the (already escaped) URLs; URLs have no characters that escaping changes
  // except "&", which escapes to "&amp;" and still works as an href
  return esc(line).replace(URL_RE, (u) => `<a href="${u}" style="color:${C.cyan};text-decoration:underline">${u}</a>`);
}

// a function, not a constant: list-email.ts and send.ts import each other, so C isn't ready at load time
const P = () => `margin:0 0 16px;font-family:${BODY};font-size:16px;line-height:25px;color:${C.ink}`;

function paragraph(lines: string[]): string {
  const only = lines.length === 1 ? lines[0].trim() : "";
  if (only && /^https?:\/\/\S+$/.test(only)) {
    return (
      `<div style="margin:4px 0 20px">${button(buttonLabel(only), only)}</div>` +
      `<p style="margin:-8px 0 18px;font-family:${BODY};font-size:13px;line-height:20px;color:${C.muted};word-break:break-all">` +
      `<a href="${esc(only)}" style="color:${C.muted};text-decoration:underline">${esc(only)}</a></p>`
    );
  }
  if (lines.every((l) => /^\s*>/.test(l))) {
    const inner = lines.map((l) => linkify(l.replace(/^\s*>\s?/, ""))).join("<br>");
    return (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px"><tr>` +
      `<td width="3" bgcolor="${C.line}" style="width:3px;background-color:${C.line};font-size:1px;line-height:1px">&nbsp;</td>` +
      `<td style="padding:2px 0 2px 14px;font-family:${BODY};font-size:14px;line-height:22px;color:${C.muted}">${inner}</td>` +
      `</tr></table>`
    );
  }
  return `<p style="${P()}">${lines.map(linkify).join("<br>")}</p>`;
}

/** The branded HTML for a plain-text email. `label` is the small tag at the top right (e.g. "Nova beta"). */
export function letterHtml(text: string, subject: string, label = ""): string {
  const paras: string[][] = [];
  let cur: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (raw.trim() === "") {
      if (cur.length) paras.push(cur);
      cur = [];
    } else cur.push(raw.replace(/\s+$/, ""));
  }
  if (cur.length) paras.push(cur);
  const body = paras.map(paragraph).join("\n") || `<p style="${P()}">&nbsp;</p>`;
  const footer =
    `<p style="margin:0;font-family:${BODY};font-size:13px;line-height:21px;color:${C.muted}">` +
    `Ocean Live LLC · <a href="${SITE}" style="color:${C.cyan};text-decoration:underline">oceanlive.org</a></p>`;
  return frame("en", subject || "Ocean Live", label, body, [footer]);
}
