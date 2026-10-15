import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { BackupTransportInterface } from './transports/backup-transport.interface';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Logger } from '../logging/logger';
import { Newable } from '../types/newable.type';

/**
 * A transport whose server cannot be reached, the way one that is down or refusing this application fails.
 */
@BackupTransport()
class UnreachableBackupTransport implements BackupTransportInterface {
    readonly name: string = 'unreachable-backup-transport';

    resolveBackups(): string[] {
        throw new Error('connect ECONNREFUSED backups.example.com:22');
    }

    storeData(): void {
        throw new Error('not reached by these tests');
    }

    storeMetadata(): void {
        throw new Error('not reached by these tests');
    }

    retrieveData(): never {
        throw new Error('not reached by these tests');
    }

    deleteData(): void {
        throw new Error('not reached by these tests');
    }

    deleteMetadata(): void {
        throw new Error('not reached by these tests');
    }
}

@DataSource()
@Backup({ transports: [UnreachableBackupTransport], encrypt: false })
class BackedUpDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
}

describe('BackupService', () => {
    let server: StartedTestServer | undefined;
    // on the class rather than on an instance: the sync runs while the application starts, before a
    // test can reach the logger it starts with
    const warn: jest.SpiedFunction<Logger['warn']> = jest.spyOn(Logger.prototype, 'warn');

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [BackedUpDataSource] });
    }, 30000);

    afterAll(async () => {
        warn.mockRestore();
        await server?.shutdown();
    }, 30000);

    it('starts although a transport cannot be read, and says which one', () => {
        // a backup server having a bad day must not keep the application from starting
        expect(server).toBeDefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"unreachable-backup-transport"'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    });

    it('fails a sync somebody asked for when a transport cannot be read', async () => {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);

        await expect(backupService.syncBackupEntities()).rejects.toThrow('ECONNREFUSED');
    });
});