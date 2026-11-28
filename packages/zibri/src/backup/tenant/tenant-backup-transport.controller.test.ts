import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { InProcessSftpServer } from '../../__testing__/backup/in-process-sftp-server.model';
import { testFileFolder, TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { InProcessWebDavServer } from '../../__testing__/web-dav/in-process-web-dav-server.model';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { definePermissions } from '../../auth/roles/define-permissions.function';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { ZIBRI_PERMISSIONS } from '../../auth/roles/zibri-permissions.model';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { Repository } from '../../data-source/repository/repository';
import { RepositoryClass } from '../../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { $ts } from '../../localization/translate.function';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Newable } from '../../types/newable.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { TenantWebDavConnection } from '../../web-dav/tenant-web-dav-connection.model';
import { WebDavConnectionKind } from '../../web-dav/web-dav-connection-kind.enum';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupServiceInterface } from '../backup-service.interface';
import { Backup } from '../decorators/backup-resource.decorator';
import { BackupTransport } from '../decorators/backup-transport.decorator';
import { BackupTransportSupporting } from '../transports/backup-transport.interface';
import { FsBackupTransport } from '../transports/fs.backup-transport';
import { NextcloudTenantBackupTransportKind } from './nextcloud.tenant-backup-transport-kind';
import { SftpTenantBackupTransportKind } from './sftp.tenant-backup-transport-kind';
import { TenantBackupTransportKindInterface } from './tenant-backup-transport-kind.interface';
import { TenantBackupTransportController } from './tenant-backup-transport.controller';
import { TenantBackupTransport } from './tenant-backup-transport.model';
import { WebDavTenantBackupTransportKind } from './web-dav.tenant-backup-transport-kind';
import { ZIBRI_BACKUP_TRANSPORT_PERMISSIONS } from './zibri-backup-transport-permissions.model';

// the routes of a tenant's backup transports, as a frontend calls them, against an SFTP server and a WebDAV server in
// this process and a kind of the application's own. What the backups do on the transports is held by
// backup-service.tenant-transport.container.test.ts and backup-service.tenant-web-dav-transport.test.ts

const applicationFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-transport-routes-application-${UUIDUtilities.generate()}`);
const archiveFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-transport-routes-archive-${UUIDUtilities.generate()}`);

const sftp: InProcessSftpServer = new InProcessSftpServer();
const webDav: InProcessWebDavServer = new InProcessWebDavServer('ada', 'Lovelace-app-password');

/**
 * The routes of the backup transports, below `/backup-transports`.
 */
@Controller('/backup-transports', { allowOrphan: true })
class TestTenantBackupTransportController extends TenantBackupTransportController {}

@Entity()
class TenantNote extends BaseTenantEntity() {
    @Property.string()
    text!: string;
}

@BackupTransport()
class RoutesApplicationFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('backup-transport-routes-application-fs', applicationFolder);
    }
}

@DataSource()
@Backup({ transports: [RoutesApplicationFsBackupTransport], encrypt: true })
class RoutesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [
        ...defaultTestServerEntities,
        ApiKey,
        BackupEntity,
        BackupResourceEntity,
        TenantNote,
        TenantBackupTransport,
        TenantWebDavConnection
    ];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * Where an archive of the application keeps a tenant's backups.
 */
class ArchiveSettings {
    @Property.string()
    folder!: string;
}

/**
 * What the archive is opened with.
 */
class ArchiveSecret {
    @Property.string()
    token!: string;
}

/**
 * A kind of the application's own, which the routes know nothing of beyond its models.
 */
class ArchiveTenantBackupTransportKind implements TenantBackupTransportKindInterface<ArchiveSettings, ArchiveSecret> {
    readonly name: string = 'archive';
    readonly settingsModel: Newable<ArchiveSettings> = ArchiveSettings;
    readonly secretModel: Newable<ArchiveSecret> = ArchiveSecret;

    validateSettings(_: ArchiveSettings, secret: ArchiveSecret): void {
        if (secret.token !== 'open-sesame') {
            throw new BadRequestError($ts`The token of an archive needs to be the one the archive issued.`);
        }
    }

    async createTransport(name: string, settings: ArchiveSettings): Promise<BackupTransportSupporting<'v2'>> {
        return await Promise.resolve(new FsBackupTransport(name, FsUtilities.getPath(archiveFolder, settings.folder)));
    }
}

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions([...ZIBRI_PERMISSIONS, ...ZIBRI_BACKUP_TRANSPORT_PERMISSIONS] as const);

/**
 * The tenant roles of the suite.
 */
const TenantRoles: Record<'reader' | 'manager' | 'guest', string> = { reader: 'transport-reader', manager: 'transport-manager', guest: 'transport-guest' };

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: TenantRoles.guest, level: 'tenant', permissions: [], description: undefined },
    { name: TenantRoles.reader, level: 'tenant', permissions: [Permissions.BACKUP_TRANSPORTS_READ], description: undefined },
    {
        name: TenantRoles.manager,
        level: 'tenant',
        permissions: [Permissions.BACKUP_TRANSPORTS_READ, Permissions.BACKUP_TRANSPORTS_MANAGE],
        description: undefined
    }
];

/**
 * What a route answered.
 */
type Answer<T> = {
    /**
     * The status.
     */
    status: number,
    /**
     * The body, as it arrives.
     */
    body: T
};

/**
 * What a route refused a request with.
 */
type ErrorBody = {
    /**
     * The first paragraph.
     */
    message: string
};

/**
 * A transport, as it arrives.
 */
type TransportBody = {
    /**
     * The id.
     */
    id: string,
    /**
     * The tenant.
     */
    tenantId: string,
    /**
     * The name.
     */
    name: string,
    /**
     * The kind.
     */
    kind: string,
    /**
     * The settings.
     */
    settings: Record<string, unknown>
};

/**
 * Members of a tenant in each role, by the headers of the api keys they call the routes with.
 */
type Callers = Record<'reader' | 'manager' | 'guest', Record<string, string>>;

let server: StartedTestServer | undefined;
let baseUrl: string;

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

/**
 * Creates a member of a tenant with a role, and the headers of the api key they call the routes with.
 * @param tenantId - The tenant.
 * @param role - The tenant role.
 * @returns The headers.
 */
async function createCaller(tenantId: string, role: string): Promise<Record<string, string>> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate().slice(0, 8)}@backup-transports.test`, roles: [Roles.USER] });
    await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [role] }));
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const permissions: (Permission | PlatformPermission)[] = await authService.resolveUserPermissions(user, undefined);
    const key: CreatedApiKey = await authService.createApiKey(
        user.id,
        { name: 'backup transports', permissions, expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
        undefined
    );
    return { 'x-api-key': key.key, 'x-tenant-id': tenantId };
}

/**
 * Creates a tenant with a member in each role.
 * @returns The tenant, and its members.
 */
async function createTenant(): Promise<[string, Callers]> {
    const tenantId: string = UUIDUtilities.generate();
    return [
        tenantId, {
            reader: await createCaller(tenantId, TenantRoles.reader),
            manager: await createCaller(tenantId, TenantRoles.manager),
            guest: await createCaller(tenantId, TenantRoles.guest)
        }
    ];
}

async function call<T>(headers: Record<string, string>, method: string, path: string, body?: object): Promise<Answer<T>> {
    const res: Response = await fetch(`${baseUrl}/backup-transports${path}`, {
        method,
        headers: { ...headers, ...body == undefined ? {} : { 'content-type': 'application/json' } },
        body: body == undefined ? undefined : JSON.stringify(body)
    });
    const text: string = await res.text();
    // what the route answered, which the case typed
    return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

/**
 * The settings of an SFTP transport reaching a folder of the server of this process.
 * @param path - The folder.
 * @returns The settings.
 */
function resolveSftpSettings(path: string): Record<string, unknown> {
    const { host, port, username, hostKeyFingerprint } = sftp.getOptions(path);
    return { host, port, username, hostKeyFingerprint, path };
}

/**
 * The password the SFTP server of this process logs its user in with.
 */
const SFTP_PASSWORD: string = 'zibri-test-password';

const sftpSecret: Record<string, string> = { password: SFTP_PASSWORD };

/**
 * Adds a connection of a tenant to the files of the user on the WebDAV server, as the routes of the connections add
 * one.
 * @param tenantId - The tenant.
 * @param kind - What server it reaches.
 * @returns The id of the connection.
 */
async function createConnection(tenantId: string, kind: WebDavConnectionKind): Promise<string> {
    const connection: TenantWebDavConnection = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => {
        return await inject<Repository<TenantWebDavConnection>>(repositoryTokenFor(TenantWebDavConnection)).create({
            name: `Our cloud ${UUIDUtilities.generate()}`,
            kind,
            url: `${webDav.connection.url}files/ada/`,
            username: webDav.connection.username,
            password: webDav.connection.password
        });
    });
    return connection.id;
}

/**
 * Takes a backup of a tenant, onto every transport of the tenant.
 * @param tenantId - The tenant.
 * @param name - The name of the backup.
 * @returns The backup.
 */
async function backUp(tenantId: string, name: string): Promise<BackupEntity> {
    await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => {
        await inject<Repository<TenantNote>>(repositoryTokenFor(TenantNote)).create({ text: 'kept in the backup' });
    });
    return await getBackupService().waitForBackup(await getBackupService().queueBackup({ name, tenantId }));
}

beforeAll(async () => {
    await FsUtilities.rm(applicationFolder);
    await FsUtilities.rm(archiveFolder);
    await sftp.start();
    await webDav.start();
    webDav.createFolder('files/ada');
    server = await startTestServer({
        dataSources: [RoutesDataSource],
        authStrategies: [ApiKeyAuthStrategy],
        controllers: [TestTenantBackupTransportController],
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders({ permissions: Object.values(Permissions), platformPermissions: [] }, roles),
            // the servers run on this machine, which the application names
            defineProvider({
                token: ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS,
                useValue: {
                    kinds: [
                        new SftpTenantBackupTransportKind(),
                        new WebDavTenantBackupTransportKind(),
                        new NextcloudTenantBackupTransportKind(),
                        new ArchiveTenantBackupTransportKind()
                    ],
                    allowedHosts: ['127.0.0.1'],
                    allowPrivateNetworks: true
                }
            })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await sftp.stop();
    await webDav.stop();
    await FsUtilities.rm(applicationFolder);
    await FsUtilities.rm(archiveFolder);
}, TestTimeouts.inMemory.shutdown);

describe('TenantBackupTransportController, listing', () => {
    it('lists the kinds and the transports of the tenant with backup-transports.read, never their secrets, and refuses a caller without it', async () => {
        const [tenantId, callers] = await createTenant();
        const added: Answer<TransportBody> = await call<TransportBody>(callers.manager, 'POST', '/', {
            name: 'Our SFTP server',
            kind: 'sftp',
            settings: resolveSftpSettings(`/listed-${tenantId}`),
            secret: sftpSecret
        });

        const transports: Answer<Record<string, unknown>[]> = await call<Record<string, unknown>[]>(callers.reader, 'GET', '/');
        const kinds: Answer<{ name: string }[]> = await call<{ name: string }[]>(callers.reader, 'GET', '/kinds');

        expect(added.status).toBe(200);
        expect(transports.status).toBe(200);
        expect(transports.body).toEqual([{ id: added.body.id, tenantId, name: 'Our SFTP server', kind: 'sftp', settings: resolveSftpSettings(`/listed-${tenantId}`) }]);
        expect(JSON.stringify(transports.body)).not.toContain(SFTP_PASSWORD);
        expect(kinds.body).toEqual([{ name: 'sftp' }, { name: 'web-dav' }, { name: 'nextcloud' }, { name: 'archive' }]);
        expect((await call(callers.guest, 'GET', '/')).status).toBe(403);
        expect((await call(callers.guest, 'GET', '/kinds')).status).toBe(403);
    }, 30000);
});

describe('TenantBackupTransportController, adding', () => {
    it('adds a transport of each kind once it was written to, the application\'s own included', async () => {
        const [tenantId, callers] = await createTenant();
        const webDavConnectionId: string = await createConnection(tenantId, WebDavConnectionKind.WEB_DAV);
        const nextcloudConnectionId: string = await createConnection(tenantId, WebDavConnectionKind.NEXTCLOUD);

        const added: Answer<TransportBody>[] = [
            await call<TransportBody>(callers.manager, 'POST', '/', { name: 'SFTP', kind: 'sftp', settings: resolveSftpSettings(`/added-${tenantId}`), secret: sftpSecret }),
            await call<TransportBody>(callers.manager, 'POST', '/', { name: 'WebDAV', kind: 'web-dav', settings: { connectionId: webDavConnectionId, folder: `Backups/${tenantId}` }, secret: {} }),
            await call<TransportBody>(callers.manager, 'POST', '/', {
                name: 'Nextcloud',
                kind: 'nextcloud',
                settings: { connectionId: nextcloudConnectionId, folder: `Shared-${tenantId}`, sharedWithUsers: ['grace'], sharedWithGroups: [] },
                secret: {}
            }),
            await call<TransportBody>(callers.manager, 'POST', '/', { name: 'Archive', kind: 'archive', settings: { folder: tenantId }, secret: { token: 'open-sesame' } })
        ];

        expect(added.map(answer => answer.status)).toEqual([200, 200, 200, 200]);
        expect(added.map(answer => answer.body.kind)).toEqual(['sftp', 'web-dav', 'nextcloud', 'archive']);
        expect([...webDav.shares.values()].filter(share => share.path === `/Shared-${tenantId}`).map(share => share.shareWith)).toEqual(['grace']);
        expect((await call<TransportBody[]>(callers.reader, 'GET', '/')).body.map(transport => transport.name)).toEqual(['Archive', 'Nextcloud', 'SFTP', 'WebDAV']);
    }, 30000);

    it('refuses a transport it cannot write to, one its kind refuses, one of no kind it lists, a name taken and a reader', async () => {
        const [, callers] = await createTenant();
        await call(callers.manager, 'POST', '/', { name: 'Archive', kind: 'archive', settings: { folder: UUIDUtilities.generate() }, secret: { token: 'open-sesame' } });

        const unwritable: Answer<ErrorBody> = await call<ErrorBody>(callers.manager, 'POST', '/', {
            name: 'Wrong password',
            kind: 'sftp',
            settings: resolveSftpSettings('/refused'),
            secret: { password: 'not-the-password' }
        });
        const refusedByKind: Answer<ErrorBody> = await call<ErrorBody>(callers.manager, 'POST', '/', { name: 'Closed', kind: 'archive', settings: { folder: 'closed' }, secret: { token: 'guessed' } });
        const ofNoKind: Answer<ErrorBody> = await call<ErrorBody>(callers.manager, 'POST', '/', { name: 'Tape', kind: 'tape', settings: {}, secret: {} });
        const lackingSetting: Answer<ErrorBody> = await call<ErrorBody>(callers.manager, 'POST', '/', { name: 'No folder', kind: 'archive', settings: {}, secret: { token: 'open-sesame' } });
        const taken: Answer<ErrorBody> = await call<ErrorBody>(callers.manager, 'POST', '/', { name: 'Archive', kind: 'archive', settings: { folder: 'again' }, secret: { token: 'open-sesame' } });

        expect(unwritable.status).toBe(400);
        expect(unwritable.body.message).toMatch(/^The transport Wrong password could not be written to: /);
        expect(refusedByKind.status).toBe(400);
        expect(refusedByKind.body.message).toBe('The token of an archive needs to be the one the archive issued.');
        expect(ofNoKind.status).toBe(400);
        expect(ofNoKind.body.message).toBe('A transport needs to be one of sftp, web-dav, nextcloud, archive.');
        expect(lackingSetting.status).toBe(400);
        expect(taken.status).toBe(409);
        expect((await call(callers.reader, 'POST', '/', { name: 'Reader', kind: 'archive', settings: { folder: 'reader' }, secret: { token: 'open-sesame' } })).status).toBe(403);
        expect((await call<TransportBody[]>(callers.reader, 'GET', '/')).body.map(transport => transport.name)).toEqual(['Archive']);
    }, 30000);
});

describe('TenantBackupTransportController, changing', () => {
    it('changes the name and the secret once written to with it, and refuses a secret it cannot write with', async () => {
        const [, callers] = await createTenant();
        const added: Answer<TransportBody> = await call<TransportBody>(callers.manager, 'POST', '/', {
            name: 'SFTP',
            kind: 'sftp',
            settings: resolveSftpSettings(`/changed-${UUIDUtilities.generate()}`),
            secret: sftpSecret
        });

        const renamed: Answer<TransportBody> = await call<TransportBody>(callers.manager, 'PATCH', `/${added.body.id}`, { name: 'Our SFTP server' });
        const wrongSecret: Answer<ErrorBody> = await call<ErrorBody>(callers.manager, 'PATCH', `/${added.body.id}`, { secret: { password: 'not-the-password' } });
        const noSecret: Answer<ErrorBody> = await call<ErrorBody>(callers.manager, 'PATCH', `/${added.body.id}`, { secret: {} });
        const sameSecret: Answer<TransportBody> = await call<TransportBody>(callers.manager, 'PATCH', `/${added.body.id}`, { secret: sftpSecret });

        expect(renamed.status).toBe(200);
        expect(renamed.body.name).toBe('Our SFTP server');
        expect(wrongSecret.status).toBe(400);
        expect(wrongSecret.body.message).toMatch(/^The transport Our SFTP server could not be written to: /);
        expect(noSecret.status).toBe(400);
        expect(noSecret.body.message).toBe('The secret of an SFTP server needs to be a password or a private key, exactly one of them.');
        expect(sameSecret.status).toBe(200);
        expect((await call(callers.reader, 'PATCH', `/${added.body.id}`, { name: 'Reader' })).status).toBe(403);
        expect((await call(callers.manager, 'PATCH', `/${UUIDUtilities.generate()}`, { name: 'Nothing' })).status).toBe(404);
    }, 30000);

    it('changes the settings only while no backup is stored on the transport, and backs up to where they lead from then on', async () => {
        const [tenantId, callers] = await createTenant();
        const added: Answer<TransportBody> = await call<TransportBody>(callers.manager, 'POST', '/', { name: 'Archive', kind: 'archive', settings: { folder: `${tenantId}/first` }, secret: { token: 'open-sesame' } });
        const backup: BackupEntity = await backUp(tenantId, 'nightly');

        const whileStored: Answer<ErrorBody> = await call<ErrorBody>(callers.manager, 'PATCH', `/${added.body.id}`, { settings: { folder: `${tenantId}/second` } });
        const unchanged: Answer<TransportBody> = await call<TransportBody>(callers.manager, 'PATCH', `/${added.body.id}`, { name: 'Our archive', settings: { folder: `${tenantId}/first` } });
        await getBackupService().delete(backup);
        const changed: Answer<TransportBody> = await call<TransportBody>(callers.manager, 'PATCH', `/${added.body.id}`, { settings: { folder: `${tenantId}/second` } });
        await backUp(tenantId, 'weekly');

        expect(whileStored.status).toBe(409);
        expect(whileStored.body.message).toBe('The settings of the transport are kept while backups are stored on it: nightly. Delete those first.');
        expect(unchanged.status).toBe(200);
        expect(unchanged.body.name).toBe('Our archive');
        expect(changed.status).toBe(200);
        expect(changed.body.settings).toEqual({ folder: `${tenantId}/second` });
        expect(await FsUtilities.exists(FsUtilities.getPath(archiveFolder, tenantId, 'second', '.zibri-repository', 'backups'))).toBe(true);
    }, 60000);
});

describe('TenantBackupTransportController, deleting', () => {
    it('deletes a transport once no backup is stored on it, and refuses one of another tenant and a reader', async () => {
        const [tenantId, callers] = await createTenant();
        const [, others] = await createTenant();
        const added: Answer<TransportBody> = await call<TransportBody>(callers.manager, 'POST', '/', { name: 'Archive', kind: 'archive', settings: { folder: `${tenantId}/deleted` }, secret: { token: 'open-sesame' } });
        const backup: BackupEntity = await backUp(tenantId, 'nightly');

        const whileStored: Answer<ErrorBody> = await call<ErrorBody>(callers.manager, 'DELETE', `/${added.body.id}`);
        const ofAnother: Answer<ErrorBody> = await call<ErrorBody>(others.manager, 'DELETE', `/${added.body.id}`);
        const byReader: Answer<ErrorBody> = await call<ErrorBody>(callers.reader, 'DELETE', `/${added.body.id}`);
        await getBackupService().delete(backup);
        const deleted: Answer<undefined> = await call(callers.manager, 'DELETE', `/${added.body.id}`);

        expect(whileStored.status).toBe(409);
        expect(whileStored.body.message).toBe('The transport is stored on by backups: nightly. Delete those first.');
        expect(ofAnother.status).toBe(404);
        expect((await call(others.manager, 'PATCH', `/${added.body.id}`, { name: 'Theirs' })).status).toBe(404);
        expect(byReader.status).toBe(403);
        expect(deleted.status).toBe(204);
        expect((await call<TransportBody[]>(callers.reader, 'GET', '/')).body).toEqual([]);
    }, 60000);
});