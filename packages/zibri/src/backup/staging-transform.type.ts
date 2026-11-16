/**
 * Changes data on its way to the file it is staged in.
 */
export type StagingTransform = (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>;