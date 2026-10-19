import { utimes } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { BackupStagingCleanupCronJob } from './backup-staging-cleanup.cron-job';
import { RestoreJournalUtilities } from './restore-journal.utilities';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { CronJobEntity, CreateCronJobEntityData } from '../cron/cron-job-entity.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

// in memory, because the job needs a running application and nothing of its data source
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

/**
 * Writes a file into the staging folder, last written the given time ago.
 * @param p - The file.
 * @param ageInMs - How long ago it was last written.
 */
async function stageFile(p: FsPath, ageInMs: number): Promise<void> {
    await FsUtilities.createFile(p, 'staged');
    const lastWritten: Date = new Date(Date.now() - ageInMs);
    await utimes(p, lastWritten, lastWritten);
}

/**
 * Runs the cleanup job once, built by hand, because the test server runs no cron jobs.
 * @param stagingFolder - The folder it cleans up.
 */
async function runCleanup(stagingFolder: FsPath): Promise<void> {
    const cleanup: BackupStagingCleanupCronJob = new BackupStagingCleanupCronJob(stagingFolder);
    const cronJobRepo: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
    await cleanup.init(inject(ZIBRI_DI_TOKENS.LOGGER), cronJobRepo, async () => await Promise.resolve(true));
    await cleanup.onTick();
}

describe('BackupStagingCleanupCronJob', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('removes what was abandoned, and keeps what is recent or what an interrupted restore still has to put back', async () => {
        const stagingFolder: FsPath = inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER);
        await FsUtilities.mkdir(stagingFolder);
        const abandoned: FsPath = FsUtilities.getPath(stagingFolder, 'abandoned');
        const recent: FsPath = FsUtilities.getPath(stagingFolder, 'recent');
        const needed: FsPath = FsUtilities.getPath(stagingFolder, 'needed-before');
        await stageFile(abandoned, Ms.DAY);
        await stageFile(recent, Ms.HOUR);
        await stageFile(needed, Ms.DAY);
        const journal: FsPath = RestoreJournalUtilities.getPath(stagingFolder, 'interrupted');
        await RestoreJournalUtilities.write(journal, {
            backupName: 'interrupted',
            applied: [{ resourceName: 'settings', snapshotPath: needed }]
        });
        await utimes(journal, new Date(Date.now() - Ms.DAY), new Date(Date.now() - Ms.DAY));

        await runCleanup(stagingFolder);

        expect(await FsUtilities.exists(abandoned)).toBe(false);
        expect(await FsUtilities.exists(recent)).toBe(true);
        expect(await FsUtilities.exists(needed)).toBe(true);
        expect(await FsUtilities.exists(journal)).toBe(true);
    });
});