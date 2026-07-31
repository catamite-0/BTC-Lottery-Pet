import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function projectPath(path) {
  return resolve(repoRoot, path);
}

function readText(path) {
  return readFileSync(projectPath(path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function requiredMatch(path, pattern, label) {
  const contents = readText(path);
  const match = contents.match(pattern);
  if (!match) {
    throw new Error(`Could not find ${label} in ${path}`);
  }
  return match[1];
}

function isIsoCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const expected = packageJson.version;
const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

if (!semanticVersionPattern.test(expected)) {
  throw new Error(`package.json has an invalid semantic version: ${expected}`);
}

const versions = new Map([
  ["package.json", expected],
  ["package-lock.json", packageLock.version],
  ["package-lock.json packages root", packageLock.packages?.[""]?.version],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
  [
    "src-tauri/Cargo.toml",
    requiredMatch(
      "src-tauri/Cargo.toml",
      /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/,
      "package version",
    ),
  ],
  [
    "src-tauri/Cargo.lock",
    requiredMatch(
      "src-tauri/Cargo.lock",
      /\[\[package\]\]\s*\r?\nname = "btc-lottery-pet"\s*\r?\nversion = "([^"]+)"/,
      "btc-lottery-pet package version",
    ),
  ],
]);

const mismatches = [...versions].filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
  const details = mismatches
    .map(([source, version]) => `${source}: ${version ?? "missing"}`)
    .join("\n");
  throw new Error(`Version mismatch; expected ${expected}:\n${details}`);
}

const changelog = readText("CHANGELOG.md");
const changelogHeading = changelog.match(/^##\s+(\S+)\s+-\s+(.+)$/m);
if (!changelogHeading) {
  throw new Error("CHANGELOG.md has no release heading");
}

const [, changelogVersion, changelogStateRaw] = changelogHeading;
const changelogState = changelogStateRaw.trim();
if (changelogVersion !== expected) {
  throw new Error(
    `CHANGELOG.md starts with ${changelogVersion}; expected ${expected}`,
  );
}

const tag = process.env.GITHUB_REF?.match(/^refs\/tags\/v(.+)$/)?.[1];
if (tag && tag !== expected) {
  throw new Error(`Git tag v${tag} does not match application version ${expected}`);
}

if (tag && !isIsoCalendarDate(changelogState)) {
  throw new Error(
    `Tagged release v${tag} requires CHANGELOG.md to use a YYYY-MM-DD release date, not "${changelogState}"`,
  );
}

console.log(`Version check passed: ${expected} (CHANGELOG: ${changelogState})`);
