import { Readable } from 'node:stream';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
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
 * Whether a restore keeps a copy of what a resource holds to put back: not for a resource restored alone
 * whose restore changes everything or nothing by itself, which then needs half the disk.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-restore-snapshot-${UUIDUtilities.generate()}`);

@BackupTransport()
class SnapshotFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('snapshot-fs-backup-transport', backupFolder);
    }
}

@DataSource()
class SnapshotDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * A resource holding one value, which says whether its restore is whole, and notes what the staging folder
 * holds while it is applied.
 */
abstract class NotedStore implements BackupResourceInterface {
    value: string = '';

    restoresWhole: boolean = true;

    failsApplying: boolean = false;

    /**
     * The snapshots the staging folder held while the last restore applied this resource.
     */
    snapshotsWhileApplying: string[] = [];

    createBackupData(): Readable {
        return Readable.from([Buffer.from(this.value)]);
    }

    async restoreBackup(backupData: Readable): Promise<void> {
        const chunks: Buffer[] = [];
        for await (const chunk of backupData) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        this.snapshotsWhileApplying = (await FsUtilities.readdir(inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER)))
            .map(f => f.name)
            .filter(name => name.endsWith('-before'));
        if (this.failsApplying) {
            throw new Error('the uniques could not be brought in line');
        }
        this.value = Buffer.concat(chunks).toString();
    }

    async resolveRestoresWhole(backupData: Readable): Promise<boolean> {
        backupData.destroy();
        return await Promise.resolve(this.restoresWhole);
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

@Backup({ transports: [SnapshotFsBackupTransport], encrypt: false })
class FirstNotedStore extends NotedStore {}

@Backup({ transports: [SnapshotFsBackupTransport], encrypt: false })
class SecondNotedStore extends NotedStore {}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

async function takeBackup(): Promise<BackupEntity> {
    return await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: `snapshot-${UUIDUtilities.generate()}` }));
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [SnapshotDataSource] });
}, TestTimeouts.inMemory.start);

beforeEach(() => {
    for (const store of [inject(FirstNotedStore), inject(SecondNotedStore)]) {
        store.value = 'backed up';
        store.restoresWhole = true;
        store.failsApplying = false;
        store.snapshotsWhileApplying = [];
    }
});

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.inMemory.shutdown);

describe('BackupService - the copy a restore keeps to put back', () => {
    it('keeps none of a resource restored alone whose restore is whole', async () => {
        const backup: BackupEntity = await takeBackup();
        inject(FirstNotedStore).value = 'current';
        await getBackupService().restore({ ...backup, resources: backup.resources.filter(r => r.name === FirstNotedStore.name) });

        expect(inject(FirstNotedStore).value).toBe('backed up');
        expect(inject(FirstNotedStore).snapshotsWhileApplying).toStrictEqual([]);
    });

    it('keeps one of every resource when several are restored, whole or not', async () => {
        const backup: BackupEntity = await takeBackup();
        await getBackupService().restore(backup);

        expect(inject(FirstNotedStore).snapshotsWhileApplying).toHaveLength(2);
    });

    it('keeps one of a resource restored alone whose restore is not whole', async () => {
        const backup: BackupEntity = await takeBackup();
        inject(FirstNotedStore).restoresWhole = false;
        await getBackupService().restore({ ...backup, resources: backup.resources.filter(r => r.name === FirstNotedStore.name) });

        expect(inject(FirstNotedStore).snapshotsWhileApplying).toHaveLength(1);
    });

    it('says that no copy was kept, and that the data may be in place, when such a restore fails', async () => {
        const backup: BackupEntity = await takeBackup();
        inject(FirstNotedStore).failsApplying = true;

        await expect(getBackupService().restore({ ...backup, resources: backup.resources.filter(r => r.name === FirstNotedStore.name) }))
            .rejects.toThrow('no copy to put back was kept');
    });
});