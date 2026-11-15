import type { D1Migration } from "cloudflare:test";
import type { Env as AskEnv } from "../src/index";

declare global {
  namespace Cloudflare {
    interface Env extends AskEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
export {};
