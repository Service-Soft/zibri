import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { describe, expect, it } from '@jest/globals';

import { BackupKeyNotFoundError } from './backup-key-not-found.error';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BackupTransportSupporting } from './backup-transport.interface';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

/**
 * More keys than the page of a listing holds, in every store.
 */
const MORE_THAN_A_PAGE: number = 1100;

/**
 * How long a case may take against a store across a network, a thousand keys put one by one included.
 */
const CASE_TIMEOUT_IN_MS: number = 120_000;

/**
 * Some random data, in the chunks a staged file is read in.
 * @param size - How many bytes.
 * @returns The chunks.
 */
function resolveRandomChunks(size: number): Buffer[] {
    const chunkSize: number = 64 * 1024;
    return Array.from({ length: Math.ceil(size / chunkSize) }, (_, i) => randomBytes(Math.min(chunkSize, size - (i * chunkSize))));
}

/**
 * Every key a listing finds under a prefix, with how many pages it took.
 * @param session - The session.
 * @param prefix - The prefix.
 * @returns The keys, sorted, and the number of pages.
 */
async function findAll(session: BackupTransportSessionInterface, prefix: string): Promise<{ keys: string[], pages: number }> {
    const keys: string[] = [];
    let pages: number = 0;
    for await (const page of session.findKeys(prefix)) {
        keys.push(...page);
        pages++;
    }
    return { keys: keys.sort(), pages };
}

/**
 * Every name a listing finds directly below a path, with how many pages it took.
 * @param session - The session.
 * @param path - The path.
 * @returns The names, sorted, and the number of pages.
 */
async function findAllNames(session: BackupTransportSessionInterface, path: string): Promise<{ names: string[], pages: number }> {
    const names: string[] = [];
    let pages: number = 0;
    for await (const page of session.findNames(path)) {
        names.push(...page);
        pages++;
    }
    return { names: names.sort(), pages };
}

/**
 * What every transport of `v2` answers the same way, whatever keeps its data.
 * @param name - What the transport is called in the report.
 * @param resolveTransport - The transport, once whatever it stores into runs.
 */
export function describeBackupTransport(name: string, resolveTransport: () => BackupTransportSupporting<'v2'>): void {
    describe(`${name}, as a transport`, () => {
        /**
         * Runs work on a session of its own, closed once the work is done.
         * @param work - The work.
         * @returns What it returned.
         */
        async function withSession<T>(work: (session: BackupTransportSessionInterface) => Promise<T>): Promise<T> {
            const session: BackupTransportSessionInterface = await resolveTransport().openSession();
            try {
                return await work(session);
            }
            finally {
                await session.close();
            }
        }

        // a folder of its own per case, so that what one leaves is nothing another finds
        const resolveFolder: () => string = () => `cases-${UUIDUtilities.generate()}`;

        it('hands back what was put under a key, byte for byte, on several calls of one session', async () => {
            const folder: string = resolveFolder();
            const chunks: Buffer[] = resolveRandomChunks((3 * 64 * 1024) + 5);
            const read: Buffer = await withSession(async session => {
                await session.put(`${folder}/data`, Readable.from(chunks));
                return await buffer(await session.get(`${folder}/data`, Buffer.concat(chunks).length));
            });

            expect(read.equals(Buffer.concat(chunks))).toBe(true);
        }, CASE_TIMEOUT_IN_MS);

        it('replaces what a key held', async () => {
            const folder: string = resolveFolder();
            const read: string = await withSession(async session => {
                await session.put(`${folder}/data`, Readable.from([Buffer.from('the first')]));
                await session.put(`${folder}/data`, Readable.from([Buffer.from('the second')]));
                return (await buffer(await session.get(`${folder}/data`, 1024))).toString();
            });

            expect(read).toBe('the second');
        }, CASE_TIMEOUT_IN_MS);

        it('leaves a key as it was when a put fails part way, and lists nothing of it', async () => {
            const folder: string = resolveFolder();
            const failing: Readable = Readable.from((function* failPartWay(): Generator<Buffer> {
                yield Buffer.from('the start of a replacement');
                throw new Error('the dump failed');
            })());

            const [read, found] = await withSession(async session => {
                await session.put(`${folder}/data`, Readable.from([Buffer.from('as it was')]));
                await expect(session.put(`${folder}/data`, failing)).rejects.toThrow('the dump failed');
                return [(await buffer(await session.get(`${folder}/data`, 1024))).toString(), (await findAll(session, folder)).keys];
            });

            expect(read).toBe('as it was');
            expect(found).toEqual([`${folder}/data`]);
        }, CASE_TIMEOUT_IN_MS);

        it('refuses a key that holds nothing as not found', async () => {
            await withSession(async session => {
                await expect(session.get(`${resolveFolder()}/missing`, 1024)).rejects.toBeInstanceOf(BackupKeyNotFoundError);
            });
        }, CASE_TIMEOUT_IN_MS);

        it('refuses a key that holds more than it may', async () => {
            const folder: string = resolveFolder();
            await withSession(async session => {
                await session.put(`${folder}/data`, Readable.from(resolveRandomChunks(2048)));
                // read to its end: a store that only finds out while the data arrives refuses there
                await expect(session.get(`${folder}/data`, 1024).then(async data => await buffer(data))).rejects.toThrow();
            });
        }, CASE_TIMEOUT_IN_MS);

        it('finds every key under a prefix once, across more than a page, and none outside it', async () => {
            const folder: string = resolveFolder();
            const keys: string[] = Array.from(
                { length: MORE_THAN_A_PAGE },
                (_, i) => `${folder}/inside/${String(i).padStart(4, '0')}`
            ).sort();
            const { keys: found, pages } = await withSession(async session => {
                // a few at a time, which a store across a network keeps up with
                for (let i: number = 0; i < keys.length; i += 50) {
                    await Promise.all(keys.slice(i, i + 50).map(async key => await session.put(key, Readable.from([Buffer.from(key)]))));
                }
                await session.put(`${folder}/outside`, Readable.from([Buffer.from('outside')]));
                return await findAll(session, `${folder}/inside/`);
            });

            expect(found).toEqual(keys);
            expect(pages).toBeGreaterThan(1);
        }, CASE_TIMEOUT_IN_MS);

        it('finds each name directly below a path once, across more than a page, and the names at the top', async () => {
            const folder: string = resolveFolder();
            const names: string[] = Array.from({ length: MORE_THAN_A_PAGE }, (_, i) => String(i).padStart(4, '0'));
            const [below, top] = await withSession(async session => {
                // a few at a time, which a store across a network keeps up with
                for (let i: number = 0; i < names.length; i += 50) {
                    await Promise.all(names.slice(i, i + 50).map(async (n, j) => {
                        await session.put(`${folder}/names/${n}/first`, Readable.from([Buffer.from(n)]));
                        // a second key below the first few, which they are still named once for
                        if (i + j < 10) {
                            await session.put(`${folder}/names/${n}/second`, Readable.from([Buffer.from(n)]));
                        }
                    }));
                }
                await session.put(`${folder}/names/a-key`, Readable.from([Buffer.from('a key')]));
                return [await findAllNames(session, `${folder}/names`), await findAllNames(session, '')];
            });

            expect(below.names).toEqual([...names, 'a-key'].sort());
            expect(below.pages).toBeGreaterThan(1);
            expect(top.names).toContain(folder);
            expect(top.names.filter(n => n.includes('/'))).toEqual([]);
        }, CASE_TIMEOUT_IN_MS);

        it('deletes keys, a key that holds nothing among them, and lists them no more', async () => {
            const folder: string = resolveFolder();
            const [found, named] = await withSession(async session => {
                await session.put(`${folder}/a/1`, Readable.from([Buffer.from('1')]));
                await session.put(`${folder}/a/2`, Readable.from([Buffer.from('2')]));
                await session.put(`${folder}/b`, Readable.from([Buffer.from('b')]));
                await session.delete([`${folder}/a/1`, `${folder}/a/2`, `${folder}/missing`]);
                await expect(session.get(`${folder}/a/1`, 1024)).rejects.toBeInstanceOf(BackupKeyNotFoundError);
                return [(await findAll(session, folder)).keys, (await findAllNames(session, folder)).names];
            });

            expect(found).toEqual([`${folder}/b`]);
            // a store keeping folders removes the one its last key left
            expect(named).toEqual(['b']);
        }, CASE_TIMEOUT_IN_MS);

        it('refuses a key that could lead outside where the store keeps its blobs', async () => {
            await withSession(async session => {
                for (const key of ['../outside', 'a//b', './a', 'a/']) {
                    await expect(session.put(key, Readable.from([Buffer.from('x')])))
                        .rejects.toThrow('needs to be segments separated by "/"');
                }
            });
        }, CASE_TIMEOUT_IN_MS);
    });
}