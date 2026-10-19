import { Dirent } from 'node:fs';

import { RestoreJournal } from './restore-journal.model';
import { RestoreJournalUtilities } from './restore-journal.utilities';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { FsUtilities, type FsPath } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

/**
 * How long a staged archive has to have gone untouched before it counts as abandoned.
 *
 * Longer than any single archive should take to write or fetch, because the file of a backup still
 * in progress looks exactly like the file of one that was interrupted - the only difference between
 * them is that one of them is still growing.
 */
const ABANDONED_AFTER_IN_MS: number = Ms.HOUR * 12;

/**
 * Removes staged backup data that no backup is using any more.
 *
 * A backup deletes what it staged when it is done, and when it fails - so what this finds is what a
 * process that was killed left behind, which nothing else is ever going to clean up. The journal of a
 * restore that was interrupted and the snapshots it names are kept, for the next start to put back.
 */
export class BackupStagingCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Backup Staging Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false,
        // the staging folder is on this instance's own filesystem and no other instance can see it,
        // so electing one would leave every other instance's leftovers to fill its disk
        distributed: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER)
        private readonly stagingPath: FsPath
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        if (!await FsUtilities.exists(this.stagingPath)) {
            return;
        }
        this.logger.info(`cleans up staged backup data in ${this.stagingPath}`);

        const files: Dirent[] = await FsUtilities.readdir(this.stagingPath);
        const needed: Set<FsPath> = await this.resolveNeededByInterruptedRestores();
        let removed: number = 0;
        for (const file of files) {
            const p: FsPath = FsUtilities.getPath(this.stagingPath, file.name);
            // however old: they are what the next start puts a half finished restore back from
            if (needed.has(p)) {
                continue;
            }
            try {
                // when it was last written to rather than when it was created, so an archive that is
                // still being written is never mistaken for one that stopped
                const lastWrittenMs: number = (await FsUtilities.stat(p)).mtimeMs;
                if (Date.now() - lastWrittenMs < ABANDONED_AFTER_IN_MS) {
                    continue;
                }
                await FsUtilities.rm(p);
                removed++;
            }
            catch {
                // gone already, or being written by something that holds it. Either is fine to leave
            }
        }

        this.logger.info(`removed ${removed} out of ${files.length} staged files`);
    }

    /**
     * Resolves the journals of restores that were interrupted, and the snapshots they name.
     * @returns Their paths.
     */
    private async resolveNeededByInterruptedRestores(): Promise<Set<FsPath>> {
        const needed: Set<FsPath> = new Set();
        for (const p of await RestoreJournalUtilities.findPaths(this.stagingPath)) {
            needed.add(p);
            try {
                const journal: RestoreJournal = await RestoreJournalUtilities.resolve(p);
                for (const entry of journal.applied) {
                    needed.add(entry.snapshotPath);
                }
            }
            catch {
                // a journal that cannot be read names nothing, and the start that finds it says so
            }
        }
        return needed;
    }
}