import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUILT, NAV } from "@/components/shell/nav";

/**
 * The sidebar dims any entry not in BUILT. That set is maintained by hand,
 * and the store shipped with its route live and its link dead (section O
 * follow-up). This pins BUILT to the filesystem: an entry is built exactly
 * when its page exists.
 */
describe("sidebar entries agree with the routes on disk", () => {
  const appDir = join(process.cwd(), "src", "app", "(app)");

  for (const group of NAV) {
    for (const item of group.items) {
      const page = join(appDir, item.href.replace(/^\//, ""), "page.tsx");
      const exists = existsSync(page);

      it(`${item.label} (${item.href}) is ${exists ? "built" : "not built"}`, () => {
        expect(BUILT.has(item.resource)).toBe(exists);
      });
    }
  }
});
