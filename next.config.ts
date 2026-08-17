import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // There is a stray package-lock.json in the home directory ABOVE this
    // project. Without this, Turbopack sees two lockfiles and infers the home
    // folder as the workspace root, which quietly changes how modules resolve.
    //
    // process.cwd() rather than import.meta.dirname: Next may load this config
    // as CommonJS, where import.meta does not exist and the build dies with a
    // syntax error. Next always runs from the project root, so cwd is the same
    // answer without the failure mode.
    root: process.cwd(),
  },

  /*
   * Keep `ws` out of the bundle.
   *
   * `ws` probes for an optional native dependency, `bufferutil`, with a
   * `require` inside a try/catch. Bundling resolves that require to an empty
   * stub instead of letting it throw, so the guard passes and `ws` installs a
   * broken mask function — see the long note in src/db/index.ts.
   *
   * The driver now prefers Node's built-in WebSocket, so this is belt and
   * braces rather than the primary fix. It matters on any runtime older than
   * Node 22, where `ws` is still the one doing the work.
   */
  serverExternalPackages: ["ws"],
};

export default nextConfig;
