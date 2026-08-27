import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  readFile,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function sourceFilesUnder(roots: string[]): Promise<string[]> {
  const files: string[] = [];
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && child.endsWith(".ts")) files.push(child);
    }
  }
  for (const root of roots) await visit(root);
  return files;
}

async function gitCheckIgnore(path: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["check-ignore", "-q", "--", path]);
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 1) return false;
    throw error;
  }
}

void test("consumer-facing packages cannot import connector or artifact internals", async () => {
  const files = await sourceFilesUnder([
    "packages/contracts",
    "packages/canonical",
    "packages/snapshot",
  ]);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /@data-hub\/(?:connectors|artifact-store)/,
      file,
    );
  }
});

void test("workspace architecture keeps adapters on the public data boundary", async () => {
  const contracts = await sourceFilesUnder(["packages/contracts"]);
  for (const file of contracts) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /@data-hub\//, file);
  }

  const upstreamPackages = await sourceFilesUnder([
    "packages/connectors",
    "packages/parsers",
    "packages/quality",
  ]);
  for (const file of upstreamPackages) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /@data-hub\/adapters/, file);
  }

  const adapters = await sourceFilesUnder(["packages/adapters"]);
  const allowedAdapterImports = new Set([
    "@data-hub/canonical",
    "@data-hub/contracts",
    "@data-hub/snapshot",
    "@data-hub/source-registry",
  ]);
  for (const file of adapters) {
    const source = await readFile(file, "utf8");
    const imports = source.matchAll(/from\s+["'](@data-hub\/[^"']+)["']/g);
    for (const match of imports) {
      assert.equal(allowedAdapterImports.has(match[1] ?? ""), true, file);
    }
  }
});

void test("runtime and large binary paths are ignored", async () => {
  assert.equal(await gitCheckIgnore(".data-hub/raw/example/artifact"), true);
  assert.equal(await gitCheckIgnore("dist/ingest-cli.js"), true);
});

void test("workspace package exports expose only public source indexes", async () => {
  const workspaceRoots = ["apps", "packages"];
  for (const workspaceRoot of workspaceRoots) {
    for (const entry of await readdir(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(workspaceRoot, entry.name, "package.json");
      const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
      assert.equal(typeof manifest, "object", manifestPath);
      assert.notEqual(manifest, null, manifestPath);
      assert.equal(
        (manifest as Record<string, unknown>).exports,
        "./src/index.ts",
        manifestPath,
      );
    }
  }
});

void test("tracked files contain no data workbook or canonical export", async () => {
  const { stdout } = await execFileAsync("git", ["ls-files"]);
  const tracked = stdout.split("\n").filter(Boolean);
  assert.deepEqual(
    tracked.filter(
      (path) =>
        path.startsWith(".data-hub/") ||
        /\.(?:xlsx|xls|csv|jsonl|tar\.gz|sha256)$/i.test(path),
    ),
    [],
  );
});

void test("tests cannot call a literal remote HTTP endpoint", async () => {
  const files = await sourceFilesUnder(["tests"]);
  const directRemoteCall = /\b(?:globalThis\.)?fetch\s*\(\s*["'`]https?:\/\//;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, directRemoteCall, file);
  }
});
