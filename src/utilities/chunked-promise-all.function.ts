export type ChunkedOptions = {
    chunkSize: number
};

export async function chunkedPromiseAll<T, R>(
    items: T[],
    fn: (item: T) => R | Promise<R>,
    options: ChunkedOptions
): Promise<R[]> {
    const res: R[] = [];
    const chunkSize: number = options?.chunkSize ?? 50;

    for (let i: number = 0; i < items.length; i += chunkSize) {
        const promises: (R | Promise<R>)[] = items.slice(i, i + chunkSize).map(fn);
        res.push(...await Promise.all(promises));
    }

    return res;
}