import { readdir, rm, readFile } from 'fs/promises';
import path from 'path';

import { CLEANUP_AT_FILE_NAME } from './form-data.model';
import { CronJob, InitialCronConfig } from '../../cron';
import { inject, Injectable, ZIBRI_DI_TOKENS } from '../../di';

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
        const tempPath: string = inject(ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER);

        this.logger.info(`cleans up temp folder ${tempPath}`);

        try {
            const folders: string[] = await readdir(tempPath);

            let foldersToPreserve: number = 0;
            for (const folder of folders) {
                try {
                    const folderPath: string = path.join(tempPath, folder);
                    const shouldBePreserved: boolean = await this.hasRecentlyBeenCreated(folderPath);

                    if (!shouldBePreserved) {
                        await rm(folderPath, { recursive: true });
                    }
                    else {
                        foldersToPreserve++;
                    }
                }
                catch {
                    // Do nothing
                }
            }

            this.logger.info(`removed ${folders.length - foldersToPreserve} out of ${folders.length} folders`);
        }
        catch {
            // Do nothing
        }
    }

    private async hasRecentlyBeenCreated(folderPath: string): Promise<boolean> {
        const cleanupAtPath: string = path.join(folderPath, CLEANUP_AT_FILE_NAME);
        try {
            // Check if the file/folder has been modified within the last 24 hours
            const cleanupAtMs: number = Number(await readFile(cleanupAtPath, 'utf8'));
            return Date.now() > cleanupAtMs;
        }
        catch {
            // Handle error if the file/folder doesn't exist or there was an issue accessing it
            return false;
        }
    }
}