/**
 * Schema barrel.
 *
 * drizzle-kit reads this file to discover every table, so anything not
 * re-exported here does not exist as far as migrations are concerned. If you
 * add a schema file, add it here in the same commit.
 *
 * Order below follows the dependency graph, which is acyclic by construction:
 *   enums -> users -> _shared -> imports -> reference -> materials -> pre-order
 *         -> order -> tooling -> production -> material-movements -> dispatch
 *         -> accounts -> delegation -> audit
 *
 * materials sits BEFORE order and production because both point at it (a
 * design's preferred paper, a job card's paper); material-movements sits after
 * production because an issue names its job card. See the note in
 * material-movements.ts.
 */

export * from "./enums";
export * from "./users";
export * from "./_shared";
export * from "./imports";
export * from "./reference";
export * from "./materials";
export * from "./pre-order";
export * from "./order";
export * from "./tooling";
export * from "./production";
export * from "./fabrication";
export * from "./material-movements";
export * from "./dispatch";
export * from "./accounts";
export * from "./delegation";
export * from "./audit";
