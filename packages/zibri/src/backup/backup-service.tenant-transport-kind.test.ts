import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { TenantBackupTransportKindInterface } from './tenant/tenant-backup-transport-kind.interface';
import { TenantBackupTransport } from './tenant/tenant-backup-transport.model';
import { TenantTransportNetwork } from './tenant/tenant-transport-network.model';
import { BackupTransportSupporting } from './transports/backup-transport.interface';
import { FsBackupTransport } from './transports/fs.backup-transport';
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
import { ValidationError } from '../error-handling/errors/validation.error';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * A kind of storage of the application's own, which its tenants configure as a transport of their backups
 * the way they configure a bucket: what a tenant may keep its backups on is what the application lists.
 */

const applicationFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-tenant-kind-application-${UUIDUtilities.generate()}`);

const tenantFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-tenant-kind-tenant-${UUIDUtilities.generate()}`);

/**
 * Where a tenant's archive is: the host that serves it, and the folder on it.
 */
class ArchiveSettings {
    @Property.string()
    host!: string;

    @Property.string()
    folder!: string;
}

/**
 * The token the archive is reached with.
 */
class ArchiveSecret {
    @Property.string()
    token!: string;
}

/**
 * The archive service of the application, which keeps what it is given in a folder of this machine, as an
 * archive reached over the network would on its own disk.
 */
class ArchiveTenantBackupTransportKind implements TenantBackupTransportKindInterface<ArchiveSettings, ArchiveSecret> {
    readonly name: string = 'archive';

    readonly settingsModel: Newable<ArchiveSettings> = ArchiveSettings;

    readonly secretModel: Newable<ArchiveSecret> = ArchiveSecret;

    /**
     * The hosts the kind connected to, as the network answered them.
     */
    readonly reached: string[] = [];

    async createTransport(name: string, settings: ArchiveSettings, _: ArchiveSecret, network: TenantTransportNetwork): Promise<BackupTransportSupporting<'v2'>> {
        // the host the archive is reached at, checked as the application's options say
        this.reached.push(await network.resolveAddress(settings.host));
        return new FsBackupTransport(name, FsUtilities.getPath(tenantFolder, settings.folder));
    }
}

@Entity()
class ArchivedNote extends BaseTenantEntity() {
    @Property.string()
    text!: string;
}

@BackupTransport()
class ArchiveApplicationFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('archive-application-fs-backup-transport', applicationFolder);
    }
}

@DataSource()
@Backup({ transports: [ArchiveApplicationFsBackupTransport], encrypt: false })
class ArchiveDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity, ArchivedNote, TenantBackupTransport];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

const archive: ArchiveTenantBackupTransportKind = new ArchiveTenantBackupTransportKind();

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

function getCreate(): NonNullable<BackupServiceInterface['createTenantBackupTransport']> {
    const create: BackupServiceInterface['createTenantBackupTransport'] = getBackupService().createTenantBackupTransport;
    assert(create, 'the backup service takes no transports of tenants');
    return create.bind(getBackupService());
}

async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

async function findTexts(tenantId: string): Promise<string[]> {
    return await asTenant(tenantId, async () => (await inject(repositoryTokenFor(ArchivedNote)).findAll({})).map(n => n.text));
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(applicationFolder);
    await FsUtilities.rm(tenantFolder);
    server = await startTestServer({
        dataSources: [ArchiveDataSource],
        providers: [
            ...defaultTestServerProviders,
            // the archive is a host of the application's own network, which it names
            defineProvider({
                token: ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS,
                useValue: { kinds: [archive], allowedHosts: ['archive.example.com'], allowPrivateNetworks: true }
            })
        ]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(applicationFolder);
    await FsUtilities.rm(tenantFolder);
}, TestTimeouts.inMemory.shutdown);

describe('BackupService - a kind of storage of the application\'s own for the backups of tenants', () => {
    it('stores a tenant\'s backups on a transport of the kind, and restores them from it', async () => {
        const tenant: string = UUIDUtilities.generate();
        const transport: TenantBackupTransport = await getCreate()(tenant, {
            name: 'our archive',
            kind: 'archive',
            settings: { host: 'archive.example.com', folder: tenant },
            secret: { token: 'archive-token' }
        });
        await asTenant(tenant, async () => await inject(repositoryTokenFor(ArchivedNote)).create({ text: 'backed up' }));

        const backup: BackupEntity = await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: 'archived', tenantId: tenant }));
        expect(backup.resources.map(r => r.transportNames)).toStrictEqual([[`tenant-transport:${transport.id}`]]);
        expect(await FsUtilities.exists(FsUtilities.getPath(tenantFolder, tenant))).toBe(true);

        await asTenant(tenant, async () => {
            const notes: Repository<ArchivedNote> = inject(repositoryTokenFor(ArchivedNote));
            await notes.deleteAll({});
            await notes.create({ text: 'written since' });
        });
        await getBackupService().restore(backup);

        expect(await findTexts(tenant)).toStrictEqual(['backed up']);
        expect(archive.reached).toContain('archive.example.com');
    }, 30000);

    it('holds the host the kind reaches to what the application lets tenants reach', async () => {
        const tenant: string = UUIDUtilities.generate();

        await expect(getCreate()(tenant, {
            name: 'somewhere else',
            kind: 'archive',
            settings: { host: 'elsewhere.example.com', folder: tenant },
            secret: { token: 'archive-token' }
        })).rejects.toThrow('"elsewhere.example.com" needs to be one of');
        expect(await getBackupService().findTenantBackupTransports?.(tenant)).toStrictEqual([]);
    }, 30000);

    it('refuses settings and a secret the models of the kind do not describe', async () => {
        const tenant: string = UUIDUtilities.generate();

        await expect(getCreate()(tenant, { name: 'no folder', kind: 'archive', settings: { host: 'archive.example.com' }, secret: { token: 't' } }))
            .rejects.toThrow(ValidationError);
        await expect(getCreate()(tenant, { name: 'no token', kind: 'archive', settings: { host: 'archive.example.com', folder: tenant }, secret: {} }))
            .rejects.toThrow(ValidationError);
        await expect(getCreate()(tenant, { name: 'a bucket', kind: 's3', settings: {}, secret: {} })).rejects.toThrow('needs to be one of archive');
    }, 30000);
});