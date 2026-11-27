import type { D1Migration } from "cloudflare:test";
import type { Env as HardwareEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    interface Env extends HardwareEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
export {};
