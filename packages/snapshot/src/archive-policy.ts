import { posix } from "node:path";

export const SNAPSHOT_ROOTS = [
  "raw",
  "manifests",
  "published",
  "runs",
  "quality",
] as const;

export function validateArchiveEntry(path: string, type: string): void {
  const hasUnsafeCharacters = path.includes("\\") || path.includes("\0");
  const hasTraversal = path.split("/").includes("..");
  const normalized = posix.normalize(path);
  const canonicalInput =
    type === "Directory" && path.endsWith("/") ? path.slice(0, -1) : path;
  const hasAlias = normalized !== canonicalInput;
  const allowedPath =
    normalized === "snapshot-manifest.json" ||
    SNAPSHOT_ROOTS.some(
      (root) =>
        normalized === `data-hub/${root}` ||
        normalized.startsWith(`data-hub/${root}/`),
    );
  const allowedType = type === "File" || type === "Directory";
  if (
    hasUnsafeCharacters ||
    hasTraversal ||
    hasAlias ||
    normalized.startsWith("/") ||
    !allowedPath ||
    !allowedType
  ) {
    throw new Error(`unsafe_archive_entry:${type}`);
  }
}
