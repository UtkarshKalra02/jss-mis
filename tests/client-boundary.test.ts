import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The client/server boundary, checked by reading the source.
 *
 * WHY THIS FILE EXISTS. On 25 Nov 2026 the deployed site answered the Item
 * Tracker with "Application error: a server-side exception has occurred".
 * X9 had turned `itemColumns` from an exported const into an exported
 * FUNCTION, so the row menu could be left out for roles that may not close a
 * job — and the page, a server component, called it:
 *
 *   Attempted to call itemColumns() from the server but itemColumns is on the
 *   client. It's not possible to invoke a client function from the server, it
 *   can only be rendered as a Component or passed to props of a Client
 *   Component.
 *
 * Under the App Router every export of a `"use client"` module is a client
 * REFERENCE on the server. Rendering one as a component is fine. Passing one
 * as a prop is fine. CALLING one throws, at request time — and nothing that
 * runs before a request catches it: `tsc` sees a function and is satisfied,
 * `next build` compiles both halves happily, and the page it broke needs a
 * session, so it is never rendered during a build.
 *
 * So the check has to be this one: read every file under src/, work out which
 * side of the boundary it is on, and fail if a server file calls something a
 * `"use client"` module exports. It is a lint rule written as a test because
 * the repo has no plugin that knows about the boundary, and because a failure
 * here should read as "this will 500 in production", which is what it means.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK. Imports are fine — a type-only import
 * is erased, and importing a client component to render it is the ordinary
 * case. The pattern that breaks is a CALL, and that is the only thing asserted.
 */

const SRC = "src";

type Scanned = { path: string; source: string; isClient: boolean };

function walk(dir: string, out: Scanned[] = []): Scanned[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;

    const source = readFileSync(path, "utf8");
    const head = source.trimStart();
    out.push({
      path,
      source,
      isClient: head.startsWith('"use client"') || head.startsWith("'use client'"),
    });
  }
  return out;
}

/** Exported function and const names — what a server file could try to call. */
function exportedNames(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)) {
    names.add(m[1]!);
  }
  for (const m of source.matchAll(/^export\s+const\s+([A-Za-z0-9_]+)/gm)) {
    names.add(m[1]!);
  }
  return [...names];
}

describe("no server file calls a client module's export", () => {
  const files = walk(SRC);

  it("has found both sides of the boundary, so the sweep means something", () => {
    // A guard on the guard: if the walk or the directive check broke, the
    // assertion below would pass by finding nothing at all.
    expect(files.filter((f) => f.isClient).length).toBeGreaterThan(50);
    expect(files.filter((f) => !f.isClient).length).toBeGreaterThan(50);
  });

  it("finds no call of a client export from a server file", () => {
    const owner = new Map<string, string>();
    for (const file of files) {
      if (!file.isClient) continue;
      for (const name of exportedNames(file.source)) owner.set(name, file.path);
    }

    const offences: string[] = [];

    for (const file of files) {
      if (file.isClient) continue;

      for (const [name, from] of owner) {
        const imported = new RegExp(
          String.raw`import\s*\{[^}]*\b${name}\b[^}]*\}\s*from`,
        ).test(file.source);
        if (!imported) continue;

        // `import type { X }` is erased before it ever runs.
        const typeOnly = new RegExp(String.raw`import\s+type\s*\{[^}]*\b${name}\b`).test(
          file.source,
        );
        if (typeOnly) continue;

        for (const m of file.source.matchAll(new RegExp(String.raw`(?<![\w.])${name}\s*\(`, "g"))) {
          const line = file.source.slice(0, m.index).split("\n").length;
          offences.push(
            `${file.path}:${line} calls ${name}(), exported from the client module ${from}`,
          );
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
