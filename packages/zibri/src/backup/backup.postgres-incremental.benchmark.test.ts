import { describeBackupCosts } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { resolveFsTransport, resolveSeriesScenarios } from '../__testing__/benchmark/backup/backup-containers-benchmark.cases';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * What backups of postgres cost that read only what changed, through the fs transport. A backup reading in
 * full each time is measured by `backup.postgres.benchmark.test.ts`.
 *
 * The measured process starts the postgres container itself, through the test server. A dump is written
 * by the `pg_dump` on PATH.
 *
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default.
 */

describeBackupCosts({
    name: 'backup-postgres-incremental',
    baselinePath: FsUtilities.getPath(__dirname, 'backup-postgres-incremental.baseline.json'),
    resolveScenarios: outputFolder => resolveSeriesScenarios([
        // each backup after the first reads only what changed: designed to produce about what changed. Not
        // compared with the full reads, since a restore applying the changes after the dump takes longer. A run
        // whose backups fall either side of midnight before a Monday, in UTC, reads in full at the second
        // one, as the first backup of a week does
        {
            name: 'of postgres, incremental',
            resource: bytes => ({ kind: 'postgres', compressedDump: false, incrementalRead: true, bytes }),
            transport: resolveFsTransport(outputFolder)
        }
    ])
});