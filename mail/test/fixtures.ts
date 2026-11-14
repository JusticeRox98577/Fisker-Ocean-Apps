/** Raw messages for the tests. */

// 1x1 transparent PNG
export const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export function multipartMessage(opts: { messageId?: string; to?: string; extraHeaders?: string } = {}): string {
  const to = opts.to ?? "justice@oceanlive.org";
  return [
    'From: "Ada Driver" <ada@example.com>',
    `To: Justice <${to}>`,
    "Cc: support@oceanlive.org",
    "Subject: =?UTF-8?Q?Range_question_=E2=80=94_winter?=",
    `Message-ID: ${opts.messageId ?? "<abc123@example.com>"}`,
    "References: <first@example.com>",
    "In-Reply-To: <first@example.com>",
    "Date: Fri, 13 Nov 2026 10:00:00 +0000",
    "MIME-Version: 1.0",
    ...(opts.extraHeaders ? [opts.extraHeaders] : []),
    'Content-Type: multipart/mixed; boundary="mixed"',
    "",
    "--mixed",
    'Content-Type: multipart/related; boundary="rel"',
    "",
    "--rel",
    'Content-Type: multipart/alternative; boundary="alt"',
    "",
    "--alt",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi! How far does the Ocean go in winter?",
    "--alt",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<p onclick="steal()">Hi! <img src="cid:logo@ex"> <img src="https://tracker.example/p.gif"></p><script>alert(1)</script>',
    "--alt--",
    "--rel",
    "Content-Type: image/png",
    "Content-ID: <logo@ex>",
    "Content-Disposition: inline",
    "Content-Transfer-Encoding: base64",
    "",
    PNG_B64,
    "--rel--",
    "--mixed",
    'Content-Type: application/pdf; name="trip.pdf"',
    'Content-Disposition: attachment; filename="trip.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    btoa("%PDF-1.4 fake"),
    "--mixed--",
    "",
  ].join("\r\n");
}

export const enc = (s: string) => new TextEncoder().encode(s);
