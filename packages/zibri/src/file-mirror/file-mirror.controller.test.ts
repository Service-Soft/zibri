import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { InProcessWebDavServer } from '../__testing__/web-dav/in-process-web-dav-server.model';
import { type AuthServiceInterface } from '../auth/auth-service.interface';
import { definePermissions } from '../auth/roles/define-permissions.function';
import { type Permission } from '../auth/roles/permission.type';
import { type PlatformPermission } from '../auth/roles/platform-permission.type';
import { ZIBRI_PERMISSIONS } from '../auth/roles/zibri-permissions.model';
import { ApiKeyAuthStrategy } from '../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../auth/strategies/api-key/created-api-key.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { TenantWebDavConnection } from '../web-dav/tenant-web-dav-connection.model';
import { WebDavConnectionKind } from '../web-dav/web-dav-connection-kind.enum';
import { FileMirrorRequest } from './file-mirror-request.model';
import { FileMirrorShareLink } from './file-mirror-share-link.model';
import { FileMirrorController } from './file-mirror.controller';
import { type FileToMirror } from './file-to-mirror.model';
import { MirroredFileConflictResolution } from './mirrored-file-conflict-resolution.enum';
import { MirroredFileConflict } from './mirrored-file-conflict.enum';
import { MirroredFile } from './mirrored-file.model';
import { ZIBRI_FILE_MIRROR_PERMISSIONS } from './zibri-file-mirror-permissions.model';

// the routes of the file mirror, as a frontend calls them, against a WebDAV server in this process that answers as
// Nextcloud does. What the service does with the files is held by file-mirror.service.test.ts

/**
 * The routes of the file mirror, below `/file-mirror`.
 */
@Controller('/file-mirror', { allowOrphan: true })
class TestFileMirrorController extends FileMirrorController {}

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions([...ZIBRI_PERMISSIONS, ...ZIBRI_FILE_MIRROR_PERMISSIONS] as const);

/**
 * The tenant roles of the suite.
 */
const TenantRoles: Record<'reader' | 'manager' | 'guest', string> = { reader: 'mirror-reader', manager: 'mirror-manager', guest: 'mirror-guest' };

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: TenantRoles.guest, level: 'tenant', permissions: [], description: undefined },
    { name: TenantRoles.reader, level: 'tenant', permissions: [Permissions.FILE_MIRROR_READ], description: undefined },
    { name: TenantRoles.manager, level: 'tenant', permissions: [Permissions.FILE_MIRROR_READ, Permissions.FILE_MIRROR_MANAGE], description: undefined }
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
 * A page of mirrored files, as it arrives.
 */
type ConflictPage = {
    /**
     * The files.
     */
    items: { id: string, path: string, conflict: MirroredFileConflict | null }[],
    /**
     * How many there are.
     */
    totalAmount: number
};

/**
 * A share link, as it arrives.
 */
type ShareLinkBody = {
    /**
     * The id.
     */
    id: string,
    /**
     * The path it was asked for.
     */
    path: string,
    /**
     * The id of the share.
     */
    shareId: string,
    /**
     * The url.
     */
    url: string
};

const webDav: InProcessWebDavServer = new InProcessWebDavServer('ada', 'Lovelace-app-password');
const tenantId: string = UUIDUtilities.generate();
const root: string = 'files/ada';
let server: StartedTestServer | undefined;
let baseUrl: string;
let nextcloudConnectionId: string;
let webDavConnectionId: string;
let manager: Record<string, string>;
let reader: Record<string, string>;
let guest: Record<string, string>;

/**
 * Creates a member of the tenant with a role, and the headers of the api key they call the routes with.
 * @param role - The tenant role.
 * @returns The headers.
 */
async function createCaller(role: string): Promise<Record<string, string>> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate().slice(0, 8)}@file-mirror.test`, roles: [Roles.USER] });
    await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [role] }));
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const permissions: (Permission | PlatformPermission)[] = await authService.resolveUserPermissions(user, undefined);
    const key: CreatedApiKey = await authService.createApiKey(
        user.id,
        { name: 'file mirror', permissions, expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
        undefined
    );
    return { 'x-api-key': key.key, 'x-tenant-id': tenantId };
}

async function call<T>(headers: Record<string, string>, method: string, path: string, body?: object): Promise<Answer<T>> {
    const res: Response = await fetch(`${baseUrl}/file-mirror${path}`, {
        method,
        headers: { ...headers, ...body == undefined ? {} : { 'content-type': 'application/json' } },
        body: body == undefined ? undefined : JSON.stringify(body)
    });
    const text: string = await res.text();
    // what the route answered, which the case typed
    return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

/**
 * Mirrors a file, changes it in the folder as somebody working there, and mirrors a new version of it.
 * @returns The file, and the id of its mirrored file in conflict.
 */
async function mirrorIntoConflict(): Promise<[FileToMirror, string]> {
    const invoiceId: string = UUIDUtilities.generate();
    const file: FileToMirror = {
        connectionId: webDavConnectionId,
        path: `${root}/${invoiceId}/2026-001.pdf`,
        content: '%PDF-1.7 as issued',
        contentType: 'application/pdf',
        source: { type: 'invoice', id: invoiceId }
    };
    await mirror(file);
    webDav.edit(file.path, '%PDF-1.7 signed by the customer');
    await mirror({ ...file, content: '%PDF-1.7 corrected' });
    const mirrored: MirroredFile[] = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
        tenantId,
        async () => await inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).findMirroredFiles(file.source)
    );
    return [file, mirrored[0]?.id ?? ''];
}

async function mirror(file: FileToMirror): Promise<void> {
    await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).mirrorFile(file, undefined));
    const requests: Repository<FileMirrorRequest> = inject(repositoryTokenFor(FileMirrorRequest));
    await waitUntil(async () => {
        await inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).uploadDueFiles();
        return !await requests.exists({ where: { nextAttemptAt: null, heldForConflict: false }, acrossTenants: true });
    }, 10_000);
}

beforeAll(async () => {
    await webDav.start();
    webDav.createFolder(root);
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({
            entities: [...defaultTestServerEntities, ApiKey, TenantWebDavConnection, MirroredFile, FileMirrorRequest, FileMirrorShareLink],
            repositories: defaultTestServerRepositories
        })],
        authStrategies: [ApiKeyAuthStrategy],
        controllers: [TestFileMirrorController],
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders({ permissions: Object.values(Permissions), platformPermissions: [] }, roles),
            // the server of this process, which a tenant's connection reaches only on a private network
            defineProvider({ token: ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS, useValue: { allowedHosts: ['127.0.0.1'], allowPrivateNetworks: true } })
        ]
    });
    baseUrl = await server.start();
    manager = await createCaller(TenantRoles.manager);
    reader = await createCaller(TenantRoles.reader);
    guest = await createCaller(TenantRoles.guest);
    const connections: Repository<TenantWebDavConnection> = inject(repositoryTokenFor(TenantWebDavConnection));
    [webDavConnectionId, nextcloudConnectionId] = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => [
        (await connections.create({ name: 'Shared drive', kind: WebDavConnectionKind.WEB_DAV, ...webDav.connection })).id,
        (await connections.create({ name: 'Nextcloud', kind: WebDavConnectionKind.NEXTCLOUD, ...webDav.connection })).id
    ]);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await webDav.stop();
}, TestTimeouts.inMemory.shutdown);

describe('FileMirrorController, the conflicts', () => {
    it('lists the conflicts of the tenant page by page with file-mirror.read, and refuses a caller without it', async () => {
        const [file, mirroredFileId] = await mirrorIntoConflict();

        const page: Answer<ConflictPage> = await call<ConflictPage>(reader, 'GET', '/conflicts?page=1&limit=1');

        expect(page.status).toBe(200);
        expect(page.body.items).toEqual([expect.objectContaining({ id: mirroredFileId, path: file.path, conflict: MirroredFileConflict.CHANGED })]);
        expect(page.body.totalAmount).toBeGreaterThanOrEqual(1);
        expect((await call(guest, 'GET', '/conflicts?page=1&limit=1')).status).toBe(403);
        expect((await call(reader, 'GET', '/conflicts?page=1&limit=101')).status).toBe(400);
    });

    it('overwrites a file in conflict with file-mirror.manage, and refuses a resolution that is none or a reader', async () => {
        const [file, mirroredFileId] = await mirrorIntoConflict();

        expect((await call(reader, 'POST', `/conflicts/${mirroredFileId}/resolution`, { resolution: MirroredFileConflictResolution.OVERWRITE })).status).toBe(403);
        expect((await call(manager, 'POST', `/conflicts/${mirroredFileId}/resolution`, { resolution: 'KEEP_BOTH' })).status).toBe(400);
        const resolved: Answer<undefined> = await call(manager, 'POST', `/conflicts/${mirroredFileId}/resolution`, { resolution: MirroredFileConflictResolution.OVERWRITE });

        expect(resolved.status).toBe(204);
        expect(webDav.files.get(file.path)?.content.toString()).toBe('%PDF-1.7 corrected');
        const again: Answer<ErrorBody> = await call<ErrorBody>(manager, 'POST', `/conflicts/${mirroredFileId}/resolution`, { resolution: MirroredFileConflictResolution.OVERWRITE });
        expect(again.status).toBe(400);
        expect(again.body.message).toBe(`The mirrored file "${file.path}" needs to be in conflict to resolve one, and holds what was mirrored last.`);
        expect((await call(manager, 'POST', `/conflicts/${UUIDUtilities.generate()}/resolution`, { resolution: MirroredFileConflictResolution.OVERWRITE })).status).toBe(404);
    });

    it('stops mirroring a file in conflict', async () => {
        const [file, mirroredFileId] = await mirrorIntoConflict();

        const resolved: Answer<undefined> = await call(manager, 'POST', `/conflicts/${mirroredFileId}/resolution`, { resolution: MirroredFileConflictResolution.STOP_MIRRORING });

        expect(resolved.status).toBe(204);
        expect(webDav.files.get(file.path)?.content.toString()).toBe('%PDF-1.7 signed by the customer');
        const page: Answer<ConflictPage> = await call<ConflictPage>(reader, 'GET', '/conflicts?page=1&limit=100');
        expect(page.body.items.map(conflict => conflict.id)).not.toContain(mirroredFileId);
    });

    it('answers a server that cannot be reached with 503, and leaves the conflict', async () => {
        const [, mirroredFileId] = await mirrorIntoConflict();
        webDav.down = true;
        let answer: Answer<ErrorBody>;
        try {
            answer = await call<ErrorBody>(manager, 'POST', `/conflicts/${mirroredFileId}/resolution`, { resolution: MirroredFileConflictResolution.OVERWRITE });
        }
        finally {
            webDav.down = false;
        }

        expect(answer.status).toBe(503);
        expect(answer.body.message).toBe('The WebDAV server cannot be reached.');
        const page: Answer<ConflictPage> = await call<ConflictPage>(reader, 'GET', '/conflicts?page=1&limit=100');
        expect(page.body.items.map(conflict => conflict.id)).toContain(mirroredFileId);
    });
});

describe('FileMirrorController, the share links', () => {
    it('answers the link of a path, the same one again, and revokes it', async () => {
        const folder: string = `${root}/Customers/${UUIDUtilities.generate()}`;
        webDav.createFolder(folder);

        const created: Answer<ShareLinkBody> = await call<ShareLinkBody>(manager, 'POST', '/share-links', { connectionId: nextcloudConnectionId, path: folder, expiresOn: '2027-01-31' });
        const again: Answer<ShareLinkBody> = await call<ShareLinkBody>(manager, 'POST', '/share-links', { connectionId: nextcloudConnectionId, path: folder });
        const revoked: Answer<undefined> = await call(manager, 'DELETE', `/share-links?connectionId=${nextcloudConnectionId}&path=${encodeURIComponent(folder)}`);

        expect(created.status).toBe(200);
        expect(created.body).toMatchObject({ path: folder, url: expect.stringMatching(/\/s\/\w+$/), expiresOn: '2027-01-31' });
        expect(again.body).toEqual(created.body);
        expect(revoked.status).toBe(204);
        expect(webDav.shares.has(created.body.shareId)).toBe(false);
    });

    it('refuses a link without file-mirror.manage, of a path that is none or holds nothing, an expiry that is no day, and of another server', async () => {
        const nothing: Answer<ErrorBody> = await call<ErrorBody>(manager, 'POST', '/share-links', { connectionId: nextcloudConnectionId, path: `${root}/${UUIDUtilities.generate()}` });
        const notAServer: Answer<ErrorBody> = await call<ErrorBody>(manager, 'POST', '/share-links', { connectionId: webDavConnectionId, path: root });

        expect((await call(reader, 'POST', '/share-links', { connectionId: nextcloudConnectionId, path: root })).status).toBe(403);
        expect((await call(reader, 'DELETE', `/share-links?connectionId=${nextcloudConnectionId}&path=${encodeURIComponent(root)}`)).status).toBe(403);
        expect((await call(manager, 'POST', '/share-links', { connectionId: nextcloudConnectionId, path: `${root}/../ada` })).status).toBe(400);
        expect((await call(manager, 'POST', '/share-links', { connectionId: nextcloudConnectionId, path: root, expiresOn: '31.01.2027' })).status).toBe(400);
        expect(nothing.status).toBe(404);
        expect(nothing.body.message).toBe('The WebDAV server has nothing at the path.');
        expect(notAServer.status).toBe(400);
        expect(notAServer.body.message).toBe('A share link needs a connection to a Nextcloud, and the WebDAV connection "Shared drive" is to another server.');
    });
});
