export class CliUsageError extends Error {}

export function parseCliOptions(
  args: string[],
  allowed: ReadonlySet<string>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new CliUsageError("invalid_usage");
    }
    if (!allowed.has(key)) throw new CliUsageError("unknown_option");
    if (result.has(key)) throw new CliUsageError("duplicate_option");
    result.set(key, value);
  }
  return result;
}

export function requiredOption(
  values: ReadonlyMap<string, string>,
  key: string,
): string {
  const value = values.get(key);
  if (!value) throw new CliUsageError("missing_option");
  return value;
}
