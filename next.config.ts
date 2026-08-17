import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // There is a stray package-lock.json in the home directory above this
    // project. Without this, Turbopack sees two lockfiles and infers the HOME
    // FOLDER as the workspace root, which quietly changes how modules resolve.
    // Pinning the root removes the guess.
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
