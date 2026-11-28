import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { describe, expect, it } from '@jest/globals';

import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { FileStoreEntry } from './file-store-entry.model';
import { FileStoreKeyNotFoundError } from './file-store-key-not-found.error';
import { FileStoreInterface } from './file-store.interface';

/**
 * More keys than the page of a listing holds, in every store.
 */
const MORE_THAN_A_PAGE: number = 1100;

/**
 * How long a case may take against a store across a network, a thousand keys put one by one included.
 */
const CASE_TIMEOUT_IN_MS: number = 120_000;

/**
 * Every key a listing finds under a prefix, with how many pages it took.
 * @param store - The store.
 * @param prefix - The prefix.
 * @returns The keys, sorted, and the number of pages.
 */
async function findAll(store: FileStoreInterface, prefix: string): Promise<{ keys: string[], pages: number }> {
    const keys: string[] = [];
    let pages: number = 0;
    for await (const page of store.findKeys(prefix)) {
        keys.push(...page);
        pages++;
    }
    return { keys: keys.sort(), pages };
}

/**
 * What every file store answers the same way, whatever keeps its bytes.
 * @param name - What the store is called in the report.
 * @param resolveStore - The store, once whatever it stores into runs.
 */
export function describeFileStore(name: string, resolveStore: () => FileStoreInterface): void {
    describe(`${name}, as a file store`, () => {
        // a folder of its own per case, so that what one leaves is nothing another finds
        const resolveFolder: () => string = () => `cases-${UUIDUtilities.generate()}`;

        it('hands back what was put under a key, byte for byte', async () => {
            const key: string = `${resolveFolder()}/data`;
            const data: Buffer = randomBytes((3 * 64 * 1024) + 5);
            await resolveStore().put(key, Readable.from([data]));

            const read: Buffer = await buffer(await resolveStore().get(key, data.length));

            expect(read.equals(data)).toBe(true);
        }, CASE_TIMEOUT_IN_MS);

        it('replaces what a key held', async () => {
            const key: string = `${resolveFolder()}/data`;
            await resolveStore().put(key, Readable.from([Buffer.from('the first')]));
            await resolveStore().put(key, Readable.from([Buffer.from('the second')]));

            expect((await buffer(await resolveStore().get(key, 1024))).toString()).toBe('the second');
        }, CASE_TIMEOUT_IN_MS);

        it('refuses a key that holds nothing as not found', async () => {
            await expect(resolveStore().get(`${resolveFolder()}/missing`, 1024)).rejects.toBeInstanceOf(FileStoreKeyNotFoundError);
        }, CASE_TIMEOUT_IN_MS);

        it('refuses a key that holds more than it may', async () => {
            const key: string = `${resolveFolder()}/data`;
            await resolveStore().put(key, Readable.from([randomBytes(2048)]));

            // read to its end: a store that only finds out while the data arrives refuses there
            await expect((async (): Promise<Buffer> => await buffer(await resolveStore().get(key, 1024)))()).rejects.toThrow();
        }, CASE_TIMEOUT_IN_MS);

        it('finds the size of what a key holds and when it was written, and nothing of a key that holds nothing', async () => {
            const folder: string = resolveFolder();
            const before: number = Date.now();
            await resolveStore().put(`${folder}/data`, Readable.from([Buffer.from('twelve bytes')]));

            const entry: FileStoreEntry | undefined = await resolveStore().findEntry(`${folder}/data`);

            expect(entry?.size).toBe(12);
            // to the second, which is what a server or a bucket carries
            expect(entry?.modifiedAt.getTime()).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
            expect(await resolveStore().findEntry(`${folder}/missing`)).toBeUndefined();
            // a folder a store may keep for a key below it holds no key itself
            expect(await resolveStore().findEntry(folder)).toBeUndefined();
        }, CASE_TIMEOUT_IN_MS);

        it('finds every key under a prefix once, across more than a page, and none outside it', async () => {
            const folder: string = resolveFolder();
            const keys: string[] = Array.from(
                { length: MORE_THAN_A_PAGE },
                (_, i) => `${folder}/inside/${String(i).padStart(4, '0')}`
            ).sort();
            // a few at a time, which a store across a network keeps up with
            for (let i: number = 0; i < keys.length; i += 50) {
                await Promise.all(keys.slice(i, i + 50).map(async key => await resolveStore().put(key, Readable.from([Buffer.from(key)]))));
            }
            await resolveStore().put(`${folder}/outside`, Readable.from([Buffer.from('outside')]));

            const { keys: found, pages } = await findAll(resolveStore(), `${folder}/inside/`);

            expect(found).toEqual(keys);
            expect(pages).toBeGreaterThan(1);
        }, CASE_TIMEOUT_IN_MS);

        it('deletes keys, a key that holds nothing among them, and lists them no more', async () => {
            const folder: string = resolveFolder();
            await resolveStore().put(`${folder}/a/1`, Readable.from([Buffer.from('1')]));
            await resolveStore().put(`${folder}/a/2`, Readable.from([Buffer.from('2')]));
            await resolveStore().put(`${folder}/b`, Readable.from([Buffer.from('b')]));

            await resolveStore().delete([`${folder}/a/1`, `${folder}/a/2`, `${folder}/missing`]);

            await expect(resolveStore().get(`${folder}/a/1`, 1024)).rejects.toBeInstanceOf(FileStoreKeyNotFoundError);
            expect(await resolveStore().findEntry(`${folder}/a/2`)).toBeUndefined();
            expect((await findAll(resolveStore(), folder)).keys).toEqual([`${folder}/b`]);
        }, CASE_TIMEOUT_IN_MS);

        it('refuses a key that could lead outside where the store keeps its bytes', async () => {
            for (const key of ['../outside', 'a//b', './a', 'a/']) {
                await expect(resolveStore().put(key, Readable.from([Buffer.from('x')])))
                    .rejects.toThrow('needs to be segments separated by "/"');
            }
        }, CASE_TIMEOUT_IN_MS);
    });
}