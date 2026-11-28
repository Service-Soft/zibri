import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { InProcessWebDavServer } from '../__testing__/web-dav/in-process-web-dav-server.model';
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
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { ConflictError } from '../error-handling/errors/conflict.error';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { TenantWebDavConnection } from '../web-dav/tenant-web-dav-connection.model';
import { WebDavConnectionKind } from '../web-dav/web-dav-connection-kind.enum';
import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { NextcloudTenantBackupTransportKind } from './tenant/nextcloud.tenant-backup-transport-kind';
import { TenantBackupTransport } from './tenant/tenant-backup-transport.model';
import { WebDavTenantBackupTransportKind } from './tenant/web-dav.tenant-backup-transport-kind';
import { FsBackupTransport } from './transports/fs.backup-transport';

/**
 * Tenants keeping their backups on a WebDAV server or a Nextcloud of their own, through the connections they manage:
 * the transport logs in with the password of the connection, and the connection is kept while a transport needs it.
 */

const USER: string = 'ada';

const applicationFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-tenant-web-dav-application-${UUIDUtilities.generate()}`);

const webDav: InProcessWebDavServer = new InProcessWebDavServer(USER, 'Lovelace-app-password');

@Entity()
class TenantNote extends BaseTenantEntity() {
    @Property.string()
    text!: string;
}

@BackupTransport()
class TenantWebDavApplicationFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('tenant-web-dav-application-fs-backup-transport', applicationFolder);
    }
}

@DataSource()
@Backup({ transports: [TenantWebDavApplicationFsBackupTransport], encrypt: true })
class TenantWebDavDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [
        ...defaultTestServerEntities,
        BackupEntity,
        BackupResourceEntity,
        TenantNote,
        TenantBackupTransport,
        TenantWebDavConnection
    ];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

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

/**
 * Adds a connection of a tenant to the files of the user, as the routes of the connections add one.
 * @param tenantId - The tenant.
 * @param kind - What server it reaches.
 * @returns The connection.
 */
async function createConnection(tenantId: string, kind: WebDavConnectionKind): Promise<TenantWebDavConnection> {
    return await asTenant(tenantId, async () => await inject<Repository<TenantWebDavConnection>>(repositoryTokenFor(TenantWebDavConnection)).create({
        name: `Our cloud ${UUIDUtilities.generate()}`,
        kind,
        url: `${webDav.connection.url}files/${USER}/`,
        username: webDav.connection.username,
        password: webDav.connection.password
    }));
}

/**
 * What a call ends with.
 * @param call - The call.
 * @returns The error it rejected with, or undefined when it resolved.
 */
async function failureOf(call: Promise<unknown>): Promise<unknown> {
    return await call.then(() => undefined, (error: unknown) => error);
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(applicationFolder);
    await webDav.start();
    webDav.createFolder(`files/${USER}`);
    server = await startTestServer({
        dataSources: [TenantWebDavDataSource],
        providers: [
            ...defaultTestServerProviders,
            // the server runs on this machine, which the application names
            defineProvider({
                token: ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS,
                useValue: { kinds: [new WebDavTenantBackupTransportKind(), new NextcloudTenantBackupTransportKind()], allowedHosts: ['127.0.0.1'], allowPrivateNetworks: true }
            })
        ]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await webDav.stop();
    await FsUtilities.rm(applicationFolder);
}, TestTimeouts.inMemory.shutdown);

describe('BackupService - the backups of tenants on their own WebDAV servers', () => {
    it('stores a tenant\'s backups in a folder of its connection, encrypted, and restores them from it', async () => {
        const tenant: string = UUIDUtilities.generate();
        const connection: TenantWebDavConnection = await createConnection(tenant, WebDavConnectionKind.WEB_DAV);
        const transport: TenantBackupTransport = await getCreate()(tenant, {
            name: 'our cloud',
            kind: 'web-dav',
            settings: { connectionId: connection.id, folder: `Backups/${tenant}` },
            secret: {}
        });
        await asTenant(tenant, async () => await inject<Repository<TenantNote>>(repositoryTokenFor(TenantNote)).create({ text: 'only-in-the-backup' }));

        const backup: BackupEntity = await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: 'nightly', tenantId: tenant }));
        const stored: string[] = webDav.findFilePaths(`files/${USER}/Backups/${tenant}`);
        await asTenant(tenant, async () => await inject<Repository<TenantNote>>(repositoryTokenFor(TenantNote)).deleteAll({}));
        await getBackupService().restore(backup);

        expect(backup.resources.map(resource => resource.transportNames)).toStrictEqual([[`tenant-transport:${transport.id}`]]);
        expect(stored.some(path => path.includes('/.zibri-repository/chunks/'))).toBe(true);
        expect(stored.filter(path => webDav.files.get(path)?.content.includes('only-in-the-backup'))).toEqual([]);
        expect(await asTenant(tenant, async () => (await inject<Repository<TenantNote>>(repositoryTokenFor(TenantNote)).findAll({})).map(note => note.text)))
            .toStrictEqual(['only-in-the-backup']);
    }, 30000);

    it('keeps a connection a transport is kept through, until the transport is deleted', async () => {
        const tenant: string = UUIDUtilities.generate();
        const connection: TenantWebDavConnection = await createConnection(tenant, WebDavConnectionKind.WEB_DAV);
        const transport: TenantBackupTransport = await getCreate()(tenant, {
            name: 'our cloud',
            kind: 'web-dav',
            settings: { connectionId: connection.id, folder: `Backups/${tenant}` },
            secret: {}
        });

        const refused: unknown = await failureOf(asTenant(tenant, async () => await inject(ZIBRI_DI_TOKENS.TENANT_WEB_DAV_CONNECTION_SERVICE).deleteConnection(connection.id)));
        await getBackupService().deleteTenantBackupTransport?.(tenant, transport.id);
        await asTenant(tenant, async () => await inject(ZIBRI_DI_TOKENS.TENANT_WEB_DAV_CONNECTION_SERVICE).deleteConnection(connection.id));

        expect(refused).toBeInstanceOf(ConflictError);
        expect(refused).toMatchObject({ message: expect.stringContaining('Backups are kept through it by the transports our cloud.') });
        expect(await asTenant(tenant, async () => await inject<Repository<TenantWebDavConnection>>(repositoryTokenFor(TenantWebDavConnection)).count())).toBe(0);
    }, 30000);

    it('refuses a connection of another kind, one of another tenant, and a folder leading outside of it', async () => {
        const tenant: string = UUIDUtilities.generate();
        const nextcloud: TenantWebDavConnection = await createConnection(tenant, WebDavConnectionKind.NEXTCLOUD);
        const ofAnother: TenantWebDavConnection = await createConnection(UUIDUtilities.generate(), WebDavConnectionKind.WEB_DAV);

        const ofKind: unknown = await failureOf(getCreate()(tenant, { name: 'plain', kind: 'web-dav', settings: { connectionId: nextcloud.id, folder: 'Backups' }, secret: {} }));
        const ofTenant: unknown = await failureOf(getCreate()(tenant, { name: 'theirs', kind: 'web-dav', settings: { connectionId: ofAnother.id, folder: 'Backups' }, secret: {} }));
        const outside: unknown = await failureOf(getCreate()(tenant, { name: 'outside', kind: 'web-dav', settings: { connectionId: nextcloud.id, folder: '../Backups' }, secret: {} }));

        expect(ofKind).toBeInstanceOf(BadRequestError);
        expect(ofKind).toMatchObject({ message: expect.stringContaining('needs a WebDAV connection of the kind WEB_DAV') });
        expect(ofTenant).toBeInstanceOf(BadRequestError);
        expect(ofTenant).toMatchObject({ message: expect.stringContaining('the tenant has none of the id') });
        expect(outside).toBeInstanceOf(BadRequestError);
        expect(await getBackupService().findTenantBackupTransports?.(tenant)).toStrictEqual([]);
    }, 30000);

    it('shares the folder of a Nextcloud with the readers its settings name, to read', async () => {
        const tenant: string = UUIDUtilities.generate();
        const connection: TenantWebDavConnection = await createConnection(tenant, WebDavConnectionKind.NEXTCLOUD);

        await getCreate()(tenant, {
            name: 'our nextcloud',
            kind: 'nextcloud',
            settings: { connectionId: connection.id, folder: `Backups-${tenant}`, sharedWithUsers: ['grace'], sharedWithGroups: [] },
            secret: {}
        });

        expect([...webDav.shares.values()].filter(share => share.path === `/Backups-${tenant}`))
            .toEqual([expect.objectContaining({ shareType: 0, shareWith: 'grace', permissions: 1 })]);
        // the object written and deleted on adding it is in the trash bin no more
        expect([...webDav.trashBin.values()].filter(entry => entry.originalLocation.startsWith(`Backups-${tenant}/`))).toEqual([]);
    }, 30000);
});
