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

async function enforceActualExpansionLimit(
  directory: unzipper.CentralDirectory,
  maxUncompressedBytes: number,
): Promise<void> {
  let totalBytes = 0;
  for (const file of directory.files) {
    if (file.type === "Directory") continue;
    let entryBytes = 0;
    const stream = file.stream();
    try {
      for await (const chunk of stream) {
        const chunkBytes = decompressedChunkLength(chunk);
        entryBytes += chunkBytes;
        totalBytes += chunkBytes;
        if (
          entryBytes > maxUncompressedBytes ||
          totalBytes > maxUncompressedBytes
        ) {
          stream.destroy();
          throw new Error("xlsx_uncompressed_too_large");
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "xlsx_uncompressed_too_large"
      ) {
        throw error;
      }
      throw new Error("invalid_xlsx_container", { cause: error });
    }
  }
}

export async function enforceZipLimits(input: XlsxZipLimitInput): Promise<void> {
  if (input.bytes.byteLength > MAX_WORKBOOK_BYTES) throw new Error("workbook_too_large");
  let directory: unzipper.CentralDirectory;
  try {
    directory = await unzipper.Open.buffer(Buffer.from(input.bytes));
  } catch (error) {
    throw new Error("invalid_xlsx_container", { cause: error });
  }
  const maxEntries = input.limits?.maxEntries ?? MAX_XLSX_ENTRIES;
  if (directory.files.length > maxEntries) throw new Error("xlsx_too_many_entries");
  const maxUncompressedBytes =
    input.limits?.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  const declaredUncompressedBytes = directory.files.reduce(
    (total, file) => total + file.uncompressedSize,
    0,
  );
  if (declaredUncompressedBytes > maxUncompressedBytes) {
    throw new Error("xlsx_uncompressed_too_large");
  }
  await enforceActualExpansionLimit(directory, maxUncompressedBytes);
}
