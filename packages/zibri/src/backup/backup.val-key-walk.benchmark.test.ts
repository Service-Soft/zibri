import { describeBackupCosts } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { resolveFsTransport, resolveSeriesScenarios } from '../__testing__/benchmark/backup/backup-containers-benchmark.cases';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * What backups of valkey cost in the walk mode, through the fs transport, so that what is measured beyond
 * the pipeline, which `backup.benchmark.test.ts` measures, is the dump and the restore. A restore in place
 * of what is stored is measured by `backup.val-key-walk-direct.benchmark.test.ts`, a store that does not
 * change between backups by `backup.val-key-walk-unchanged.benchmark.test.ts`, and the snapshot mode by
 * the `backup.val-key-snapshot` suites.
 *
 * The measured process starts the valkey container itself, through the test server.
 *
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default.
 */

describeBackupCosts({
    name: 'backup-val-key-walk',
    baselinePath: FsUtilities.getPath(__dirname, 'backup-val-key-walk.baseline.json'),
    resolveScenarios: outputFolder => resolveSeriesScenarios([
        {
            name: 'of valkey, walked',
            resource: bytes => ({ kind: 'val-key', backupMode: 'walk', restoreMode: 'staged', bytes }),
            transport: resolveFsTransport(outputFolder)
        }
    ])
});