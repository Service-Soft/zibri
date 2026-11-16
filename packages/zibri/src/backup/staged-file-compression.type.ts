/**
 * How a file staged on this instance's disk, on its way to or from a transport, is stored: compressed with
 * zstd, or as it was handed over.
 */
export type StagedFileCompression = 'zstd' | 'none';