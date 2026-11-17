import { describeBackupCosts } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { resolveFsTransport, resolveSeriesScenarios } from '../__testing__/benchmark/backup/backup-containers-benchmark.cases';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * What backups of valkey cost in the walk mode, through the fs transport, restored in place of what is
 * stored. A restore that stages the backup first is measured by `backup.val-key-walk.benchmark.test.ts`.
 *
 * The measured process starts the valkey container itself, through the test server.
 *
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default.
 */

describeBackupCosts({
    name: 'backup-val-key-walk-direct',
    baselinePath: FsUtilities.getPath(__dirname, 'backup-val-key-walk-direct.baseline.json'),
    resolveScenarios: outputFolder => resolveSeriesScenarios([
        // restored in place of what is stored: what the server holds and how long it answers nobody else, against staging
        {
            name: 'of valkey, walked, restored directly',
            resource: bytes => ({ kind: 'val-key', backupMode: 'walk', restoreMode: 'direct', bytes }),
            transport: resolveFsTransport(outputFolder)
        }
    ])
});