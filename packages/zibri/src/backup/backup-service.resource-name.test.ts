import assert from 'node:assert';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model.ts';
import { BackupResourceEntity } from './backup-resource-entity.model.ts';
import { BackupResourceInterface } from './backup-resource.interface.ts';
import { BackupServiceInterface } from './backup-service.interface.ts';
import { Backup } from './decorators/backup-resource.decorator.ts';
import { BackupTransport } from './decorators/backup-transport.decorator.ts';
import { BaseFsBackupTransport } from './transports/fs.backup-transport.ts';
import { testFileFolder } from '../__testing__/constants.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { DataSource } from '../data-source/decorators/data-source.decorator.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { BaseEntity } from '../entity/base-entity.model.ts';
import { Newable } from '../types/newable.type.ts';
import { FsPath, FsUtilities } from '../utilities/fs.utilities.ts';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-resource-name');

@BackupTransport()
class ResourceNameFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'resource-name-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

@DataSource()
class ResourceNameDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
}

@Backup({ name: 'settings', transports: [ResourceNameFsBackupTransport], encrypt: false })
class NamedSettingsStore implements BackupResourceInterface {
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

describe('BackupService — a resource with a name of its own', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        await FsUtilities.rm(backupFolder);
        server = await startTestServer({ dataSources: [ResourceNameDataSource] });
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(backupFolder);
    }, 30000);

    it('is backed up and restored under that name', async () => {
        inject(NamedSettingsStore).value = 'backed up';
        await getBackupService().createBackup({ name: 'named' });
        const [backup]: BackupEntity[] = await inject(repositoryTokenFor(BackupEntity)).findAll({
            where: { name: 'named' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');
        expect(backup.resources.map(r => [r.name, r.completed])).toEqual([['settings', true]]);
        inject(NamedSettingsStore).value = 'current';

        await getBackupService().restore(backup);

        expect(inject(NamedSettingsStore).value).toBe('backed up');
    }, 15000);
});