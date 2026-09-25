import { Dirent } from 'node:fs';

import { CLEANUP_AT_FILE_NAME } from './form-data.model';
import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { FsUtilities, type FsPath } from '../../utilities/fs.utilities';

/**
 * CronJob that cleans up the temp folder of the form data body parser.
 */
export class FormDataBodyParserCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'FormDataBodyParser Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false,
        // the temp folder is on this instance's own filesystem and no other instance can see it,
        // so electing one would leave every other instance's uploads to fill its disk
        distributed: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER)
        private readonly tempPath: FsPath
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        this.logger.info(`cleans up temp folder ${this.tempPath}`);

        try {
            const folders: Dirent[] = await FsUtilities.readdir(this.tempPath);

            let removed: number = 0;
            for (const folder of folders) {
                try {
                    // the name alone: readdir already reports parentPath as this.tempPath, so
                    // joining both built a path that cannot exist. Removing it then did nothing at
                    // all - silently, because rm treats a missing path as already gone - while the
                    // line below reported every folder as removed.
                    const folderPath: FsPath = FsUtilities.getPath(this.tempPath, folder.name);

                    if (!await this.hasExpired(folderPath)) {
                        continue;
                    }
                    await FsUtilities.rm(folderPath);
                    removed++;
                }
                catch {
                    // Do nothing
                }
            }

            this.logger.info(`removed ${removed} out of ${folders.length} folders`);
        }
        catch {
            // Do nothing
        }
    }

    /**
     * Whether the folder has outlived the time it asked to be kept for.
     *
     * Named for what it answers. It used to be called hasRecentlyBeenCreated while returning the
     * opposite, and the caller read it as "preserve this" - so an expired folder was kept forever
     * and a live one was deleted.
     * @param folderPath - The upload folder to check.
     * @returns True once the folder's cleanup time has passed.
     */
    private async hasExpired(folderPath: FsPath): Promise<boolean> {
        const cleanupAtPath: FsPath = FsUtilities.getPath(folderPath, CLEANUP_AT_FILE_NAME);
        try {
            const cleanupAtMs: number = Number(await FsUtilities.readFile(cleanupAtPath));
            return Date.now() > cleanupAtMs;
        }
        catch {
            // no readable cleanup time, which is what an upload still being written looks like.
            // Keeping it costs a folder until the next run; removing it deletes a live upload.
            return false;
        }
    }
}