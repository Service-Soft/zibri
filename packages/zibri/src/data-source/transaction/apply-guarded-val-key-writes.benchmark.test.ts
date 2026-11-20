import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { GlideClient } from '@valkey/valkey-glide';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

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
import { applyGuardedValKeyWrites, ValKeyWriteGuards } from './apply-guarded-val-key-writes.function';
import { ValKeyBufferedWrite } from './val-key-transaction.model';

/**
 * What valkey writes cost to commit through the guard script, which every write goes through, those
 * of a transaction and those outside of one.
 *
 * Once set against an atomic batch of the same writes, to find out whether handing every write to the
 * script as one json argument costs a large transaction more than the batch. It measured half from a
 * thousand rows up, and a batch has stopped being a way to commit since: the script is what hands a
 * backup copying on write each key as it was before. The batch timed nothing of the framework.
 *
 * The writes are timed on their own rather than through a repository, since a repository write that
 * brings a guard also reads and checks the keys it declares, which would be timed with it.
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
    const keys: string[] = SIZES.flatMap(({ rows }) => resolveWrites(rows).map(w => w.key));
    for (let i: number = 0; i < keys.length; i += 1000) {
        await client.del(keys.slice(i, i + 1000));
    }
    await server?.shutdown();
}, TestTimeouts.valKey.shutdown);

/**
 * Resolves the writes of a transaction creating the given number of rows.
 * @param rows - How many rows.
 * @returns One hash write per row.
 */
function resolveWrites(rows: number): ValKeyBufferedWrite[] {
    return Array.from({ length: rows }, (_, row) => ({
        type: 'hashSet',
        key: `${prefix}:${rows}:${row}`,
        values: Object.fromEntries(Array.from({ length: FIELDS_PER_ROW }, (__, field) => [`field${field}`, `value ${field} of row ${row}`]))
    }));
}

describe('committing a valkey transaction behind a guard', () => {
    it('measures a commit through the guard script', async () => {
        // one guarded key, which holds nothing and so passes: what a transaction holding a lock or
        // reading a key declaration sends along
        const guards: ValKeyWriteGuards = { values: new Map([[`${prefix}:guard`, '']]), hashes: new Map() };
        const timings: BenchmarkTiming[] = [];
        // the connection the setup opened, held here so that every measured commit goes through it
        const connection: GlideClient = client;
        for (const { rows, runs } of SIZES) {
            const writes: ValKeyBufferedWrite[] = resolveWrites(rows);
            // named as it was beside the batch, which keeps it a row the release is compared with
            timings.push(await BenchmarkUtilities.resolveTiming(`guarded commit of ${rows} rows`, runs, async () => {
                expect(await applyGuardedValKeyWrites(connection, inject(valKeyDataSourceClass).keyPrefix, guards, writes)).toBe(true);
            }));
        }

        // the rows are there: a commit that wrote nothing would be a fast one
        const last: number = SIZES.at(-1)?.rows ?? 0;
        // eslint-disable-next-line cspell/spellchecker
        expect(await client.hlen(`${prefix}:${last}:${last - 1}`)).toBe(FIELDS_PER_ROW);

        const report: string = await BenchmarkUtilities.resolveReport(
            timings,
            reportPath,
            baselinePath,
            process.env['ZIBRI_BENCHMARK_UPDATE_BASELINE'] === '1'
        );
        process.stdout.write(`\n${report}\n\n`);

        expect(timings.every(t => Number.isFinite(t.medianMs) && Number.isFinite(t.p95Ms))).toBe(true);
    }, 600000);
});