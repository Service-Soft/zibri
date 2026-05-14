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
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER)
        private readonly tempPath: FsPath
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.logger.info(`cleans up temp folder ${this.tempPath}`);

        try {
            const folders: Dirent[] = await FsUtilities.readdir(this.tempPath);

            let foldersToPreserve: number = 0;
            for (const folder of folders) {
                try {
                    const folderPath: FsPath = FsUtilities.getPath(this.tempPath, folder.parentPath, folder.name);
                    const shouldBePreserved: boolean = await this.hasRecentlyBeenCreated(folderPath);

                    if (!shouldBePreserved) {
                        await FsUtilities.rm(folderPath);
                    }
                    else {
                        foldersToPreserve++;
                    }
                }
                catch {
                    // Do nothing
                }
            }

            await this.logger.info(`removed ${folders.length - foldersToPreserve} out of ${folders.length} folders`);
        }
        catch {
            // Do nothing
        }
    }

    private async hasRecentlyBeenCreated(folderPath: FsPath): Promise<boolean> {
        const cleanupAtPath: FsPath = FsUtilities.getPath(folderPath, CLEANUP_AT_FILE_NAME);
        try {
            // Check if the file/folder has been modified within the last 24 hours
            const cleanupAtMs: number = Number(await FsUtilities.readFile(cleanupAtPath));
            return Date.now() > cleanupAtMs;
        }
        catch {
            // Handle error if the file/folder doesn't exist or there was an issue accessing it
            return false;
        }
    }
}