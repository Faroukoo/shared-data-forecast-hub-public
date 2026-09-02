import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parse } from "yaml";

const PRODUCTION_PATH = ".github/workflows/data-refresh.yml";

type FakeGitHubState = {
  calls: string[];
  release?: {
    assets: Array<{ digest: string; id: number; name: string }>;
    body: string;
    draft: boolean;
    id: number;
    name: string;
    prerelease: boolean;
    tag_name: string;
  };
};

async function productionStep(name: string): Promise<string> {
  const workflow = parse(await readFile(PRODUCTION_PATH, "utf8")) as {
    jobs?: { refresh?: { steps?: Array<{ name?: string; run?: string }> } };
  };
  const matches = (workflow.jobs?.refresh?.steps ?? []).filter(
    (step) => step.name === name,
  );
  assert.equal(matches.length, 1, name);
  assert.equal(typeof matches[0]?.run, "string", `${name}.run`);
  return matches[0]?.run as string;
}

async function runShell(
  source: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-e", "-o", "pipefail", "-c", source], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

void test("refresh publishes its newly created draft through the exact release ID", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "data-refresh-workflow-"));
  t.after(async () => {
    await rm(root, { force: true, recursive: true });
  });
  const bin = join(root, "bin");
  const statePath = join(root, "github-state.json");
  await mkdir(bin);

  await writeFile(
    join(bin, "npm"),
    `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-dir");
if (args.slice(0, 4).join(" ") !== "run snapshot -- create" || outputIndex === -1) process.exit(64);
const outputDir = args[outputIndex + 1];
const snapshotId = "a".repeat(64);
const archiveName = \`data-hub-\${snapshotId}.tar.gz\`;
const archive = Buffer.from("verified archive\\n");
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, archiveName), archive);
writeFileSync(join(outputDir, \`\${archiveName}.sha256\`), \`\${createHash("sha256").update(archive).digest("hex")}  \${archiveName}\\n\`);
writeFileSync(join(outputDir, "snapshot-index.json"), JSON.stringify({ snapshot_id: snapshotId, archive: { name: archiveName } }));
`,
    { mode: 0o755 },
  );

  await writeFile(
    join(bin, "gh"),
    `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const statePath = process.env.FAKE_GITHUB_STATE;
if (!statePath) process.exit(64);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { calls: [] };
const args = process.argv.slice(2);
state.calls.push(args.join(" "));
const save = () => writeFileSync(statePath, JSON.stringify(state));
const fail = (message) => { save(); process.stderr.write(message); process.exit(1); };
const outputRelease = () => process.stdout.write(JSON.stringify(state.release));

if (args[0] === "api") {
  const endpoint = args.find((value) => value.startsWith("/repos/"));
  const methodIndex = args.indexOf("--method");
  const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
  if (endpoint?.endsWith("/releases?per_page=100")) {
    save();
    process.stdout.write("[[]]");
  } else if (endpoint?.includes("/releases/tags/")) {
    if (state.release?.draft === true) fail("HTTP 404: release not found\\n");
    save();
    outputRelease();
  } else if (endpoint?.endsWith(\`/releases/\${state.release?.id}\`) && method === "PATCH") {
    if (!args.includes("draft=false")) fail("invalid release patch\\n");
    state.release.draft = false;
    save();
    outputRelease();
  } else if (endpoint?.endsWith(\`/releases/\${state.release?.id}\`)) {
    save();
    outputRelease();
  } else {
    fail(\`unsupported api call: \${args.join(" ")}\\n\`);
  }
} else if (args[0] === "release" && args[1] === "create") {
  const tag = args[2];
  const notesIndex = args.indexOf("--notes");
  state.release = {
    assets: [],
    body: args[notesIndex + 1],
    draft: args.includes("--draft"),
    id: 117,
    name: tag,
    prerelease: false,
    tag_name: tag,
  };
  save();
} else if (args[0] === "release" && args[1] === "view") {
  if (!state.release) fail("release not found\\n");
  save();
  process.stdout.write(JSON.stringify({
    body: state.release.body,
    databaseId: state.release.id,
    isDraft: state.release.draft,
    isPrerelease: state.release.prerelease,
    name: state.release.name,
    tagName: state.release.tag_name,
  }));
} else if (args[0] === "release" && args[1] === "upload") {
  if (!state.release) fail("release not found\\n");
  const files = args.filter((value) => existsSync(value));
  state.release.assets = files.map((path, index) => ({
    digest: \`sha256:\${createHash("sha256").update(readFileSync(path)).digest("hex")}\`,
    id: 200 + index,
    name: basename(path),
  }));
  save();
} else if (args[0] === "release" && args[1] === "edit") {
  if (!state.release || !args.includes("--draft=false")) fail("invalid release edit\\n");
  state.release.draft = false;
  save();
} else {
  fail(\`unsupported gh call: \${args.join(" ")}\\n\`);
}
`,
    { mode: 0o755 },
  );

  const run = await productionStep("Create and publish a unique verified snapshot");
  const result = await runShell(run, {
    ...process.env,
    FAKE_GITHUB_STATE: statePath,
    GH_TOKEN: "test-token",
    GITHUB_REPOSITORY: "example/data-hub",
    GITHUB_SHA: "b".repeat(40),
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    PREVIOUS_TAG: "data-20260827T095123Z-9d3b77bbfc0c",
    RUNNER_TEMP: root,
  });

  assert.equal(result.code, 0, result.stderr);
  const state = JSON.parse(await readFile(statePath, "utf8")) as FakeGitHubState;
  assert.ok(state.release);
  assert.equal(state.release.draft, false);
  assert.equal(state.release.assets.length, 3);
  assert.equal(
    state.calls.some((call) => call.includes("/releases/tags/")),
    false,
  );
  assert.equal(
    state.calls.some((call) => call.includes("/releases/117")),
    true,
  );
  assert.equal(
    state.calls.includes(
      "api --method PATCH /repos/example/data-hub/releases/117 -F draft=false",
    ),
    true,
  );
  assert.equal(
    state.calls.some((call) => call.startsWith("release edit ")),
    false,
  );
});
