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
};

export default nextConfig;
