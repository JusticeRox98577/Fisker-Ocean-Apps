import type { D1Migration } from "cloudflare:test";
import type { Env as MailEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    interface Env extends MailEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
export {};
