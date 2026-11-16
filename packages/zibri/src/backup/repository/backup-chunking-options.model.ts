// one object per chunk, no packs of many: on warm stores the requests cost a fraction of the storage, and
// on B2 or Wasabi nothing, so raising the chunk sizes is the cheaper lever against the request count.
// Packs would have the garbage collection repack partly dead packs (reading live chunks back, egress on S3)
// and restores read ranges, about as much work as the garbage collection itself. A manifest names chunk
// ids only, so packs could still be added later without storing anything anew
/**
 * How the data of a resource is cut into chunks and compressed, as a deduplicated backup stores it.
 *
 * Changing a size makes the next backup of every resource store its data anew, since the chunks it
 * cuts are others; nothing else changes, and every backup taken before stays restorable.
 */
export type BackupChunkingOptions = {
    /**
     * The fewest bytes a chunk holds, except the last chunk of a resource.
     */
    minChunkBytes: number,
    /**
     * How many bytes a chunk holds on average. A power of two.
     */
    averageChunkBytes: number,
    /**
     * The most bytes a chunk holds.
     */
    maxChunkBytes: number,
    /**
     * How hard each chunk is compressed with zstd, from 1 to 19.
     */
    compressionLevel: number
};