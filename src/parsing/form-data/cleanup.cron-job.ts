import { readdir, rm, readFile } from 'fs/promises';
import path from 'path';

import { CLEANUP_AT_FILE_NAME } from './form-data.model';
import { CronJob, CronConfig } from '../../cron';
import { inject, Injectable, ZIBRI_DI_TOKENS } from '../../di';

@Injectable()
export class FormDataBodyParserCleanupCronJob extends CronJob {
    initialConfig: Partial<CronConfig> & Pick<CronConfig, 'name' | 'cron'> = {
        name: 'FormDataBodyParser Cleanup',
        cron: '0 0 * * *',
        runOnInit: false
    };

    async onTick(): Promise<void> {
        const tempPath: string = inject(ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER);

        this.logger.info('cleans up temp folder', tempPath);

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

            this.logger.info('removed', folders.length - foldersToPreserve, 'out of', folders.length, 'folders');
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