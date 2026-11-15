import type { D1Migration } from "cloudflare:test";
import type { Env as StatusEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    interface Env extends StatusEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
export {};
