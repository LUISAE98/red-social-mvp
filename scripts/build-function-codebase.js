/* eslint-disable no-console */
const { cpSync, existsSync, mkdirSync, rmSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const codebase = process.argv[2];
const allowed = new Set(["payments", "media", "social", "accounts"]);

if (!allowed.has(codebase)) {
  console.error(`Codebase desconocida: ${codebase ?? "(vacía)"}`);
  process.exit(1);
}

const repoRoot = resolve(__dirname, "..");
const backendDir = resolve(repoRoot, "backend");
const destination = resolve(repoRoot, "backend-codebases", codebase);
const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const args = npmCli
  ? [npmCli, "--prefix", backendDir, "run", "build"]
  : ["--prefix", backendDir, "run", "build"];
const build = spawnSync(command, args, {
  cwd: repoRoot,
  stdio: "inherit",
});

if (build.error) {
  console.error(build.error);
  process.exit(1);
}
if (build.status !== 0) process.exit(build.status ?? 1);

const compiled = resolve(backendDir, "lib");
const destinationLib = resolve(destination, "lib");
if (!existsSync(compiled)) {
  console.error("No existe backend/lib después de compilar.");
  process.exit(1);
}

mkdirSync(destination, { recursive: true });
rmSync(destinationLib, { recursive: true, force: true });
cpSync(compiled, destinationLib, { recursive: true });
cpSync(resolve(backendDir, "package-lock.json"), resolve(destination, "package-lock.json"));
console.log(`Codebase ${codebase} preparada.`);
