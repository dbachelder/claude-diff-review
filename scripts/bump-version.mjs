#!/usr/bin/env node
//
// scripts/bump-version.mjs
//
// Bumps the version in lockstep across every manifest that carries one,
// regenerates both lockfiles, refreshes the README's `@vX.Y.Z` install
// example, and (by default) commits + tags so all you have to do is push.
//
// Usage:
//
//   scripts/bump-version.mjs <new-version>     e.g.  0.5.1, 0.6.0-rc.1
//   scripts/bump-version.mjs patch             0.5.0 -> 0.5.1
//   scripts/bump-version.mjs minor             0.5.0 -> 0.6.0
//   scripts/bump-version.mjs major             0.5.0 -> 1.0.0
//
// Flags:
//
//   --dry-run         show what would change, touch nothing
//   --no-commit       edit files (incl. lockfiles) but don't `git commit`
//   --no-tag          commit but don't `git tag` (implies you'll tag later)
//   --allow-dirty     skip the clean-working-tree check
//   --help, -h        this message
//
// After a successful run, push:
//
//   git push origin main && git push origin v<new-version>
//
// The publish workflow takes over from there.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Files that carry the version, with the JSON path to the version field.
// Keep this list in sync with the Layout section of README.md.
const TARGETS = [
	{ file: "package.json",                          field: ["version"] },
	{ file: "plugin/package.json",                   field: ["version"] },
	{ file: "plugin/.claude-plugin/plugin.json",     field: ["version"] },
	{ file: "plugin/.codex-plugin/plugin.json",      field: ["version"] },
	{ file: ".claude-plugin/marketplace.json",       field: ["plugins", 0, "version"] },
	{ file: ".agents/plugins/marketplace.json",      field: ["plugins", 0, "version"] },
];

// Source of truth for the "current" version (this is the manifest we publish
// to npm; it would be a bug for any other manifest to drift past it).
const SOURCE_OF_TRUTH = "plugin/package.json";

// ---------------------------------------------------------------------------

function die(msg) {
	process.stderr.write(`bump-version: ${msg}\n`);
	process.exit(1);
}

function help() {
	const txt = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
	const lines = [];
	for (const l of txt.split("\n")) {
		if (l.startsWith("#!")) continue;
		if (!l.startsWith("//")) break;
		lines.push(l.replace(/^\/\/ ?/, ""));
	}
	process.stdout.write(lines.join("\n") + "\n");
}

function parseArgs(argv) {
	const opts = { dryRun: false, commit: true, tag: true, allowDirty: false };
	const positional = [];
	for (const a of argv) {
		switch (a) {
			case "--help":
			case "-h":          help(); process.exit(0);
			case "--dry-run":   opts.dryRun = true; break;
			case "--no-commit": opts.commit = false; opts.tag = false; break;
			case "--no-tag":    opts.tag = false; break;
			case "--allow-dirty": opts.allowDirty = true; break;
			default:
				if (a.startsWith("--")) die(`unknown flag: ${a} (try --help)`);
				positional.push(a);
		}
	}
	if (positional.length !== 1) die("expected exactly one version argument (try --help)");
	opts.bump = positional[0];
	return opts;
}

function readJson(rel) {
	return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

function writeJson(rel, obj) {
	const abs = path.join(REPO_ROOT, rel);
	const orig = fs.readFileSync(abs, "utf8");
	const trailing = orig.endsWith("\n") ? "\n" : "";
	// Detect indent from the original to preserve formatting.
	const indentMatch = orig.match(/\n([ \t]+)"/);
	const indent = indentMatch ? indentMatch[1] : "  ";
	fs.writeFileSync(abs, JSON.stringify(obj, null, indent) + trailing);
}

function getAt(obj, fieldPath) {
	let cur = obj;
	for (const k of fieldPath) cur = cur?.[k];
	return cur;
}

function setAt(obj, fieldPath, value) {
	let cur = obj;
	for (let i = 0; i < fieldPath.length - 1; i++) cur = cur[fieldPath[i]];
	cur[fieldPath.at(-1)] = value;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.\-+]+)?$/;

function bumpSemver(current, kind) {
	const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!m) die(`current version "${current}" is not parseable as semver`);
	let [maj, min, pat] = m.slice(1).map(Number);
	switch (kind) {
		case "patch": pat += 1; break;
		case "minor": min += 1; pat = 0; break;
		case "major": maj += 1; min = 0; pat = 0; break;
		default: throw new Error("unreachable");
	}
	return `${maj}.${min}.${pat}`;
}

function resolveTarget(current, arg) {
	if (arg === "patch" || arg === "minor" || arg === "major") return bumpSemver(current, arg);
	if (!SEMVER_RE.test(arg)) die(`"${arg}" is not a valid semver (e.g. 0.5.1, 1.0.0-rc.1)`);
	return arg;
}

function checkCleanTree() {
	const out = execSync("git status --porcelain", { cwd: REPO_ROOT, encoding: "utf8" });
	if (out.trim()) {
		die(
			"working tree is dirty:\n" + out +
			"commit/stash first, or pass --allow-dirty if you really mean it",
		);
	}
}

function run(cmd, args, { quiet = false } = {}) {
	const stdio = quiet ? ["ignore", "pipe", "pipe"] : "inherit";
	execSync([cmd, ...args.map(a => `'${a.replace(/'/g, "'\\''")}'`)].join(" "), {
		cwd: REPO_ROOT, stdio,
	});
}

// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));

// Read current versions from every target and verify consistency.
const currents = TARGETS.map(t => ({ ...t, current: getAt(readJson(t.file), t.field) }));
const sourceOfTruthCurrent = currents.find(t => t.file === SOURCE_OF_TRUTH).current;

const drifted = currents.filter(t => t.current !== sourceOfTruthCurrent);
if (drifted.length) {
	process.stderr.write(
		`bump-version: WARNING — manifests disagree on the current version:\n` +
		currents.map(t => `  ${t.current.padEnd(15)} ${t.file}`).join("\n") +
		`\n  (using ${SOURCE_OF_TRUTH}'s value: ${sourceOfTruthCurrent})\n` +
		`  the bump will rewrite all of them to the same target.\n\n`,
	);
}

const target = resolveTarget(sourceOfTruthCurrent, opts.bump);
if (target === sourceOfTruthCurrent) die(`target version (${target}) equals current — nothing to do`);

process.stdout.write(`bump: ${sourceOfTruthCurrent}  ->  ${target}${opts.dryRun ? "  (dry run)" : ""}\n\n`);

if (!opts.allowDirty && !opts.dryRun) checkCleanTree();

// Apply manifest edits.
for (const t of currents) {
	const obj = readJson(t.file);
	setAt(obj, t.field, target);
	process.stdout.write(`  ${opts.dryRun ? "[dry] " : ""}${t.file.padEnd(40)} ${t.current}  ->  ${target}\n`);
	if (!opts.dryRun) writeJson(t.file, obj);
}

// Refresh README install-example tag (only the explicit @vCURRENT pin).
const readmePath = path.join(REPO_ROOT, "README.md");
const readme = fs.readFileSync(readmePath, "utf8");
const readmePattern = new RegExp(`@v${sourceOfTruthCurrent.replace(/[.+]/g, "\\$&")}\\b`, "g");
const matches = readme.match(readmePattern) || [];
if (matches.length) {
	process.stdout.write(`  ${opts.dryRun ? "[dry] " : ""}README.md                                @v${sourceOfTruthCurrent}  ->  @v${target}  (x${matches.length})\n`);
	if (!opts.dryRun) fs.writeFileSync(readmePath, readme.replace(readmePattern, `@v${target}`));
}

// Regenerate lockfiles.
if (!opts.dryRun) {
	process.stdout.write(`\nregenerating lockfiles...\n`);
	run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"]);
	run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund", "--prefix", "plugin"]);
}

// Verify everything agrees post-bump.
if (!opts.dryRun) {
	const finalVersions = TARGETS.map(t => ({ file: t.file, version: getAt(readJson(t.file), t.field) }));
	const wrong = finalVersions.filter(t => t.version !== target);
	if (wrong.length) die(`post-bump verification failed:\n${wrong.map(t => `  ${t.file}: ${t.version}`).join("\n")}`);
}

if (opts.dryRun) {
	process.stdout.write(`\ndry run complete — no files written.\n`);
	process.exit(0);
}

if (!opts.commit) {
	process.stdout.write(`\nfiles updated; --no-commit so leaving git alone.\n`);
	process.exit(0);
}

// Stage + commit.
run("git", ["add", "-A"]);
run("git", ["commit", "-m", `Bump version to ${target}`]);

if (!opts.tag) {
	process.stdout.write(`\ncommitted; --no-tag so no tag created. Tag manually with:\n  git tag -a v${target} -m "v${target}"\n`);
	process.exit(0);
}

run("git", ["tag", "-a", `v${target}`, "-m", `v${target}`]);

process.stdout.write(`\n✓ committed and tagged v${target}.\n\nnext: git push origin main && git push origin v${target}\n`);
