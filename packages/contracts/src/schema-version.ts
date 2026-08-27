export const SCHEMA_VERSION = "1.0.0" as const;

export function assertSupportedSchemaVersion(version: string): void {
  if (version.split(".")[0] !== "1") {
    throw new Error(`unsupported_schema_major:${version}`);
  }
}
