import { describeBackupCosts } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { resolveFsTransport, resolveSeriesScenarios } from '../__testing__/benchmark/backup/backup-containers-benchmark.cases';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * What backups of postgres cost, through the fs transport, so that what is measured beyond the pipeline,
 * which `backup.benchmark.test.ts` measures, is the dump and the restore. A backup reading only what
 * changed is measured by `backup.postgres-incremental.benchmark.test.ts`.
 *
 * The measured process starts the postgres container itself, through the test server. A dump is written
 * by the `pg_dump` on PATH.
 *
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default.
 */

describeBackupCosts({
    name: 'backup-postgres',
    baselinePath: FsUtilities.getPath(__dirname, 'backup-postgres.baseline.json'),
    // both in one suite, and so on one runner: the first is compared with the second
    resolveScenarios: outputFolder => resolveSeriesScenarios([
        // the dump uncompressed, as a backup cutting it into chunks takes it, against pg_dump compressing it
        {
            name: 'of postgres',
            resource: bytes => ({ kind: 'postgres', compressedDump: false, incrementalRead: false, bytes }),
            transport: resolveFsTransport(outputFolder),
            comparedWith: 'of postgres, dump compressed'
        },
        {
            name: 'of postgres, dump compressed',
            resource: bytes => ({ kind: 'postgres', compressedDump: true, incrementalRead: false, bytes }),
            transport: resolveFsTransport(outputFolder)
        }
    ])
});