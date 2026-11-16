import { Readable } from 'node:stream';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BACKUP_REPOSITORY_FOLDER } from './backup-format';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { FsBackupTransport } from './transports/fs.backup-transport';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * Which transport a restore takes a resource from: the next one, when the copy of one turns out broken.
 */

const firstFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-restore-transports-first-${UUIDUtilities.generate()}`);
const secondFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-restore-transports-second-${UUIDUtilities.generate()}`);

@BackupTransport()
class FirstFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('first-fs-backup-transport', firstFolder);
    }
}

@BackupTransport()
class SecondFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('second-fs-backup-transport', secondFolder);
    }
}

@DataSource()
class RestoreTransportsDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * A resource holding one value, stored on both transports.
 */
@Backup({ transports: [FirstFsBackupTransport, SecondFsBackupTransport], encrypt: true })
class TwiceStoredValue implements BackupResourceInterface {
    value: string = '';

    createBackupData(): Readable {
        return Readable.from([Buffer.from(this.value)]);
    }

    async restoreBackup(backupData: Readable): Promise<void> {
        const chunks: Buffer[] = [];
        for await (const chunk of backupData) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        this.value = Buffer.concat(chunks).toString();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

async function takeBackup(): Promise<BackupEntity> {
    return await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: `twice-${UUIDUtilities.generate()}` }));
}

/**
 * Deletes every chunk a transport holds, as a lifecycle rule of a bucket might.
 * @param folder - The folder of the transport.
 */
async function deleteChunks(folder: FsPath): Promise<void> {
    await FsUtilities.rm(FsUtilities.getPath(folder, BACKUP_REPOSITORY_FOLDER, 'chunks'));
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await Promise.all([FsUtilities.rm(firstFolder), FsUtilities.rm(secondFolder)]);
    server = await startTestServer({ dataSources: [RestoreTransportsDataSource] });
}, TestTimeouts.inMemory.start);

beforeEach(() => {
    inject(TwiceStoredValue).value = 'backed up';
});

afterAll(async () => {
    await server?.shutdown();
    await Promise.all([FsUtilities.rm(firstFolder), FsUtilities.rm(secondFolder)]);
}, TestTimeouts.inMemory.shutdown);

describe('BackupService - the transport a restore takes a resource from', () => {
    it('takes a resource from the next transport when the copy of the first one is missing a chunk', async () => {
        const backup: BackupEntity = await takeBackup();
        inject(TwiceStoredValue).value = 'current';
        await deleteChunks(firstFolder);

        await getBackupService().restore(backup);

        expect(inject(TwiceStoredValue).value).toBe('backed up');
    });

    it('fails, and changes nothing, when no transport holds the resource whole', async () => {
        const backup: BackupEntity = await takeBackup();
        inject(TwiceStoredValue).value = 'current';
        await Promise.all([deleteChunks(firstFolder), deleteChunks(secondFolder)]);

        await expect(getBackupService().restore(backup)).rejects.toThrow('holds nothing');

        expect(inject(TwiceStoredValue).value).toBe('current');
    });
});