import { describeBackupCosts, UNCHANGED } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { resolveFsTransport, resolveSeriesScenarios } from '../__testing__/benchmark/backup/backup-containers-benchmark.cases';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * What backups of valkey cost in the snapshot mode, through the fs transport, of a store that does not
 * change between them. One that changes is measured by `backup.val-key-snapshot.benchmark.test.ts`.
 *
 * The measured process starts the valkey container itself, through the test server.
 *
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default.
 */

describeBackupCosts({
    name: 'backup-val-key-snapshot-unchanged',
    baselinePath: FsUtilities.getPath(__dirname, 'backup-val-key-snapshot-unchanged.baseline.json'),
    resolveScenarios: outputFolder => resolveSeriesScenarios([
        // whether the keys come out in the same order each time, which is all that lets a store that did not
        // change deduplicate: the next backup sends its manifests and its record, and two chunks of slack
        {
            name: 'of valkey, snapshot, unchanged',
            resource: bytes => ({ kind: 'val-key', backupMode: 'snapshot', restoreMode: 'staged', bytes }),
            transport: resolveFsTransport(outputFolder),
            changes: UNCHANGED
        }
    ])
});