import type { GlideClient, GlideString } from '@valkey/valkey-glide';

/**
 * Collects all keys that match the given pattern using a cursor based scan.
 * @param client - The client to scan with.
 * @param pattern - The glob style pattern that the keys need to match.
 * @returns All matching keys.
 */
export async function scanValKeyKeys(client: GlideClient, pattern: string): Promise<string[]> {
    const res: string[] = [];
    let cursor: string = '0';

    do {
        const [nextCursor, keys]: [GlideString, GlideString[]] = await client.scan(cursor, { match: pattern, count: 250 });
        cursor = toText(nextCursor);
        res.push(...keys.map(k => toText(k)));
    }
    while (cursor !== '0');

    return res;
}

/**
 * Converts a value that valkey returned to a string.
 * @param value - The value to convert.
 * @returns The value as a string.
 */
function toText(value: GlideString): string {
    return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
}