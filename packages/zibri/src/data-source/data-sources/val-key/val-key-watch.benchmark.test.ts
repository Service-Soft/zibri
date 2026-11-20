import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { GlideClient, GlideReturnType } from '@valkey/valkey-glide';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ValKeyDataSource } from './val-key-data-source.model';
import { valKeyGlide } from './val-key-glide.function';

/**
 * What it costs the server to `WATCH` every key a backup reads, as a backup copying on write would to
 * tell a write it did not see, one sent past the data source, from none: the memory each watched key
 * holds until the backup ends, how long one more `WATCH` takes the more the connection watches already,
 * and how long the `EXEC` that lets go of them takes. Decides whether such a backup watches. Printed,
 * since the cost is Valkey's rather than this build's; what fails is a write to a watched key going
 * unseen.
 *
 * Watching 100 000 keys this way had one call of 250 outlast a request timeout of 250 ms, with the server
 * answering nobody meanwhile: the sizes here stop where a call still answers within seconds.
 *
 * `npm run test:benchmark` runs it.
 */

/**
 * How many keys are watched at once, from a store of that many keys.
 */
const SIZES: number[] = [2000, 8000, 32_000];

/**
 * How many keys one `WATCH` names: what a walk reads in one batch.
 */
const WATCH_BATCH: number = 250;

/**
 * How many keys one write while filling the store names.
 */
const FILL_BATCH: number = 1000;

/**
 * How long the watching connection waits for one answer: long enough for the slowest call measured to
 * be measured rather than given up on.
 */
const WATCH_REQUEST_TIMEOUT_IN_MS: number = 60_000;

const MIB: number = 1024 * 1024;

// the framework's own entities in memory, so that nothing but what is measured talks to valkey
const frameworkDataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource();

/**
 * Names as long as the data source's: a prefix, the table and the id of a row.
 */
const prefix: string = `watch-${UUIDUtilities.generate()}:measured_row`;

let server: StartedTestServer | undefined;
/**
 * The data source's connection, which writes as any other client of the server does.
 */
let writer: GlideClient;
/**
 * A connection of its own, since what a connection watches is the connection's: the data source's
 * sends batches of its own, which an `EXEC` would refuse for a key watched here.
 */
let watcher: GlideClient | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [frameworkDataSourceClass, valKeyDataSourceClass] });
    const dataSource: ValKeyDataSource = inject(valKeyDataSourceClass);
    writer = dataSource.connection;
    // as the data source connects
    const { host = 'localhost', port = 6379 } = dataSource.options;
    watcher = await valKeyGlide().GlideClient.createClient({ addresses: [{ host, port }], requestTimeout: WATCH_REQUEST_TIMEOUT_IN_MS });
}, TestTimeouts.valKey.start);

afterAll(async () => {
    watcher?.close();
    await server?.shutdown();
}, TestTimeouts.valKey.shutdown);

/**
 * The memory the server uses.
 * @returns Its `used_memory`, in bytes.
 */
async function resolveUsedMemory(): Promise<number> {
    const info: string = await writer.info([valKeyGlide().InfoOptions.Memory]);
    return Number(/^used_memory:(\d+)\r?$/m.exec(info)?.[1] ?? Number.NaN);
}

/**
 * Writes keys up to the given count, a small value each: what is watched is the name of a key, not its value.
 * @param keys - Every key, of which those after the first `from` are written.
 * @param from - How many of them are there already.
 */
async function fill(keys: string[], from: number): Promise<void> {
    for (let i: number = from; i < keys.length; i += FILL_BATCH) {
        await writer.mset(Object.fromEntries(keys.slice(i, i + FILL_BATCH).map(key => [key, 'x'])));
    }
}

/**
 * Watches keys a batch at a time.
 * @param connection - The connection that watches them.
 * @param keys - The keys.
 * @returns How long each call took, in milliseconds, in order.
 */
async function watchAll(connection: GlideClient, keys: string[]): Promise<number[]> {
    const callMs: number[] = [];
    for (let i: number = 0; i < keys.length; i += WATCH_BATCH) {
        const startedAt: number = performance.now();
        await connection.watch(keys.slice(i, i + WATCH_BATCH));
        callMs.push(performance.now() - startedAt);
    }
    return callMs;
}

describe('watching every key a backup reads', () => {
    it('measures the memory and the time of watching the keys of a store, which tells a write to any of them', async () => {
        if (watcher == undefined) {
            throw new Error('The watching connection did not open.');
        }
        const connection: GlideClient = watcher;
        const largest: number = Math.max(...SIZES);
        const keys: string[] = Array.from({ length: largest }, () => `${prefix}:${UUIDUtilities.generate()}`);
        const lines: string[] = [];
        let filled: number = 0;
        try {
            for (const size of SIZES) {
                const watched: string[] = keys.slice(0, size);
                await fill(watched, filled);
                filled = size;

                const before: number = await resolveUsedMemory();
                const callMs: number[] = await watchAll(connection, watched);
                const held: number = await resolveUsedMemory() - before;

                // nothing written meanwhile: the transaction runs, and lets go of every key
                const execStartedAt: number = performance.now();
                const unchanged: GlideReturnType[] | null = await connection.exec(new (valKeyGlide().Batch)(true), true);
                const execMs: number = performance.now() - execStartedAt;
                expect(unchanged).not.toBeNull();

                const ms: (value: number) => string = value => `${value.toFixed(1)} ms`;
                lines.push(
                    `${size.toLocaleString('en')} keys: +${(held / MIB).toFixed(1)} MiB held while watched, ${(held / size).toFixed(0)} B a key; `
                    + `watched in ${ms(callMs.reduce((sum, t) => sum + t, 0))}, the first call of ${WATCH_BATCH} ${ms(callMs[0] ?? 0)}, `
                    + `the last ${ms(callMs.at(-1) ?? 0)}, the slowest ${ms(Math.max(...callMs))}; let go of by the EXEC in ${ms(execMs)}`
                );
            }

            // a write by another client to one of them, among as many as were watched, is told
            const smallest: string[] = keys.slice(0, Math.min(...SIZES));
            await watchAll(connection, smallest);
            await writer.set(smallest[Math.floor(smallest.length / 2)] ?? '', 'written past the backup');
            expect(await connection.exec(new (valKeyGlide().Batch)(true), true)).toBeNull();
        }
        finally {
            process.stdout.write(`\n${lines.join('\n')}\n\n`);
            for (let i: number = 0; i < filled; i += FILL_BATCH) {
                await writer.del(keys.slice(i, i + FILL_BATCH));
            }
        }
    }, 20 * 60 * 1000);
});