import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const testFiles = readdirSync("test")
  .filter((file) => file.endsWith(".test.mjs"))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => join("test", file));

if (testFiles.length === 0) {
  console.error("No frontend tests found.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
