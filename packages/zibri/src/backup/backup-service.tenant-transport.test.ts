import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { S3TenantBackupTransportKind } from './tenant/s3.tenant-backup-transport-kind';
import { TenantBackupTransport } from './tenant/tenant-backup-transport.model';
import { FsBackupTransport } from './transports/fs.backup-transport';
import { BackupTransportTestServerUtilities, S3TestServerOptions, StartedS3TestServer } from '../__testing__/backup/backup-transport-test-server.utilities';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { ConflictError } from '../error-handling/errors/conflict.error';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * A tenant's backups stored on a bucket the tenant configured, here a gateway in a container, which the
 * options let a tenant reach inside the network the application runs in.
 */

const applicationFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-tenant-transport-${UUIDUtilities.generate()}`);

const s3Options: S3TestServerOptions = {
    bucket: 'tenant-backups',
    region: 'us-east-1',
    credentials: { accessKeyId: 'tenant-key', secretAccessKey: 'tenant-secret' }
};

@Entity()
class TransportNote extends BaseTenantEntity() {
    @Property.string()
    text!: string;
}

@BackupTransport()
class ApplicationFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('application-fs-backup-transport', applicationFolder);
    }
}

@DataSource()
@Backup({ transports: [ApplicationFsBackupTransport], encrypt: true })
class TenantTransportDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity, TransportNote, TenantBackupTransport];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    return await tenants.runAs(tenantId, work);
}

async function findTexts(tenantId: string): Promise<string[]> {
    return await asTenant(tenantId, async () => (await inject(repositoryTokenFor(TransportNote)).findAll({ limit: 'all' })).map(n => n.text).sort());
}

let s3: StartedS3TestServer | undefined;
let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(applicationFolder);
    s3 = await BackupTransportTestServerUtilities.startS3(s3Options);
    server = await startTestServer({
        dataSources: [TenantTransportDataSource],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({
                token: ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS,
                useValue: { kinds: [new S3TenantBackupTransportKind()], allowedHosts: undefined, allowPrivateNetworks: true }
            })
        ]
    });
}, TestTimeouts.inMemory.start + 60000);

afterAll(async () => {
    await server?.shutdown();
    await s3?.container.stop();
    await FsUtilities.rm(applicationFolder);
}, TestTimeouts.inMemory.shutdown + 30000);

describe('BackupService - the transports of a tenant', () => {
    it('stores the tenant\'s backups on its own bucket alone, restores them from it, and keeps the bucket while a backup is on it', async () => {
        assert(s3, 'the bucket did not start');
        const backupService: BackupServiceInterface = getBackupService();
        assert(backupService.createTenantBackupTransport && backupService.deleteTenantBackupTransport, 'the backup service takes no transports of tenants');
        const tenant: string = UUIDUtilities.generate();
        const transport: TenantBackupTransport = await backupService.createTenantBackupTransport(tenant, {
            name: 'our bucket',
            kind: 's3',
            settings: { endpoint: s3.endpoint, bucket: s3Options.bucket, region: s3Options.region, accessKeyId: s3Options.credentials.accessKeyId, addressingStyle: 'path' },
            secret: { secretAccessKey: s3Options.credentials.secretAccessKey }
        });
        await asTenant(tenant, async () => await inject(repositoryTokenFor(TransportNote)).create({ text: 'backed up' }));

        const backup: BackupEntity = await backupService.waitForBackup(await backupService.queueBackup({ name: 'on the tenant bucket', tenantId: tenant }));
        expect(backup.resources.map(r => r.transportNames)).toStrictEqual([[`tenant-transport:${transport.id}`]]);
        // nothing of it on the application's own transport
        expect(await FsUtilities.exists(applicationFolder) ? await FsUtilities.glob(FsUtilities.getPath(applicationFolder, '**', `*${backup.id}*`)) : []).toStrictEqual([]);

        await asTenant(tenant, async () => {
            const notes: Repository<TransportNote> = inject(repositoryTokenFor(TransportNote));
            await notes.deleteAll({});
            await notes.create({ text: 'written since' });
        });
        await backupService.restore(backup);
        expect(await findTexts(tenant)).toStrictEqual(['backed up']);

        await expect(backupService.deleteTenantBackupTransport(tenant, transport.id)).rejects.toThrow(ConflictError);
        await backupService.delete(backup);
        await backupService.collectGarbage?.();
        await backupService.deleteTenantBackupTransport(tenant, transport.id);
        expect(await backupService.findTenantBackupTransports?.(tenant)).toStrictEqual([]);
    }, 120000);

    it('refuses a bucket whose secret is wrong, at once, and keeps none of it', async () => {
        assert(s3, 'the bucket did not start');
        const backupService: BackupServiceInterface = getBackupService();
        assert(backupService.createTenantBackupTransport, 'the backup service takes no transports of tenants');
        const tenant: string = UUIDUtilities.generate();

        await expect(backupService.createTenantBackupTransport(tenant, {
            name: 'wrong secret',
            kind: 's3',
            settings: { endpoint: s3.endpoint, bucket: s3Options.bucket, region: s3Options.region, accessKeyId: s3Options.credentials.accessKeyId, addressingStyle: 'path' },
            secret: { secretAccessKey: 'not the secret' }
        })).rejects.toThrow('could not be written to');
        expect(await backupService.findTenantBackupTransports?.(tenant)).toStrictEqual([]);
    }, 60000);
});