import { describe, expect, it } from "vitest";
import { bodyCsp, sanitizeHtml, schemeOf } from "../src/sanitize";

const clean = async (html: string, allowRemote = false, cid?: Map<string, string>) => (await sanitizeHtml(html, { allowRemote, cid })).html;

describe("sanitizeHtml", () => {
  it("removes scripts, frames, objects, forms controls and event handlers", async () => {
    const out = await clean(
      '<div onclick="x()" onMouseOver="y()">Hi<script>alert(1)</script><iframe src="https://e.com"></iframe>' +
        '<object data="x"></object><embed src="x"><form action="https://evil"><input name=p><button>Go</button>keep</form>' +
        '<svg><script>alert(2)</script></svg><meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil/"></div>',
    );
    expect(out).not.toMatch(/script|iframe|object|embed|<form|<input|<button|<svg|<meta|<base|onclick|onmouseover|alert/i);
    expect(out).toContain("Hi");
    expect(out).toContain("keep");
  });

  it("drops dangerous link schemes, even when obfuscated", async () => {
    const out = await clean(
      '<a href="javascript:alert(1)">a</a><a href="  JaVa\tScRiPt:alert(1)">b</a><a href="data:text/html,x">c</a>' +
        '<a href="vbscript:x">d</a><a href="https://ok.example/">e</a><a href="mailto:a@b.c">f</a>',
    );
    expect(out).not.toMatch(/javascript|vbscript|data:text/i);
    expect(out).toContain('href="https://ok.example/"');
    expect(out).toContain('href="mailto:a@b.c"');
  });

  it("opens links in a new tab without a referrer", async () => {
    const out = await clean('<a href="https://ok.example/" target="_self" rel="opener">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain("_self");
  });

  it("blocks remote images by default and counts them", async () => {
    const r = await sanitizeHtml(
      '<img src="https://t.example/p.gif"><img src="//t.example/q.gif"><table background="http://t.example/bg.png"></table>' +
        '<img srcset="https://t.example/a.png 2x"><div style="background:url(https://t.example/c.png)"></div>' +
        "<style>body{background:url('https://t.example/d.png')}</style>",
      { allowRemote: false },
    );
    expect(r.html).not.toMatch(/src="(https?:)?\/\/|background="http|srcset=/);
    expect(r.html).toContain("data-blocked");
    expect(r.remote).toBe(6);
  });

  it("keeps remote images when asked", async () => {
    const out = await clean('<img src="https://t.example/p.gif">', true);
    expect(out).toContain('src="https://t.example/p.gif"');
  });

  it("replaces cid: images with data URIs and drops unknown ones", async () => {
    const cid = new Map([["logo@ex", "data:image/png;base64,AAAA"]]);
    const out = await clean('<img src="cid:logo@ex"><img src="cid:missing@ex">', false, cid);
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out).not.toContain("cid:");
  });

  it("allows only image data: URIs", async () => {
    const out = await clean('<img src="data:image/gif;base64,R0lG"><img src="data:text/html;base64,PHNjcmlwdD4=">');
    expect(out).toContain("data:image/gif");
    expect(out).not.toContain("data:text/html");
  });

  it("strips CSS imports and expressions", async () => {
    const out = await clean('<style>@import url(https://e/x.css); p{color:red}</style><p style="width:expression(alert(1))">x</p>');
    expect(out).not.toMatch(/@import|expression/);
    expect(out).toContain("color:red");
  });

  it("removes comments", async () => {
    expect(await clean("<p>a<!-- secret --></p>")).toBe("<p>a</p>");
  });
});

describe("schemeOf", () => {
  it("sees through whitespace and control characters", () => {
    expect(schemeOf(" java\nscript:x")).toBe("javascript");
    expect(schemeOf("//cdn.example/x")).toBe("https");
    expect(schemeOf("/relative")).toBe("");
  });
});

describe("bodyCsp", () => {
  it("is sandboxed and blocks remote loads unless images are allowed", () => {
    const off = bodyCsp(false);
    expect(off).toContain("default-src 'none'");
    expect(off).toMatch(/sandbox allow-popups allow-popups-to-escape-sandbox/);
    expect(off).not.toContain("allow-scripts");
    expect(off).not.toContain("allow-same-origin");
    expect(off).toContain("img-src data:;");
    expect(bodyCsp(true)).toContain("img-src data: https: http:");
  });
});
