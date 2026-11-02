import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Batch, GlideClient } from '@valkey/valkey-glide';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { applyGuardedValKeyWrites, ValKeyWriteGuards } from './apply-guarded-val-key-writes.function';
import { queueValKeyWrite } from './queue-val-key-write.function';
import { ValKeyBufferedWrite } from './val-key-transaction.model';
import { BenchmarkTiming } from '../../__testing__/benchmark/benchmark-timing.model';
import { BenchmarkUtilities } from '../../__testing__/benchmark/benchmark.utilities';
import { testFileFolder, TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { valKeyGlide } from '../data-sources/val-key/val-key-glide.function';

/**
 * What a valkey transaction costs to commit through the guard script, against committing the same
 * writes as an atomic batch: whether handing every write to the script as one json argument costs a
 * large transaction more than the batch an unguarded one was sent as. It measured half, so every
 * commit goes through the script; this keeps the comparison in view.
 *
 * The same writes both ways, timed on their own rather than through a repository, since a repository
 * write that brings a guard also reads and checks the keys it declares, which would be timed with it.
 * Nothing here fails on the numbers - see `BenchmarkUtilities`.
 *
 * `npm run test:benchmark` runs it. Setting `ZIBRI_BENCHMARK_UPDATE_BASELINE=1` makes the run the new
 * baseline of this machine; the file is not committed. `npm run test:benchmark:compare` sets it against
 * the release instead, which is what CI fails a slower operation on.
 */

/**
 * How many rows a transaction writes, and how often a commit of that many is timed.
 */
const SIZES: { rows: number, runs: number }[] = [
    { rows: 10, runs: 200 },
    { rows: 1000, runs: 30 },
    { rows: 10_000, runs: 10 }
];

/**
 * How many fields each row has, about what an entity of a few properties holds.
 */
const FIELDS_PER_ROW: number = 10;

const baselinePath: FsPath = FsUtilities.getPath(__dirname, 'apply-guarded-val-key-writes.baseline.json');

const reportPath: FsPath = FsUtilities.getPath(testFileFolder, 'apply-guarded-val-key-writes.benchmark-report.json');

// the framework's own entities in memory, so that nothing but what is timed talks to valkey
const frameworkDataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource();

const prefix: string = `benchmark-${UUIDUtilities.generate()}`;

let server: StartedTestServer | undefined;
let client: GlideClient;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [frameworkDataSourceClass, valKeyDataSourceClass] });
    client = inject(valKeyDataSourceClass).connection;
}, TestTimeouts.valKey.start);

afterAll(async () => {
    const keys: string[] = SIZES.flatMap(({ rows }) => ['guarded', 'batched'].flatMap(path => resolveWrites(path, rows).map(w => w.key)));
    for (let i: number = 0; i < keys.length; i += 1000) {
        await client.del(keys.slice(i, i + 1000));
    }
    await server?.shutdown();
}, TestTimeouts.valKey.shutdown);

/**
 * Resolves the writes of a transaction creating the given number of rows.
 * @param path - Which way they are committed, which keeps the keys of the two apart.
 * @param rows - How many rows.
 * @returns One hash write per row.
 */
function resolveWrites(path: string, rows: number): ValKeyBufferedWrite[] {
    return Array.from({ length: rows }, (_, row) => ({
        type: 'hashSet',
        key: `${prefix}:${path}:${rows}:${row}`,
        values: Object.fromEntries(Array.from({ length: FIELDS_PER_ROW }, (__, field) => [`field${field}`, `value ${field} of row ${row}`]))
    }));
}

/**
 * Commits writes the way a transaction without a guard does: as one atomic batch.
 * @param writes - The writes.
 */
async function commitAsBatch(writes: ValKeyBufferedWrite[]): Promise<void> {
    const batch: Batch = new (valKeyGlide().Batch)(true);
    for (const write of writes) {
        queueValKeyWrite(batch, write);
    }
    expect(await client.exec(batch, true)).not.toBeNull();
}

describe('committing a valkey transaction behind a guard', () => {
    it('measures the guard script against an atomic batch of the same writes', async () => {
        // one guarded key, which holds nothing and so passes: what a transaction holding a lock or
        // reading a key declaration sends along
        const guards: ValKeyWriteGuards = { values: new Map([[`${prefix}:guard`, '']]), hashes: new Map() };
        const timings: BenchmarkTiming[] = [];
        // the connection the setup opened, held here so that every measured commit goes through it
        const connection: GlideClient = client;
        for (const { rows, runs } of SIZES) {
            const guarded: ValKeyBufferedWrite[] = resolveWrites('guarded', rows);
            const batched: ValKeyBufferedWrite[] = resolveWrites('batched', rows);
            timings.push(await BenchmarkUtilities.resolveTiming(`guarded commit of ${rows} rows`, runs, async () => {
                expect(await applyGuardedValKeyWrites(connection, guards, guarded)).toBe(true);
            }));
            timings.push(await BenchmarkUtilities.resolveTiming(`batched commit of ${rows} rows`, runs, async () => await commitAsBatch(batched)));
        }

        // both wrote the same rows
        const last: number = SIZES.at(-1)?.rows ?? 0;
        expect(await client.hgetall(`${prefix}:guarded:${last}:${last - 1}`)).toEqual(await client.hgetall(`${prefix}:batched:${last}:${last - 1}`));

        const report: string = await BenchmarkUtilities.resolveReport(
            timings,
            reportPath,
            baselinePath,
            process.env['ZIBRI_BENCHMARK_UPDATE_BASELINE'] === '1'
        );
        const ratios: string[] = SIZES.map(({ rows }) => {
            const guarded: number | undefined = timings.find(t => t.name === `guarded commit of ${rows} rows`)?.medianMs;
            const batched: number | undefined = timings.find(t => t.name === `batched commit of ${rows} rows`)?.medianMs;
            return `${rows} rows: guarded takes ${guarded == undefined || batched == undefined ? '-' : (guarded / batched).toFixed(2)}x the batch`;
        });
        process.stdout.write(`\n${report}\n\n${ratios.join('\n')}\n\n`);

        expect(timings.every(t => Number.isFinite(t.medianMs) && Number.isFinite(t.p95Ms))).toBe(true);
    }, 600000);
});