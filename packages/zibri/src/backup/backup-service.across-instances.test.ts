import assert from 'node:assert';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { BackupStatus } from './backup-status.enum';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { BaseFsBackupTransport } from './transports/fs.backup-transport';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { ConflictError } from '../error-handling/errors/conflict.error';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-across-instances');

@BackupTransport()
class AcrossInstancesFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'across-instances-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

@DataSource()
class AcrossInstancesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * A resource holding one value, whose restore can be held up.
 */
@Backup({ transports: [AcrossInstancesFsBackupTransport], encrypt: false })
class HeldStore implements BackupResourceInterface {
    value: string = '';

    /**
     * Run once, before the next restore applies anything.
     */
    beforeNextApply: (() => Promise<void>) | undefined;

    /**
     * What happened to it, in order: `'read'` for a backup taking its data, `'applied'` for a restore.
     */
    readonly happened: string[] = [];

    createBackupData(): Readable {
        this.happened.push('read');
        return Readable.from([Buffer.from(this.value)]);
    }

    async restoreBackup(backupData: Readable): Promise<void> {
        const before: (() => Promise<void>) | undefined = this.beforeNextApply;
        this.beforeNextApply = undefined;
        await before?.();
        const chunks: Buffer[] = [];
        for await (const chunk of backupData) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        this.value = Buffer.concat(chunks).toString();
        this.happened.push('applied');
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

/**
 * A restore held up before it applies anything.
 */
type HeldRestore = {
    /**
     * Lets the restore go on.
     */
    letGo: () => void,
    /**
     * What the restore ends with.
     */
    ended: Promise<void>
};

/**
 * Starts a restore of a backup and resolves once it is about to apply the resource.
 * @param backup - The backup to restore.
 * @returns The held restore.
 */
async function startHeldRestore(backup: BackupEntity): Promise<HeldRestore> {
    let letGo: () => void = () => undefined;
    const released: Promise<void> = new Promise(resolve => letGo = resolve);
    let reached: boolean = false;
    inject(HeldStore).beforeNextApply = async () => {
        reached = true;
        await released;
    };
    const ended: Promise<void> = getBackupService().restore(backup);
    await waitUntil(() => reached);
    return { letGo, ended };
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

// whether a backup or a restore was running was known to the process running it
// and to no other, so two instances restored at once, or one backed up what another was replacing
describe('BackupService — backups and restores across instances', () => {
    let server: StartedTestServer | undefined;
    let backup: BackupEntity;

    beforeAll(async () => {
        await FsUtilities.rm(backupFolder);
        server = await startTestServer({
            dataSources: [AcrossInstancesDataSource],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_RETRY_DELAY_IN_MS, useValue: 100 })
            ]
        });
        inject(HeldStore).value = 'backed up';
        const service: BackupServiceInterface = getBackupService();
        await service.waitForBackup(await service.queueBackup({ name: 'restored' }));
        const [stored] = await inject(repositoryTokenFor(BackupEntity)).findAll({ where: { name: 'restored' }, relations: ['resources'] });
        assert(stored, 'the backup was not created');
        backup = stored;
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(backupFolder);
    }, TestTimeouts.inMemory.shutdown);

    it('refuses a restore of a resource that is being restored, and names it', async () => {
        const held: HeldRestore = await startHeldRestore(backup);
        try {
            await expect(getBackupService().restore(backup)).rejects.toThrow(ConflictError);
            await expect(getBackupService().restore(backup)).rejects.toThrow('HeldStore');
        }
        finally {
            held.letGo();
            await held.ended;
        }
        expect(inject(HeldStore).value).toBe('backed up');
    }, TestTimeouts.inMemory.start);

    it('reads no resource while it is being restored, and reads it once the restore is done', async () => {
        const store: HeldStore = inject(HeldStore);
        store.value = 'current';
        const held: HeldRestore = await startHeldRestore(backup);
        // what the restore read itself, to put back on a failure, is done by now
        store.happened.length = 0;
        let queued: BackupEntity | undefined;
        try {
            queued = await getBackupService().queueBackup({ name: 'during-a-restore' });
            // long enough for the pass the queueing starts to reach the resource
            await sleep(300);
        }
        finally {
            held.letGo();
            await held.ended;
        }

        expect((await getBackupService().waitForBackup(queued)).status).toBe(BackupStatus.COMPLETED);
        expect(store.happened).toEqual(['applied', 'read']);
    }, TestTimeouts.inMemory.start);
});