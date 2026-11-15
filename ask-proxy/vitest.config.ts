import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      // Wrangler bundles .md files as text ([[rules]] in wrangler.toml); do the same for the tests.
      {
        name: "markdown-as-text",
        enforce: "pre" as const,
        transform(code: string, id: string) {
          if (id.endsWith(".md")) return { code: `export default ${JSON.stringify(code)};`, map: null };
        },
      },
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, EMAIL_FROM: "Ocean Live <login@oceanlive.org>" },
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
