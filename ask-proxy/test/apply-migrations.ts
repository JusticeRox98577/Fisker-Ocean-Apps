import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.LOG_DB!, env.TEST_MIGRATIONS);
