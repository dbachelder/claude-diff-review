// Shared argument parser used by both the standalone CLI (`bin/slop-review.js`)
// and the pi extension (`extensions/pi/index.ts`). Keeping a single parser
// guarantees both surfaces accept exactly the same syntax.
//
// Accepted forms (positional or flag):
//   slop-review [base|last-commit|uncommitted|all] [--base <ref>]
//
// Returns: { scope, base } or throws on unknown args / invalid scope.

export const VALID_SCOPES = new Set(["base", "last-commit", "uncommitted", "all"]);

// CLI scope -> initial tab in the web UI.
export const INITIAL_TAB = {
  base: "git-diff",
  uncommitted: "git-diff",
  "last-commit": "last-commit",
  all: "all-files",
};

/**
 * @param {string[]} argv  e.g. process.argv.slice(2), or `argString.trim().split(/\s+/).filter(Boolean)`
 * @returns {{ scope: "base"|"last-commit"|"uncommitted"|"all", base: string|null, help: boolean }}
 */
export function parseArgs(argv) {
  const args = { scope: "base", base: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      args.help = true;
    } else if (a === "--scope" || a === "-s") {
      args.scope = argv[++i];
    } else if (a.startsWith("--scope=")) {
      args.scope = a.slice("--scope=".length);
    } else if (a === "--base" || a === "-b") {
      args.base = argv[++i];
    } else if (a.startsWith("--base=")) {
      args.base = a.slice("--base=".length);
    } else if (VALID_SCOPES.has(a)) {
      args.scope = a;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!VALID_SCOPES.has(args.scope)) {
    throw new Error(`Invalid scope "${args.scope}". Must be one of: ${[...VALID_SCOPES].join(", ")}`);
  }
  return args;
}
