import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { TenantBackupTransport } from './tenant/tenant-backup-transport.model';
import { TenantS3TransportSettings } from './tenant/tenant-s3-transport-settings.model';
import { FsBackupTransport } from './transports/fs.backup-transport';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { ValidationError } from '../error-handling/errors/validation.error';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * What a tenant may not configure as a transport, with the options as an application has them by default:
 * nothing inside the network the application runs in, and a bucket over https only.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-tenant-checks-${UUIDUtilities.generate()}`);

@Entity()
class CheckedNote extends BaseTenantEntity() {
    @Property.string()
    text!: string;
}

@BackupTransport()
class CheckedFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('checked-fs-backup-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [CheckedFsBackupTransport], encrypt: false })
class CheckedDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity, CheckedNote, TenantBackupTransport];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

const s3: TenantS3TransportSettings = {
    endpoint: 'https://127.0.0.1:9000',
    bucket: 'backups',
    region: 'us-east-1',
    accessKeyId: 'tenant-key',
    addressingStyle: 'path'
};

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

function getCreate(): NonNullable<BackupServiceInterface['createTenantBackupTransport']> {
    const create: BackupServiceInterface['createTenantBackupTransport'] = getBackupService().createTenantBackupTransport;
    assert(create, 'the backup service takes no transports of tenants');
    return create.bind(getBackupService());
}

async function findNames(tenantId: string): Promise<string[]> {
    return (await getBackupService().findTenantBackupTransports?.(tenantId) ?? []).map(t => t.name);
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [CheckedDataSource] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.inMemory.shutdown);

describe('BackupService - what a tenant may configure as a transport', () => {
    it('refuses a transport that leads to this machine or a private network, and keeps none of it', async () => {
        const tenant: string = UUIDUtilities.generate();

        await expect(getCreate()(tenant, { name: 'loopback', kind: 's3', settings: { ...s3 }, secret: { secretAccessKey: 's' } })).rejects.toThrow('public addresses only');
        await expect(getCreate()(tenant, {
            name: 'metadata service',
            kind: 'sftp',
            settings: { host: '169.254.169.254', username: 'u', hostKeyFingerprint: 'SHA256:x', path: '/b' },
            secret: { password: 'p' }
        })).rejects.toThrow(BadRequestError);
        expect(await findNames(tenant)).toStrictEqual([]);
    });

    it('refuses a bucket over plain http, a secret of another kind, and a kind the application does not list', async () => {
        const tenant: string = UUIDUtilities.generate();

        await expect(getCreate()(tenant, { name: 'plain', kind: 's3', settings: { ...s3, endpoint: 'http://backups.example.com' }, secret: { secretAccessKey: 's' } }))
            .rejects.toThrow('needs to be https');
        // the secret of an SFTP server, which the secret of a bucket does not hold
        await expect(getCreate()(tenant, { name: 'mixed', kind: 's3', settings: { ...s3 }, secret: { password: 'p' } })).rejects.toThrow(ValidationError);
        await expect(getCreate()(tenant, {
            name: 'both',
            kind: 'sftp',
            settings: { host: 'sftp.example.com', username: 'u', hostKeyFingerprint: 'SHA256:x', path: '/b' },
            secret: { password: 'p', privateKey: 'k' }
        })).rejects.toThrow('exactly one of them');
        await expect(getCreate()(tenant, { name: 'unknown', kind: 'webdav', settings: {}, secret: {} })).rejects.toThrow('needs to be one of s3, sftp');
        expect(await findNames(tenant)).toStrictEqual([]);
    });

    it('refuses a backup of a tenant without a transport of its own, rather than putting it on the application\'s', async () => {
        await expect(getBackupService().queueBackup({ name: 'no own transport', tenantId: UUIDUtilities.generate() }))
            .rejects.toThrow('has no transport of its own');
    });
});