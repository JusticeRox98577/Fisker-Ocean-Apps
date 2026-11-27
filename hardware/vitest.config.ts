import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, STATS_CACHE_SECONDS: "0" },
          // A stand-in for the mail Worker, so the MAIL service binding resolves. Tests that send email
          // pass their own fake MAIL instead.
          workers: [
            {
              name: "ocean-live-mail",
              modules: true,
              script: `import { WorkerEntrypoint } from "cloudflare:workers";
                export class Notify extends WorkerEntrypoint { async send() { return { ok: false, error: "stand-in" }; } }
                export default { fetch() { return new Response("stand-in"); } };`,
            },
          ],
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
