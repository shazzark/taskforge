import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePackageInventory(value, expectedName, expectedVersion, expectedDistPaths) {
  if (!Array.isArray(expectedDistPaths) || !expectedDistPaths.includes("dist/cli.js")) {
    throw new Error("Expected compiled-file inventory must include the CLI entrypoint.");
  }
  const expectedDist = new Set(expectedDistPaths);
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error("Expected one npm pack inventory entry.");
  }
  const entry = value[0];
  if (entry.id !== `${expectedName}@${expectedVersion}` || !Array.isArray(entry.files)) {
    throw new Error("Package inventory metadata does not match package.json.");
  }
  if (typeof entry.entryCount !== "number" || entry.entryCount !== entry.files.length) {
    throw new Error("Package inventory file count is inconsistent.");
  }

  const paths = new Set();
  const packedDist = new Set();
  for (const file of entry.files) {
    if (!isRecord(file) || typeof file.path !== "string") {
      throw new Error("Package inventory contains an invalid file entry.");
    }
    const path = file.path;
    const segments = path.split("/");
    if (path.length === 0 || path.includes("\\") || path.startsWith("/") || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`Package inventory contains an unsafe path: ${path}`);
    }
    if (paths.has(path)) throw new Error(`Package inventory contains a duplicate path: ${path}`);
    paths.add(path);

    const basename = segments.at(-1) ?? "";
    const denied = segments.some((segment) => [".git", ".agents", ".codex", ".aws", "test", "tests", "coverage", "reports", "private", "sessions"].includes(segment)) ||
      basename === ".npmrc" || basename.startsWith(".env") ||
      /(?:^|[._-])(?:secret|credential|token|private)(?:[._-]|$)/iu.test(basename) ||
      /^(?:session|sessions)(?:[-_][^.]+)?\.(?:json|txt|db|sqlite|log)$/iu.test(basename);
    if (denied) throw new Error(`Package inventory contains a prohibited path: ${path}`);

    const allowedTopLevel = new Set(["package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]);
    if (path.startsWith("dist/")) {
      if (!path.endsWith(".js") || !expectedDist.has(path)) {
        throw new Error(`Package inventory contains output that does not match compiled TypeScript sources: ${path}`);
      }
      packedDist.add(path);
    } else if (!allowedTopLevel.has(path)) {
      throw new Error(`Package inventory contains a path outside the package allowlist: ${path}`);
    }
  }
  if (!paths.has("package.json") || !paths.has("dist/cli.js")) {
    throw new Error("Package inventory is missing package metadata or the CLI entrypoint.");
  }
  if (packedDist.size !== expectedDist.size || [...expectedDist].some((path) => !packedDist.has(path))) {
    throw new Error("Package inventory does not contain the complete compiled TypeScript output.");
  }
  return { fileCount: paths.size };
}

function compiledSourcePaths(directory, root = directory, paths = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) compiledSourcePaths(path, root, paths);
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      const relative = path.slice(root.length + 1).replaceAll("\\", "/");
      paths.push(`dist/${relative.slice(0, -3)}.js`);
    }
  }
  return paths;
}

function runPackageAudit() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!isRecord(packageJson) || typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
    throw new Error("package.json has invalid package identity metadata.");
  }
  const npmExecPath = process.env["npm_execpath"];
  if (npmExecPath === undefined || npmExecPath.length === 0) {
    throw new Error("Run this audit through `npm run package:audit` so it can use the installed npm CLI.");
  }

  const cacheDirectory = mkdtempSync(join(tmpdir(), "taskforge-package-audit-cache-"));
  try {
    let inventory;
    try {
      const output = execFileSync(process.execPath, [npmExecPath, "pack", "--dry-run", "--json", "--ignore-scripts", "--offline"], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, npm_config_cache: cacheDirectory, npm_config_ignore_scripts: "true", npm_config_offline: "true" },
      });
      inventory = JSON.parse(output);
    } catch {
      throw new Error("Could not generate the offline npm package inventory.");
    }
    const sourceFiles = compiledSourcePaths(join(root, "src"));
    const result = validatePackageInventory(inventory, packageJson.name, packageJson.version, ["dist/cli.js", ...sourceFiles.filter((path) => path !== "dist/cli.js")]);
    process.stdout.write(`Package artifact audit passed: ${result.fileCount} allowlisted files; no private-state, test, credential, session-data, report-directory, or unsafe paths found.\n`);
  } finally {
    rmSync(cacheDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    runPackageAudit();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Package artifact audit failed."}\n`);
    process.exitCode = 1;
  }
}
