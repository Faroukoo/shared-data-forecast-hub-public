import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import {
  RawArtifactSchema,
  SCHEMA_VERSION,
  Sha256Schema,
  SourceDefinitionSchema,
  type RawArtifact,
  type SourceDefinition,
} from "@data-hub/contracts";

export interface PutArtifactInput {
  source: SourceDefinition;
  originalUrl: string;
  retrievedAt: string;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  originalFilename: string;
  sourcePublicationPeriod: string | null;
  predecessorSha256: string | null;
  bytes: Uint8Array;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function manifestJson(artifact: RawArtifact): string {
  return `${JSON.stringify(canonicalize(artifact), null, 2)}\n`;
}

async function installWithoutOverwrite(
  targetPath: string,
  bytes: Uint8Array | string,
): Promise<boolean> {
  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryPath = join(dirname(targetPath), `.tmp-${randomUUID()}`);
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    try {
      await link(temporaryPath, targetPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return false;
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export class LocalArtifactStore {
  public constructor(private readonly root: string) {}

  public async putArtifact(
    input: PutArtifactInput,
  ): Promise<{ artifact: RawArtifact; created: boolean }> {
    const source = SourceDefinitionSchema.parse(input.source);
    const digest = sha256(input.bytes);
    const rawPath = join("raw", source.source_id, digest, "artifact");
    const manifestPath = join("manifests", "artifacts", `${digest}.json`);
    const absoluteRawPath = join(this.root, rawPath);

    const created = await installWithoutOverwrite(absoluteRawPath, input.bytes);
    const installedDigest = sha256(await readFile(absoluteRawPath));
    if (installedDigest !== digest) {
      throw new Error(`artifact_digest_collision:${digest}`);
    }

    const artifact = RawArtifactSchema.parse({
      schema_version: SCHEMA_VERSION,
      source_id: source.source_id,
      original_url: input.originalUrl,
      retrieved_at: input.retrievedAt,
      http_etag: input.etag,
      http_last_modified: input.lastModified,
      content_type: input.contentType,
      byte_length: input.bytes.byteLength,
      original_filename: input.originalFilename,
      sha256: digest,
      parser_kind: source.parser.kind,
      parser_profile: source.parser.profile,
      licence_snapshot: source.licence,
      source_publication_period: input.sourcePublicationPeriod,
      predecessor_sha256: input.predecessorSha256,
      artifact_path: relative(this.root, absoluteRawPath),
      manifest_path: manifestPath,
    });

    const absoluteManifestPath = join(this.root, manifestPath);
    const installedManifest = await installWithoutOverwrite(
      absoluteManifestPath,
      manifestJson(artifact),
    );
    if (!installedManifest) {
      const existing = RawArtifactSchema.parse(
        JSON.parse(await readFile(absoluteManifestPath, "utf8")),
      );
      if (existing.sha256 !== digest || existing.source_id !== source.source_id) {
        throw new Error(`artifact_manifest_collision:${digest}`);
      }
      return { artifact: existing, created: false };
    }

    return { artifact, created };
  }

  public async getArtifactBytes(sha256Digest: string): Promise<Uint8Array> {
    const digest = Sha256Schema.parse(sha256Digest);
    const manifestPath = join(this.root, "manifests", "artifacts", `${digest}.json`);
    const artifact = RawArtifactSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    const bytes = await readFile(join(this.root, artifact.artifact_path));
    if (sha256(bytes) !== digest) throw new Error(`artifact_digest_mismatch:${digest}`);
    return new Uint8Array(bytes);
  }
}
