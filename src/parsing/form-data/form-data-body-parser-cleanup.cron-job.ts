import { Dirent } from 'node:fs';

import { CLEANUP_AT_FILE_NAME } from './form-data.model';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { FsUtilities, FsPath } from '../../utilities/fs.utilities';

/**
 * CronJob that cleans up the temp folder of the form data body parser.
 */
@Injectable()
export class FormDataBodyParserCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'FormDataBodyParser Cleanup',
        cron: '0 0 * * *',
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const tempPath: FsPath = inject(ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER);

        await this.logger.info(`cleans up temp folder ${tempPath}`);

        try {
            const folders: Dirent[] = await FsUtilities.readdir(tempPath);

            let foldersToPreserve: number = 0;
            for (const folder of folders) {
                try {
                    const folderPath: FsPath = FsUtilities.getPath(tempPath, folder.parentPath, folder.name);
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