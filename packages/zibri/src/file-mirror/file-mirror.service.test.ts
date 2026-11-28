import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { InProcessWebDavRequest, InProcessWebDavServer } from '../__testing__/web-dav/in-process-web-dav-server.model';
import { type PaginationResult } from '../data-source/models/pagination-result.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { InternalError } from '../error-handling/internal-error.model';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { TenantWebDavConnection } from '../web-dav/tenant-web-dav-connection.model';
import { WebDavClient } from '../web-dav/web-dav-client';
import { WebDavConnectionKind } from '../web-dav/web-dav-connection-kind.enum';
import { FileMirrorRequest } from './file-mirror-request.model';
import { type FileMirrorServiceInterface } from './file-mirror-service.interface';
import { FileMirrorShareLink } from './file-mirror-share-link.model';
import { describeFileMirror } from './file-mirror.service.cases';
import { type FileToMirror } from './file-to-mirror.model';
import { MirroredFileConflictResolution } from './mirrored-file-conflict-resolution.enum';
import { MirroredFileConflict } from './mirrored-file-conflict.enum';
import { MirroredFile } from './mirrored-file.model';

// what the file mirror sends and how it reads the answers, against a WebDAV server in this process that answers as
// Nextcloud does, through a connection of each kind. What real servers do is held by
// file-mirror.service.apache.test.ts and file-mirror.service.nextcloud.test.ts

const webDav: InProcessWebDavServer = new InProcessWebDavServer('ada', 'Lovelace-app-password');
const tenantId: string = UUIDUtilities.generate();
// the files of Ada, below the WebDAV root the connections are to
const root: string = 'files/ada';
let testServer: StartedTestServer | undefined;
let webDavConnectionId: string;
let nextcloudConnectionId: string;

/**
 * Calls the service in the tenant of the suite.
 * @param call - What it does with the service.
 * @returns What it resolves to.
 */
async function inTenant<T>(call: (service: FileMirrorServiceInterface) => Promise<T>): Promise<T> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await call(inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE)));
}

/**
 * What a call ends with.
 * @param call - The call.
 * @returns The error it rejected with, or undefined when it resolved.
 */
async function failureOf(call: Promise<unknown>): Promise<unknown> {
    return await call.then(() => undefined, (error: unknown) => error);
}

/**
 * Writes the queued files that are due until none is left, as the cron job does.
 */
async function settle(): Promise<void> {
    const requests: Repository<FileMirrorRequest> = inject(repositoryTokenFor(FileMirrorRequest));
    await waitUntil(async () => {
        await inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).uploadDueFiles();
        return !await requests.exists({ where: { nextAttemptAt: null, heldForConflict: false }, acrossTenants: true });
    }, 10_000);
}

/**
 * A file of an invoice in a folder of its own.
 * @param connectionId - The connection it is mirrored through.
 * @param content - What it holds.
 * @returns The file.
 */
function createFile(connectionId: string, content: string): FileToMirror {
    const invoiceId: string = UUIDUtilities.generate();
    return { connectionId, path: `${root}/${invoiceId}/Invoices/2026-001.pdf`, content, contentType: 'application/pdf', source: { type: 'invoice', id: invoiceId } };
}

/**
 * Mirrors a file, and waits until it is written.
 * @param file - The file.
 * @returns The requests the server received meanwhile.
 */
async function mirror(file: FileToMirror): Promise<InProcessWebDavRequest[]> {
    const before: number = webDav.requests.length;
    await inTenant(async service => await service.mirrorFile(file, undefined));
    await settle();
    return webDav.requests.slice(before);
}

/**
 * Finds what the mirror stored of a file.
 * @param file - The file.
 * @returns The mirrored file.
 */
async function findMirrored(file: FileToMirror): Promise<MirroredFile | undefined> {
    return (await inTenant(async service => await service.findMirroredFiles(file.source))).find(mirrored => mirrored.path === file.path);
}

beforeAll(async () => {
    await webDav.start();
    webDav.createFolder(root);
    testServer = await startTestServer({
        dataSources: [createInMemoryDataSource({
            entities: [...defaultTestServerEntities, TenantWebDavConnection, MirroredFile, FileMirrorRequest, FileMirrorShareLink],
            repositories: defaultTestServerRepositories
        })],
        providers: [
            ...defaultTestServerProviders,
            // the server of this process, which a tenant's connection reaches only on a private network
            defineProvider({ token: ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS, useValue: { allowedHosts: ['127.0.0.1'], allowPrivateNetworks: true } })
        ]
    });
    await testServer.start();
    const connections: Repository<TenantWebDavConnection> = inject(repositoryTokenFor(TenantWebDavConnection));
    // as a tenant configures them: the WebDAV root of its Nextcloud, once as any WebDAV server and once as a Nextcloud
    [webDavConnectionId, nextcloudConnectionId] = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => [
        (await connections.create({ name: 'Shared drive', kind: WebDavConnectionKind.WEB_DAV, ...webDav.connection })).id,
        (await connections.create({ name: 'Nextcloud', kind: WebDavConnectionKind.NEXTCLOUD, ...webDav.connection })).id
    ]);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await testServer?.shutdown();
    await webDav.stop();
}, TestTimeouts.inMemory.shutdown);

describeFileMirror('a WebDAV server in this process', () => ({
    connectionId: webDavConnectionId,
    kind: WebDavConnectionKind.WEB_DAV,
    folderApp: new WebDavClient({ connection: webDav.connection, network: undefined }),
    root,
    tenantId
}));

describeFileMirror('a Nextcloud in this process', () => ({
    connectionId: nextcloudConnectionId,
    kind: WebDavConnectionKind.NEXTCLOUD,
    folderApp: new WebDavClient({ connection: webDav.connection, network: undefined }),
    root,
    tenantId
}));

describe('FileMirrorService, as the requests it sends', () => {
    it('puts a file first, and creates its folders only once the server answers that they are missing', async () => {
        const file: FileToMirror = createFile(webDavConnectionId, '%PDF-1.7 invoice');

        const sent: InProcessWebDavRequest[] = await mirror(file);

        const folder: string = file.path.split('/').slice(0, -2)
            .join('/');
        expect(sent.map(request => [request.method, request.path, request.ifNoneMatch])).toEqual([
            ['PUT', file.path, '*'],
            ['MKCOL', `${folder}/Invoices/`, undefined],
            ['MKCOL', `${folder}/`, undefined],
            ['MKCOL', `${folder}/Invoices/`, undefined],
            ['PUT', file.path, '*']
        ]);
    });

    it('sends nothing for the same content again, and writes a new one under the ETag written last', async () => {
        const file: FileToMirror = createFile(webDavConnectionId, '%PDF-1.7 version 1');
        await mirror(file);
        const written: MirroredFile | undefined = await findMirrored(file);

        const again: InProcessWebDavRequest[] = await mirror(file);
        const changed: InProcessWebDavRequest[] = await mirror({ ...file, content: '%PDF-1.7 version 2' });

        expect(again).toEqual([]);
        expect(changed.map(request => [request.method, request.ifMatch, request.ifNoneMatch])).toEqual([['PUT', written?.etag, undefined]]);
        expect(webDav.files.get(file.path)?.content.toString()).toBe('%PDF-1.7 version 2');
    });

    it('reads the ETag of a file from the server when the answer to its put names none', async () => {
        const file: FileToMirror = createFile(webDavConnectionId, '%PDF-1.7 invoice');
        webDav.namesEtagOnPut = false;
        try {
            await mirror(file);
        }
        finally {
            webDav.namesEtagOnPut = true;
        }

        expect((await findMirrored(file))?.etag).toBe(webDav.files.get(file.path)?.etag);
    });

    it('writes only the newest of the versions queued meanwhile', async () => {
        const file: FileToMirror = createFile(webDavConnectionId, '%PDF-1.7 version 1');
        const before: number = webDav.requests.length;

        await inTenant(async service => {
            await service.mirrorFile(file, undefined);
            await service.mirrorFile({ ...file, content: '%PDF-1.7 version 2' }, undefined);
        });
        await settle();

        expect(webDav.requests.slice(before).filter(request => request.method === 'PUT' && request.path === file.path)).toHaveLength(2);
        expect(webDav.files.get(file.path)?.content.toString()).toBe('%PDF-1.7 version 2');
        expect(await inject(repositoryTokenFor(FileMirrorRequest)).exists({ where: { path: file.path }, acrossTenants: true })).toBe(false);
    });

    it('takes a file an earlier attempt wrote whose row was never written as its own', async () => {
        const file: FileToMirror = createFile(webDavConnectionId, '%PDF-1.7 written once');
        webDav.createFolder(file.path.split('/').slice(0, -1)
            .join('/'));
        webDav.edit(file.path, '%PDF-1.7 written once');

        await mirror(file);

        expect(await findMirrored(file)).toMatchObject({ conflict: null, etag: webDav.files.get(file.path)?.etag });
    });

    it('retries while the server is down, and writes the file once it is back', async () => {
        const file: FileToMirror = createFile(webDavConnectionId, '%PDF-1.7 during the outage');
        const requests: Repository<FileMirrorRequest> = inject(repositoryTokenFor(FileMirrorRequest));
        webDav.down = true;
        try {
            await inTenant(async service => await service.mirrorFile(file, undefined));
            await waitUntil(async () => {
                await inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).uploadDueFiles();
                return await requests.exists({ where: { path: file.path, attempts: 1 }, acrossTenants: true });
            }, 10_000);
        }
        finally {
            webDav.down = false;
        }
        expect(await requests.findAll({ where: { path: file.path }, acrossTenants: true })).toEqual([
            expect.objectContaining({ attempts: 1, nextAttemptAt: expect.any(Date), error: expect.objectContaining({ name: 'HttpClientError' }) })
        ]);
        expect(webDav.files.has(file.path)).toBe(false);

        // as if the minute of the first retry had passed
        await requests.updateAll({ path: file.path }, { nextAttemptAt: new Date(Date.now() - 1000) }, { acrossTenants: true });
        await waitUntil(async () => {
            await inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).uploadDueFiles();
            return !await requests.exists({ where: { path: file.path }, acrossTenants: true });
        }, 10_000);

        expect(webDav.files.get(file.path)?.content.toString()).toBe('%PDF-1.7 during the outage');
    });

    it('refuses a connection the tenant does not have, and a path that is none, at once', async () => {
        const file: FileToMirror = createFile(webDavConnectionId, '%PDF-1.7 invoice');

        expect(await failureOf(inTenant(async service => await service.mirrorFile({ ...file, connectionId: UUIDUtilities.generate() }, undefined))))
            .toBeInstanceOf(NotFoundError);
        expect(await failureOf(inTenant(async service => await service.mirrorFile({ ...file, path: `${root}/../2026-001.pdf` }, undefined))))
            .toBeInstanceOf(InternalError);
        expect(await failureOf(inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).mirrorFile(file, undefined))).toBeInstanceOf(InternalError);
    });

    it('reports a file somebody moved and changed on a Nextcloud where it is now, and leaves it', async () => {
        const file: FileToMirror = createFile(nextcloudConnectionId, '%PDF-1.7 version 1');
        await mirror(file);
        const moved: string = `${root}/${file.source.id}/2026-001 signed.pdf`;
        webDav.move(file.path, moved);
        webDav.edit(moved, '%PDF-1.7 signed');

        await mirror({ ...file, content: '%PDF-1.7 version 2' });

        expect(webDav.files.get(moved)?.content.toString()).toBe('%PDF-1.7 signed');
        expect(webDav.files.has(file.path)).toBe(false);
        expect(await findMirrored(file)).toMatchObject({ conflict: MirroredFileConflict.CHANGED, currentPath: moved });
    });

    it('writes a file a Nextcloud names another ETag of once it is moved, as long as it holds what was written last', async () => {
        const file: FileToMirror = createFile(nextcloudConnectionId, '%PDF-1.7 version 1');
        await mirror(file);
        const moved: string = `${root}/${file.source.id}/2026-001 renamed.pdf`;
        webDav.move(file.path, moved);
        // as a server whose ETags are of a path as well
        webDav.edit(moved, '%PDF-1.7 version 1');

        await mirror({ ...file, content: '%PDF-1.7 version 2' });

        expect(webDav.files.get(moved)?.content.toString()).toBe('%PDF-1.7 version 2');
        expect(await findMirrored(file)).toMatchObject({ conflict: null, currentPath: moved, etag: webDav.files.get(moved)?.etag });
    });

    it('reports a file moved on a Nextcloud out of the folder of the connection as missing', async () => {
        const connections: Repository<TenantWebDavConnection> = inject(repositoryTokenFor(TenantWebDavConnection));
        const narrow: string = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => (await connections.create({
            name: 'Invoices only',
            kind: WebDavConnectionKind.NEXTCLOUD,
            ...webDav.connection,
            url: `${webDav.connection.url}${root}/`
        })).id);
        const invoiceId: string = UUIDUtilities.generate();
        webDav.createFolder(`${root}/${invoiceId}`);
        const file: FileToMirror = { ...createFile(narrow, '%PDF-1.7 version 1'), path: `${invoiceId}/2026-001.pdf` };
        await mirror(file);
        webDav.createFolder('files/ada-archive');
        webDav.move(`${root}/${file.path}`, 'files/ada-archive/2026-001.pdf');

        await mirror({ ...file, content: '%PDF-1.7 version 2' });

        expect(await findMirrored(file)).toMatchObject({ conflict: MirroredFileConflict.MISSING, currentPath: file.path });
    });
});

describe('FileMirrorService, resolving a conflict', () => {
    /**
     * Mirrors a file, changes it in the folder as somebody working there, and mirrors a new version of it.
     * @param content - What the new version holds.
     * @returns The file, and its mirrored file in conflict.
     */
    async function mirrorIntoConflict(content: string): Promise<[FileToMirror, MirroredFile]> {
        const file: FileToMirror = createFile(webDavConnectionId, '%PDF-1.7 as issued');
        await mirror(file);
        webDav.edit(file.path, '%PDF-1.7 signed by the customer');
        await mirror({ ...file, content });
        const conflicted: MirroredFile | undefined = await findMirrored(file);
        if (conflicted?.conflict == undefined) {
            throw new Error(`"${file.path}" is in no conflict.`);
        }
        return [file, conflicted];
    }

    async function findQueued(file: FileToMirror): Promise<FileMirrorRequest[]> {
        return await inject(repositoryTokenFor(FileMirrorRequest)).findAll({ where: { path: file.path }, acrossTenants: true });
    }

    it('keeps the newest version of a file in conflict, and overwrites the file with it without a condition', async () => {
        const [file, conflicted] = await mirrorIntoConflict('%PDF-1.7 corrected');
        await mirror({ ...file, content: '%PDF-1.7 corrected again' });
        const kept: FileMirrorRequest[] = await findQueued(file);
        const before: number = webDav.requests.length;

        await inTenant(async service => await service.resolveConflict(conflicted.id, MirroredFileConflictResolution.OVERWRITE));

        expect(kept).toEqual([expect.objectContaining({ heldForConflict: true, contentHash: createHash('sha256').update('%PDF-1.7 corrected again').digest('hex') })]);
        expect(webDav.requests.slice(before).filter(request => request.method === 'PUT').map(request => [request.path, request.ifMatch, request.ifNoneMatch]))
            .toEqual([[file.path, undefined, undefined]]);
        expect(webDav.files.get(file.path)?.content.toString()).toBe('%PDF-1.7 corrected again');
        expect(await findMirrored(file)).toMatchObject({ conflict: null, etag: webDav.files.get(file.path)?.etag });
        expect(await findQueued(file)).toEqual([]);
    });

    it('overwrites with a version queued after the conflict, and writes nothing for it again', async () => {
        const [file, conflicted] = await mirrorIntoConflict('%PDF-1.7 corrected');
        webDav.down = true;
        try {
            await inTenant(async service => await service.mirrorFile({ ...file, content: '%PDF-1.7 queued while down' }, undefined));
        }
        finally {
            webDav.down = false;
        }

        await inTenant(async service => await service.resolveConflict(conflicted.id, MirroredFileConflictResolution.OVERWRITE));
        const sent: InProcessWebDavRequest[] = await mirror({ ...file, content: '%PDF-1.7 queued while down' });

        expect(webDav.files.get(file.path)?.content.toString()).toBe('%PDF-1.7 queued while down');
        expect(sent).toEqual([]);
        expect(await findQueued(file)).toEqual([]);
    });

    it('leaves the conflict and the version kept while the server cannot be reached', async () => {
        const [file, conflicted] = await mirrorIntoConflict('%PDF-1.7 corrected');
        webDav.down = true;
        let failure: unknown;
        try {
            failure = await failureOf(inTenant(async service => await service.resolveConflict(conflicted.id, MirroredFileConflictResolution.OVERWRITE)));
        }
        finally {
            webDav.down = false;
        }

        expect(failure).toMatchObject({ name: 'HttpClientError' });
        expect(await findMirrored(file)).toMatchObject({ conflict: MirroredFileConflict.CHANGED });
        expect(await findQueued(file)).toEqual([expect.objectContaining({ heldForConflict: true })]);
        expect(webDav.files.get(file.path)?.content.toString()).toBe('%PDF-1.7 signed by the customer');
    });

    it('refuses to overwrite a file whose versions are no longer kept, and a mirrored file the tenant does not have', async () => {
        const [file, conflicted] = await mirrorIntoConflict('%PDF-1.7 corrected');
        await inject(repositoryTokenFor(FileMirrorRequest)).deleteAll({ path: file.path }, { acrossTenants: true });

        expect(await failureOf(inTenant(async service => await service.resolveConflict(conflicted.id, MirroredFileConflictResolution.OVERWRITE))))
            .toBeInstanceOf(BadRequestError);
        expect(await failureOf(inTenant(async service => await service.resolveConflict(UUIDUtilities.generate(), MirroredFileConflictResolution.OVERWRITE))))
            .toBeInstanceOf(NotFoundError);
        expect(await failureOf(inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            UUIDUtilities.generate(),
            async () => await inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).resolveConflict(conflicted.id, MirroredFileConflictResolution.STOP_MIRRORING)
        ))).toBeInstanceOf(NotFoundError);
        expect(await findMirrored(file)).toMatchObject({ conflict: MirroredFileConflict.CHANGED });
    });

    it('finds the conflicts of the tenant page by page, the latest first', async () => {
        const [, first] = await mirrorIntoConflict('%PDF-1.7 corrected');
        const [, second] = await mirrorIntoConflict('%PDF-1.7 corrected');

        const page: PaginationResult<MirroredFile> = await inTenant(async service => await service.findConflicts(1, 2));
        const other: PaginationResult<MirroredFile> = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            UUIDUtilities.generate(),
            async () => await inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).findConflicts(1, 2)
        );

        expect(page.items.map(file => file.id)).toEqual([second.id, first.id]);
        expect(page.totalAmount).toBeGreaterThanOrEqual(2);
        expect(other).toEqual({ items: [], totalAmount: 0 });
    });
});

describe('FileMirrorService, sharing by link', () => {
    async function shareFolder(path: string, password: string | undefined, expiresOn: string | undefined): Promise<FileMirrorShareLink> {
        return await inTenant(async service => await service.resolveShareLink({ connectionId: nextcloudConnectionId, path, password, expiresOn }));
    }

    it('creates a link with its password and expiry, and answers it again while Nextcloud has it', async () => {
        const folder: string = `${root}/Customers/${UUIDUtilities.generate()}`;
        webDav.createFolder(folder);

        const link: FileMirrorShareLink = await shareFolder(folder, 'Analytical-Engine-1843', '2027-01-31');
        const again: FileMirrorShareLink = await shareFolder(folder, undefined, undefined);

        expect(webDav.shares.get(link.shareId)).toMatchObject({
            path: folder.slice('files/ada'.length),
            password: 'Analytical-Engine-1843',
            expiresOn: '2027-01-31',
            permissions: 1,
            url: link.url
        });
        expect(link).toMatchObject({ expiresOn: '2027-01-31' });
        expect(again).toEqual(link);
        expect(webDav.shares.size).toBeGreaterThanOrEqual(1);
        expect([...webDav.shares.values()].filter(share => share.path === folder.slice('files/ada'.length))).toHaveLength(1);
    });

    it('creates a new link once the one of before was deleted in Nextcloud', async () => {
        const folder: string = `${root}/Customers/${UUIDUtilities.generate()}`;
        webDav.createFolder(folder);
        const first: FileMirrorShareLink = await shareFolder(folder, undefined, undefined);
        webDav.deleteShare(first.shareId);

        const second: FileMirrorShareLink = await shareFolder(folder, undefined, undefined);

        expect(second.id).toBe(first.id);
        expect(second.shareId).not.toBe(first.shareId);
        expect(webDav.shares.has(second.shareId)).toBe(true);
    });

    it('shares a mirrored file where somebody moved it', async () => {
        const file: FileToMirror = createFile(nextcloudConnectionId, '%PDF-1.7 invoice');
        await mirror(file);
        const moved: string = `${root}/${file.source.id}/Sent/2026-001.pdf`;
        webDav.createFolder(`${root}/${file.source.id}/Sent`);
        webDav.move(file.path, moved);
        await mirror({ ...file, content: '%PDF-1.7 reminder' });

        const link: FileMirrorShareLink = await shareFolder(file.path, undefined, undefined);

        expect(webDav.shares.get(link.shareId)?.path).toBe(moved.slice('files/ada'.length));
    });

    it('refuses a link of a path that holds nothing, and of a path that is none', async () => {
        expect(await failureOf(shareFolder(`${root}/Customers/${UUIDUtilities.generate()}`, undefined, undefined))).toMatchObject({ name: 'WebDavNotFoundError' });
        expect(await failureOf(shareFolder(`${root}/../Customers`, undefined, undefined))).toBeInstanceOf(BadRequestError);
    });

    async function revoke(path: string): Promise<void> {
        await inTenant(async service => await service.revokeShareLink(nextcloudConnectionId, path));
    }

    async function findStoredLink(path: string): Promise<FileMirrorShareLink | undefined> {
        return await inTenant(async () => await inject(repositoryTokenFor(FileMirrorShareLink)).findOne({ where: { connectionId: nextcloudConnectionId, path }, required: false }));
    }

    it('revokes a link by deleting its share in Nextcloud and the stored link, and creates a new one when asked again', async () => {
        const folder: string = `${root}/Customers/${UUIDUtilities.generate()}`;
        webDav.createFolder(folder);
        const first: FileMirrorShareLink = await shareFolder(folder, undefined, undefined);

        await revoke(folder);
        const second: FileMirrorShareLink = await shareFolder(folder, undefined, undefined);

        expect(webDav.shares.has(first.shareId)).toBe(false);
        expect(second.id).not.toBe(first.id);
        expect(second.url).not.toBe(first.url);
        expect(webDav.shares.has(second.shareId)).toBe(true);
    });

    it('revokes a link whose share somebody deleted in Nextcloud, and leaves a path without a link as it is', async () => {
        const folder: string = `${root}/Customers/${UUIDUtilities.generate()}`;
        webDav.createFolder(folder);
        const link: FileMirrorShareLink = await shareFolder(folder, undefined, undefined);
        webDav.deleteShare(link.shareId);
        const before: number = webDav.requests.length;

        await revoke(folder);
        await revoke(`${root}/Customers/${UUIDUtilities.generate()}`);

        expect(await findStoredLink(folder)).toBeUndefined();
        expect(webDav.requests.slice(before).map(request => request.method)).toEqual(['DELETE']);
    });

    it('keeps the link while Nextcloud cannot be reached', async () => {
        const folder: string = `${root}/Customers/${UUIDUtilities.generate()}`;
        webDav.createFolder(folder);
        const link: FileMirrorShareLink = await shareFolder(folder, undefined, undefined);
        webDav.down = true;
        let failure: unknown;
        try {
            failure = await failureOf(revoke(folder));
        }
        finally {
            webDav.down = false;
        }

        expect(failure).toMatchObject({ name: 'HttpClientError' });
        expect(await findStoredLink(folder)).toEqual(link);
        expect(webDav.shares.has(link.shareId)).toBe(true);
    });

    it('refuses to revoke a link of a connection to another server, or one the tenant does not have', async () => {
        expect(await failureOf(inTenant(async service => await service.revokeShareLink(webDavConnectionId, `${root}/Customers`)))).toBeInstanceOf(BadRequestError);
        expect(await failureOf(inTenant(async service => await service.revokeShareLink(UUIDUtilities.generate(), `${root}/Customers`)))).toBeInstanceOf(NotFoundError);
    });
});

describe('FileMirrorService, as a connection is deleted', () => {
    it('removes the mirrored files, the files queued and the links of the connection, and leaves the files in the folder', async () => {
        const connections: Repository<TenantWebDavConnection> = inject(repositoryTokenFor(TenantWebDavConnection));
        const connectionId: string = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => (await connections.create({
            name: 'Retired cloud',
            kind: WebDavConnectionKind.NEXTCLOUD,
            ...webDav.connection
        })).id);
        const file: FileToMirror = createFile(connectionId, '%PDF-1.7 invoice');
        await mirror(file);
        await inTenant(async service => await service.resolveShareLink({
            connectionId,
            path: file.path.split('/').slice(0, -1)
                .join('/'),
            password: undefined,
            expiresOn: undefined
        }));
        webDav.down = true;
        try {
            await inTenant(async service => await service.mirrorFile({ ...file, content: '%PDF-1.7 queued' }, undefined));
        }
        finally {
            webDav.down = false;
        }

        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await inject(ZIBRI_DI_TOKENS.TENANT_WEB_DAV_CONNECTION_SERVICE).deleteConnection(connectionId));

        const where: { connectionId: string } = { connectionId };
        expect(await inject(repositoryTokenFor(MirroredFile)).exists({ where, acrossTenants: true })).toBe(false);
        expect(await inject(repositoryTokenFor(FileMirrorRequest)).exists({ where, acrossTenants: true })).toBe(false);
        expect(await inject(repositoryTokenFor(FileMirrorShareLink)).exists({ where, acrossTenants: true })).toBe(false);
        expect(webDav.files.get(file.path)?.content.toString()).toBe('%PDF-1.7 invoice');
    });
});
