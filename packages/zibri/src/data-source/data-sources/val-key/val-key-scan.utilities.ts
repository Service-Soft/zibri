import type { GlideClient, GlideString, ObjectType } from '@valkey/valkey-glide';

/**
 * How many keys the server is asked to look at for one page of a scan.
 */
const SCAN_COUNT: number = 250;

/**
 * Finds the keys of a valkey server with a cursor based scan.
 */
export abstract class ValKeyScanUtilities {
    /**
     * Finds every key that matches the given pattern.
     * @param client - The client to scan with.
     * @param pattern - The glob style pattern that the keys need to match.
     * @param type - The kind of value the keys hold, when only keys of one kind are wanted.
     * @returns All matching keys.
     */
    static async findKeys(client: GlideClient, pattern: string, type?: ObjectType): Promise<string[]> {
        const res: string[] = [];
        for await (const keys of this.findKeyPages(client, pattern, type)) {
            res.push(...keys);
        }
        return res;
    }

    /**
     * Finds the keys that match the given pattern a page at a time, so that whoever reads them holds
     * one page rather than every key.
     *
     * A key that is there from the first page to the last is found at least once, and may be found
     * twice. Deleting the keys of a page before asking for the next is safe.
     * @param client - The client to scan with.
     * @param pattern - The glob style pattern that the keys need to match.
     * @param type - The kind of value the keys hold, when only keys of one kind are wanted.
     * @yields The matching keys of each page that holds any.
     */
    static async* findKeyPages(client: GlideClient, pattern: string, type?: ObjectType): AsyncGenerator<string[]> {
        let cursor: string = '0';
        do {
            const [nextCursor, keys]: [GlideString, GlideString[]] = await client.scan(cursor, { match: pattern, count: SCAN_COUNT, type });
            cursor = this.toText(nextCursor);
            if (keys.length) {
                yield keys.map(k => this.toText(k));
            }
        }
        while (cursor !== '0');
    }

    /**
     * Converts a value that valkey returned to a string.
     * @param value - The value to convert.
     * @returns The value as a string.
     */
    private static toText(value: GlideString): string {
        return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
    }
}