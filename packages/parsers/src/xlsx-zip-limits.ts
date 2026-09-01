import { Readable } from "node:stream";

import * as unzipper from "unzipper";

const MAX_WORKBOOK_BYTES = 4 * 1024 * 1024;
const MAX_XLSX_ENTRIES = 256;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

interface XlsxZipLimitInput {
  bytes: Uint8Array;
  limits?: {
    maxEntries?: number;
    maxUncompressedBytes?: number;
  };
}

function decompressedChunkLength(chunk: unknown): number {
  if (typeof chunk === "string") return Buffer.byteLength(chunk);
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  throw new Error("invalid_xlsx_container");
}

function stopStreams(
  source: Readable,
  parser: unzipper.ParseStream,
  entry?: unzipper.Entry,
): void {
  entry?.destroy();
  parser.destroy();
  source.destroy();
}

function isLimitError(error: unknown): boolean {
  return error instanceof Error && (
    error.message === "xlsx_too_many_entries" ||
    error.message === "xlsx_uncompressed_too_large"
  );
}

async function enforceLocalEntryLimits(
  bytes: Uint8Array,
  maxEntries: number,
  maxUncompressedBytes: number,
): Promise<void> {
  const source = Readable.from([Buffer.from(bytes)]);
  const parser = unzipper.Parse({ forceStream: true });
  source.pipe(parser);

  let entryCount = 0;
  let declaredBytes = 0;
  let actualBytes = 0;
  let currentEntry: unzipper.Entry | undefined;
  try {
    for await (const value of parser) {
      const entry = value as unzipper.Entry;
      currentEntry = entry;
      entryCount += 1;
      if (entryCount > maxEntries) {
        stopStreams(source, parser, entry);
        throw new Error("xlsx_too_many_entries");
      }

      const localVariables = entry.vars as typeof entry.vars & {
        uncompressedSize?: number;
      };
      const declaredEntryBytes = localVariables.uncompressedSize ?? 0;
      declaredBytes += declaredEntryBytes;
      if (
        declaredEntryBytes > maxUncompressedBytes ||
        declaredBytes > maxUncompressedBytes
      ) {
        stopStreams(source, parser, entry);
        throw new Error("xlsx_uncompressed_too_large");
      }

      let actualEntryBytes = 0;
      for await (const chunk of entry) {
        const chunkBytes = decompressedChunkLength(chunk);
        actualEntryBytes += chunkBytes;
        actualBytes += chunkBytes;
        if (
          actualEntryBytes > maxUncompressedBytes ||
          actualBytes > maxUncompressedBytes
        ) {
          stopStreams(source, parser, entry);
          throw new Error("xlsx_uncompressed_too_large");
        }
      }
      currentEntry = undefined;
    }
  } catch (error) {
    stopStreams(source, parser, currentEntry);
    if (isLimitError(error)) throw error;
    throw new Error("invalid_xlsx_container", { cause: error });
  }
}

export async function enforceZipLimits(input: XlsxZipLimitInput): Promise<void> {
  if (input.bytes.byteLength > MAX_WORKBOOK_BYTES) throw new Error("workbook_too_large");
  const maxEntries = input.limits?.maxEntries ?? MAX_XLSX_ENTRIES;
  const maxUncompressedBytes =
    input.limits?.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  await enforceLocalEntryLimits(input.bytes, maxEntries, maxUncompressedBytes);
}
