/**
 * Mail HTML is shown in a sandboxed iframe (no scripts, opaque origin) served with a strict CSP.
 * This sanitizer is the second wall: it drops active content, blocks remote images unless asked,
 * inlines cid: images as data: URIs and makes every link open in a new tab without a referrer.
 */

export interface SanitizeOptions {
  /** Load images and other resources from the internet. */
  allowRemote: boolean;
  /** Content-ID (without < >) -> data: URI, for inline images. */
  cid?: Map<string, string>;
}

export interface SanitizeResult {
  html: string;
  /** Remote images, backgrounds or CSS url()s in the message (blocked unless allowRemote). */
  remote: number;
}

/** Elements removed together with everything inside them. */
const DROP =
  "script,iframe,frame,frameset,object,embed,applet,noscript,template,meta,link,base,svg,math,portal," +
  "input,button,select,textarea,option,video,audio,source,track,canvas,dialog,slot,title";
/** Elements removed but whose content stays. */
const UNWRAP = "form,label,fieldset,legend";

const URL_ATTRS = new Set(["href", "src", "background", "poster", "cite", "longdesc", "lowsrc", "dynsrc", "action", "data", "xlink:href", "srcset", "formaction"]);
const ALWAYS_DROP_ATTRS = new Set(["srcdoc", "formaction", "action", "ping", "http-equiv", "autofocus", "contenteditable", "nonce", "integrity", "is"]);
const SAFE_DATA_IMAGE = /^data:image\/(png|gif|jpe?g|webp|bmp|avif);/i;
const CSS_REMOTE = /url\(\s*['"]?\s*(?:https?:)?\/\//gi;

/** Scheme of a URL as a browser would see it (control characters and whitespace ignored). */
export function schemeOf(value: string): string {
  const v = value.replace(/[\u0000- \u007f]+/g, "").toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(v);
  if (m) return m[1];
  if (v.startsWith("//")) return "https";
  return "";
}

export async function sanitizeHtml(input: string, opts: SanitizeOptions): Promise<SanitizeResult> {
  let remote = 0;

  const rewriter = new HTMLRewriter()
    .onDocument({
      comments(c) {
        c.remove();
      },
      doctype() {},
    })
    .on(DROP, {
      element(el) {
        el.remove();
      },
    })
    .on(UNWRAP, {
      element(el) {
        el.removeAndKeepContent();
      },
    })
    .on("style", {
      text(t) {
        const n = t.text.match(CSS_REMOTE)?.length ?? 0;
        remote += n;
        if (/@import|expression\s*\(|behavior\s*:|-moz-binding/i.test(t.text)) {
          t.replace(t.text.replace(/@import[^;]*;?|expression\s*\(|behavior\s*:|-moz-binding/gi, ""), { html: false });
        }
      },
    })
    .on("*", {
      element(el) {
        const attrs = [...el.attributes];
        for (const [rawName, value] of attrs) {
          const name = rawName.toLowerCase();
          if (name.startsWith("on") || ALWAYS_DROP_ATTRS.has(name) || name.startsWith("xmlns")) {
            el.removeAttribute(rawName);
            continue;
          }
          if (name === "style") {
            remote += value.match(CSS_REMOTE)?.length ?? 0;
            if (/expression\s*\(|behavior\s*:|-moz-binding|javascript:/i.test(value)) el.removeAttribute(rawName);
            continue;
          }
          if (!URL_ATTRS.has(name)) continue;
          const scheme = schemeOf(value);

          if (name === "href" || name === "xlink:href") {
            if (value.trim().startsWith("#")) continue;
            if (!["http", "https", "mailto", "tel"].includes(scheme)) el.removeAttribute(rawName);
            continue;
          }
          if (name === "srcset") {
            const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
            if (parts.length) remote++;
            if (!opts.allowRemote || !parts.every((p) => ["http", "https"].includes(schemeOf(p)))) el.removeAttribute(rawName);
            continue;
          }
          // src, background, poster, ... : something the browser would load.
          if (scheme === "cid") {
            const id = decodeURIComponent(value.trim().slice(4)).replace(/^<|>$/g, "").toLowerCase();
            const uri = opts.cid?.get(id);
            if (uri) el.setAttribute(rawName, uri);
            else el.removeAttribute(rawName);
          } else if (scheme === "http" || scheme === "https") {
            remote++;
            if (!opts.allowRemote) {
              el.removeAttribute(rawName);
              if (name === "src") el.setAttribute("data-blocked", "");
            }
          } else if (scheme === "data" && SAFE_DATA_IMAGE.test(value.trim())) {
            // fine
          } else {
            el.removeAttribute(rawName);
          }
        }
        if (el.tagName === "a" && el.hasAttribute("href")) {
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        }
      },
    });

  const html = await rewriter.transform(new Response(input, { headers: { "Content-Type": "text/html; charset=utf-8" } })).text();
  return { html, remote };
}

/** The Content-Security-Policy for a message body document. */
export function bodyCsp(allowRemote: boolean): string {
  return [
    "default-src 'none'",
    `img-src data:${allowRemote ? " https: http:" : ""}`,
    "style-src 'unsafe-inline'",
    "font-src data:",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-popups allow-popups-to-escape-sandbox",
  ].join("; ");
}

/** A complete document around sanitized mail HTML: white paper, images that fit. */
export function bodyDocument(sanitized: string): string {
  return (
    '<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light">' +
    '<meta name="referrer" content="no-referrer">' +
    "<style>html{background:#fff;color:#111;font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}" +
    "body{margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}" +
    "img[data-blocked]{display:inline-block;min-width:1px;min-height:1px}pre{white-space:pre-wrap}</style>" +
    sanitized
  );
}
