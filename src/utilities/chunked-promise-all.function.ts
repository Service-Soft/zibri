/**
 * Options for chunking.
 */
export type ChunkingOptions = {
    /**
     * The size of a single chunk.
     */
    chunkSize: number
};

/**
 * Like Promise.all, but chunked.
 * @param promises - The promises to resolve.
 * @param options - Options for chunking, like the size of chunks etc.
 * @returns The resolved promises after all chunks have been resolved.
 */
export async function chunkedPromiseAll<T>(
    promises: Promise<T>[],
    options: ChunkingOptions = {
        chunkSize: 50
    }
): Promise<T[]> {
    const res: T[] = [];
    const chunkSize: number = options.chunkSize;

    for (let i: number = 0; i < promises.length; i += chunkSize) {
        const p: Promise<T>[] = promises.slice(i, i + chunkSize);
        res.push(...await Promise.all(p));
    }

    return res;
}