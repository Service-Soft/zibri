import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it } from '@jest/globals';

import { waitUntil } from '../__testing__/wait-until.function';
import { type PaginationResult } from '../data-source/models/pagination-result.model';
import { Repository } from '../data-source/repository/repository';
import { type Transaction } from '../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebDavClient } from '../web-dav/web-dav-client';
import { WebDavConnectionKind } from '../web-dav/web-dav-connection-kind.enum';
import { type WebDavEntry } from '../web-dav/web-dav-entry.model';
import { FileMirrorRequest } from './file-mirror-request.model';
import { type FileMirrorServiceInterface } from './file-mirror-service.interface';
import { type FileMirrorShareLink } from './file-mirror-share-link.model';
import { MirroredFileConflictResolution } from './mirrored-file-conflict-resolution.enum';
import { MirroredFileConflict } from './mirrored-file-conflict.enum';
import { type MirroredFile } from './mirrored-file.model';

/**
 * How long a case may take: a server in a container takes up to seconds for each of the requests of a file.
 */
const CASE_TIMEOUT_IN_MS: number = Ms.MINUTE;

/**
 * What the cases of a server need: the connection the mirror writes through, a client of the same folder acting as
 * somebody working in it, and the tenant the files are mirrored for.
 */
export type FileMirrorCaseServer = {
    /**
     * The id of the `TenantWebDavConnection` of the tenant.
     */
    connectionId: string,
    /**
     * Its kind, which decides what becomes of a file somebody moved.
     */
    kind: WebDavConnectionKind,
    /**
     * A client of the url of the connection, which reads, changes and moves files as somebody working in the folder.
     */
    folderApp: WebDavClient,
    /**
     * The folder below the url of the connection the cases write in, which exists, such as `files/ada` for a
     * connection to the WebDAV root of a Nextcloud, or `''`.
     */
    root: string,
    /**
     * The tenant the service is called in.
     */
    tenantId: string
};

/**
 * Reads what a file of the folder holds.
 * @param client - The client of the folder.
 * @param path - The path of the file.
 * @returns Its content, as text.
 */
export async function readFolderText(client: WebDavClient, path: string): Promise<string> {
    return Buffer.concat(await (await client.get(path)).content.toArray()).toString('utf8');
}

/**
 * The cases every WebDAV server the file mirror is tested against answers the same, of the kind of the connection.
 * @param name - What the server is, as the suite names it.
 * @param resolveServer - The server, called once it runs.
 */
export function describeFileMirror(name: string, resolveServer: () => FileMirrorCaseServer): void {
    describe(`FileMirrorService against ${name}`, () => {
        let server: FileMirrorCaseServer;
        // a folder of its own for each case, which the first file mirrored into it creates
        let folder: string;

        /**
         * Calls the service in the tenant of the cases.
         * @param call - What it does with the service.
         * @returns What it resolves to.
         */
        async function inTenant<T>(call: (service: FileMirrorServiceInterface) => Promise<T>): Promise<T> {
            return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(server.tenantId, async () => await call(inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE)));
        }

        /**
         * Writes the queued files that are due until none is left, as the cron job does.
         */
        async function settle(): Promise<void> {
            const requests: Repository<FileMirrorRequest> = inject(repositoryTokenFor(FileMirrorRequest));
            await waitUntil(async () => {
                await inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE).uploadDueFiles();
                return !await requests.exists({ where: { nextAttemptAt: null, heldForConflict: false }, acrossTenants: true });
            }, 30_000);
        }

        /**
         * Mirrors the pdf of an invoice, and waits until it is written.
         * @param path - Where it goes, below the folder of the case.
         * @param content - What it holds.
         */
        async function mirror(path: string, content: string): Promise<void> {
            await inTenant(async service => await service.mirrorFile({
                connectionId: server.connectionId,
                path: `${folder}/${path}`,
                content,
                contentType: 'application/pdf',
                source: { type: 'invoice', id: path }
            }, undefined));
            await settle();
        }

        /**
         * Finds what the mirror stored of a file.
         * @param path - Where the file was mirrored to, below the folder of the case.
         * @returns The mirrored file.
         */
        async function findMirrored(path: string): Promise<MirroredFile | undefined> {
            return (await inTenant(async service => await service.findMirroredFiles({ type: 'invoice', id: path }))).find(file => file.path === `${folder}/${path}`);
        }

        beforeEach(() => {
            server = resolveServer();
            folder = [server.root, `case-${UUIDUtilities.generate()}`].filter(segment => segment !== '').join('/');
        }, CASE_TIMEOUT_IN_MS);

        it('creates a file with the folders it is in, and writes nothing for the same content again', async () => {
            await mirror('Customers/Ada Lovelace/Invoices/2026-001.pdf', '%PDF-1.7 invoice 2026-001');
            const written: MirroredFile | undefined = await findMirrored('Customers/Ada Lovelace/Invoices/2026-001.pdf');
            await mirror('Customers/Ada Lovelace/Invoices/2026-001.pdf', '%PDF-1.7 invoice 2026-001');

            const entry: WebDavEntry | undefined = await server.folderApp.findEntry(`${folder}/Customers/Ada Lovelace/Invoices/2026-001.pdf`);
            expect(await readFolderText(server.folderApp, `${folder}/Customers/Ada Lovelace/Invoices/2026-001.pdf`)).toBe('%PDF-1.7 invoice 2026-001');
            expect(written).toMatchObject({
                currentPath: `${folder}/Customers/Ada Lovelace/Invoices/2026-001.pdf`,
                etag: entry?.etag,
                contentHash: createHash('sha256').update('%PDF-1.7 invoice 2026-001').digest('hex'),
                mirroredAt: expect.any(Date),
                conflict: null
            });
            expect(await findMirrored('Customers/Ada Lovelace/Invoices/2026-001.pdf')).toEqual(written);
        }, CASE_TIMEOUT_IN_MS);

        it('writes a new version of a file nobody changed', async () => {
            await mirror('2026-002.pdf', '%PDF-1.7 version 1');
            await mirror('2026-002.pdf', '%PDF-1.7 version 2');

            expect(await readFolderText(server.folderApp, `${folder}/2026-002.pdf`)).toBe('%PDF-1.7 version 2');
            expect(await findMirrored('2026-002.pdf')).toMatchObject({
                etag: (await server.folderApp.findEntry(`${folder}/2026-002.pdf`))?.etag,
                conflict: null
            });
        }, CASE_TIMEOUT_IN_MS);

        it('leaves a file somebody changed in the folder as it is, and reports the conflict', async () => {
            await mirror('2026-003.pdf', '%PDF-1.7 as issued');
            const written: MirroredFile | undefined = await findMirrored('2026-003.pdf');
            await server.folderApp.put(`${folder}/2026-003.pdf`, '%PDF-1.7 signed by the customer', { contentType: 'application/pdf', overwrite: true });

            await mirror('2026-003.pdf', '%PDF-1.7 corrected');

            expect(await readFolderText(server.folderApp, `${folder}/2026-003.pdf`)).toBe('%PDF-1.7 signed by the customer');
            const conflicted: MirroredFile | undefined = await findMirrored('2026-003.pdf');
            expect(conflicted).toMatchObject({ conflict: MirroredFileConflict.CHANGED, conflictAt: expect.any(Date), etag: written?.etag, contentHash: written?.contentHash });
            const conflicts: PaginationResult<MirroredFile> = await inTenant(async service => await service.findConflicts(1, 100));
            expect(conflicts.items.map(file => file.id)).toContain(conflicted?.id);
            expect(conflicts.totalAmount).toBeGreaterThanOrEqual(1);
        }, CASE_TIMEOUT_IN_MS);

        it('leaves a file somebody put where one is mirrored to first, and reports the conflict', async () => {
            await server.folderApp.createFolder(folder);
            await server.folderApp.put(`${folder}/2026-004.pdf`, '%PDF-1.7 another one', { contentType: 'application/pdf', ifNoneMatch: '*' });

            await mirror('2026-004.pdf', '%PDF-1.7 the invoice');

            expect(await readFolderText(server.folderApp, `${folder}/2026-004.pdf`)).toBe('%PDF-1.7 another one');
            expect(await findMirrored('2026-004.pdf')).toMatchObject({ conflict: MirroredFileConflict.CHANGED, etag: null, contentHash: null, mirroredAt: null });
        }, CASE_TIMEOUT_IN_MS);

        it('writes nothing of a file queued in a transaction that is rolled back', async () => {
            const requests: Repository<FileMirrorRequest> = inject(repositoryTokenFor(FileMirrorRequest));

            const rolledBack: Error | undefined = await inTenant(async service => await requests.dataSource.runInTransaction(async (transaction: Transaction) => {
                await service.mirrorFile({
                    connectionId: server.connectionId,
                    path: `${folder}/2026-005.pdf`,
                    content: '%PDF-1.7 never issued',
                    contentType: 'application/pdf',
                    source: { type: 'invoice', id: '2026-005.pdf' }
                }, transaction);
                throw new Error('rolled back');
            }, { maxAttempts: 1 }).then(() => undefined, (error: unknown) => error instanceof Error ? error : undefined));
            await settle();

            expect(rolledBack?.message).toBe('rolled back');
            expect(await requests.exists({ where: { path: `${folder}/2026-005.pdf` }, acrossTenants: true })).toBe(false);
            expect(await server.folderApp.findEntry(folder)).toBeUndefined();
        }, CASE_TIMEOUT_IN_MS);

        it('puts no second copy where a file was before somebody moved it', async () => {
            await mirror('Invoices/2026-006.pdf', '%PDF-1.7 version 1');
            await server.folderApp.createFolder(`${folder}/Archive`);
            await server.folderApp.move(`${folder}/Invoices/2026-006.pdf`, `${folder}/Archive/2026-006.pdf`, { overwrite: false });

            await mirror('Invoices/2026-006.pdf', '%PDF-1.7 version 2');

            expect(await server.folderApp.findEntry(`${folder}/Invoices/2026-006.pdf`)).toBeUndefined();
            const mirrored: MirroredFile | undefined = await findMirrored('Invoices/2026-006.pdf');
            switch (server.kind) {
                case WebDavConnectionKind.WEB_DAV: {
                    expect(await readFolderText(server.folderApp, `${folder}/Archive/2026-006.pdf`)).toBe('%PDF-1.7 version 1');
                    expect(mirrored).toMatchObject({ conflict: MirroredFileConflict.MISSING, currentPath: `${folder}/Invoices/2026-006.pdf` });
                    break;
                }
                case WebDavConnectionKind.NEXTCLOUD: {
                    // found again by its id, and written where it is now
                    expect(await readFolderText(server.folderApp, `${folder}/Archive/2026-006.pdf`)).toBe('%PDF-1.7 version 2');
                    expect(mirrored).toMatchObject({
                        conflict: null,
                        currentPath: `${folder}/Archive/2026-006.pdf`,
                        etag: (await server.folderApp.findEntry(`${folder}/Archive/2026-006.pdf`))?.etag
                    });
                    break;
                }
            }
        }, CASE_TIMEOUT_IN_MS);

        it('reports a file somebody deleted, and puts it back nowhere', async () => {
            await mirror('2026-007.pdf', '%PDF-1.7 version 1');
            await server.folderApp.delete(`${folder}/2026-007.pdf`);

            await mirror('2026-007.pdf', '%PDF-1.7 version 2');

            expect(await server.folderApp.findEntry(`${folder}/2026-007.pdf`)).toBeUndefined();
            expect(await findMirrored('2026-007.pdf')).toMatchObject({ conflict: MirroredFileConflict.MISSING });
        }, CASE_TIMEOUT_IN_MS);

        it('overwrites a file somebody changed with the last version mirrored, once asked to', async () => {
            await mirror('2026-009.pdf', '%PDF-1.7 as issued');
            await server.folderApp.put(`${folder}/2026-009.pdf`, '%PDF-1.7 signed by the customer', { contentType: 'application/pdf', overwrite: true });
            await mirror('2026-009.pdf', '%PDF-1.7 corrected');
            const conflicted: MirroredFile | undefined = await findMirrored('2026-009.pdf');

            await inTenant(async service => await service.resolveConflict(conflicted?.id ?? '', MirroredFileConflictResolution.OVERWRITE));

            expect(await readFolderText(server.folderApp, `${folder}/2026-009.pdf`)).toBe('%PDF-1.7 corrected');
            expect(await findMirrored('2026-009.pdf')).toMatchObject({
                conflict: null,
                conflictAt: null,
                etag: (await server.folderApp.findEntry(`${folder}/2026-009.pdf`))?.etag,
                contentHash: createHash('sha256').update('%PDF-1.7 corrected').digest('hex')
            });
            expect(await inject(repositoryTokenFor(FileMirrorRequest)).exists({ where: { path: `${folder}/2026-009.pdf` }, acrossTenants: true })).toBe(false);
        }, CASE_TIMEOUT_IN_MS);

        it('puts a file somebody deleted back where it was mirrored to, once asked to', async () => {
            await mirror('Invoices/2026-010.pdf', '%PDF-1.7 version 1');
            await server.folderApp.delete(`${folder}/Invoices`);
            await mirror('Invoices/2026-010.pdf', '%PDF-1.7 version 2');
            const missing: MirroredFile | undefined = await findMirrored('Invoices/2026-010.pdf');

            await inTenant(async service => await service.resolveConflict(missing?.id ?? '', MirroredFileConflictResolution.OVERWRITE));

            expect(missing).toMatchObject({ conflict: MirroredFileConflict.MISSING });
            expect(await readFolderText(server.folderApp, `${folder}/Invoices/2026-010.pdf`)).toBe('%PDF-1.7 version 2');
            expect(await findMirrored('Invoices/2026-010.pdf')).toMatchObject({ conflict: null, currentPath: `${folder}/Invoices/2026-010.pdf` });
        }, CASE_TIMEOUT_IN_MS);

        it('overwrites a file somebody moved and changed where Nextcloud says it is, and where it was mirrored to elsewhere', async () => {
            await mirror('Invoices/2026-011.pdf', '%PDF-1.7 version 1');
            await server.folderApp.createFolder(`${folder}/Archive`);
            await server.folderApp.move(`${folder}/Invoices/2026-011.pdf`, `${folder}/Archive/2026-011.pdf`, { overwrite: false });
            await server.folderApp.put(`${folder}/Archive/2026-011.pdf`, '%PDF-1.7 signed', { contentType: 'application/pdf', overwrite: true });
            await mirror('Invoices/2026-011.pdf', '%PDF-1.7 version 2');
            const conflicted: MirroredFile | undefined = await findMirrored('Invoices/2026-011.pdf');

            await inTenant(async service => await service.resolveConflict(conflicted?.id ?? '', MirroredFileConflictResolution.OVERWRITE));

            switch (server.kind) {
                case WebDavConnectionKind.WEB_DAV: {
                    // the server names no id, so the file is put back where the application mirrors it to
                    expect(conflicted).toMatchObject({ conflict: MirroredFileConflict.MISSING });
                    expect(await readFolderText(server.folderApp, `${folder}/Invoices/2026-011.pdf`)).toBe('%PDF-1.7 version 2');
                    expect(await readFolderText(server.folderApp, `${folder}/Archive/2026-011.pdf`)).toBe('%PDF-1.7 signed');
                    break;
                }
                case WebDavConnectionKind.NEXTCLOUD: {
                    expect(conflicted).toMatchObject({ conflict: MirroredFileConflict.CHANGED, currentPath: `${folder}/Archive/2026-011.pdf` });
                    expect(await readFolderText(server.folderApp, `${folder}/Archive/2026-011.pdf`)).toBe('%PDF-1.7 version 2');
                    expect(await server.folderApp.findEntry(`${folder}/Invoices/2026-011.pdf`)).toBeUndefined();
                    expect(await findMirrored('Invoices/2026-011.pdf')).toMatchObject({ conflict: null, currentPath: `${folder}/Archive/2026-011.pdf`, fileId: conflicted?.fileId });
                    break;
                }
            }
        }, CASE_TIMEOUT_IN_MS);

        it('stops mirroring a file in conflict, and mirrors a later version to its path as a new file', async () => {
            await mirror('2026-012.pdf', '%PDF-1.7 as issued');
            await server.folderApp.put(`${folder}/2026-012.pdf`, '%PDF-1.7 kept by hand', { contentType: 'application/pdf', overwrite: true });
            await mirror('2026-012.pdf', '%PDF-1.7 corrected');
            const conflicted: MirroredFile | undefined = await findMirrored('2026-012.pdf');

            await inTenant(async service => await service.resolveConflict(conflicted?.id ?? '', MirroredFileConflictResolution.STOP_MIRRORING));

            expect(await findMirrored('2026-012.pdf')).toBeUndefined();
            expect(await inject(repositoryTokenFor(FileMirrorRequest)).exists({ where: { path: `${folder}/2026-012.pdf` }, acrossTenants: true })).toBe(false);
            expect(await readFolderText(server.folderApp, `${folder}/2026-012.pdf`)).toBe('%PDF-1.7 kept by hand');

            // written only where nothing is, and something is
            await mirror('2026-012.pdf', '%PDF-1.7 corrected again');
            expect(await readFolderText(server.folderApp, `${folder}/2026-012.pdf`)).toBe('%PDF-1.7 kept by hand');
            expect(await findMirrored('2026-012.pdf')).toMatchObject({ conflict: MirroredFileConflict.CHANGED, etag: null });
        }, CASE_TIMEOUT_IN_MS);

        it('refuses to resolve a file that holds what was mirrored last', async () => {
            await mirror('2026-013.pdf', '%PDF-1.7 as issued');
            const written: MirroredFile | undefined = await findMirrored('2026-013.pdf');

            const refusal: unknown = await inTenant(async service => await service.resolveConflict(written?.id ?? '', MirroredFileConflictResolution.OVERWRITE))
                .then(() => undefined, (error: unknown) => error);

            expect(refusal).toBeInstanceOf(BadRequestError);
            expect(await readFolderText(server.folderApp, `${folder}/2026-013.pdf`)).toBe('%PDF-1.7 as issued');
        }, CASE_TIMEOUT_IN_MS);

        it('shares a folder of mirrored files by a link to read, once', async () => {
            await mirror('Customers/Ada Lovelace/2026-008.pdf', '%PDF-1.7 shared');
            const ask: () => Promise<FileMirrorShareLink> = async () => await inTenant(async service => await service.resolveShareLink({
                connectionId: server.connectionId,
                path: `${folder}/Customers/Ada Lovelace`,
                password: undefined,
                expiresOn: undefined
            }));

            switch (server.kind) {
                case WebDavConnectionKind.WEB_DAV: {
                    expect(await ask().then(() => undefined, (error: unknown) => error)).toBeInstanceOf(BadRequestError);
                    break;
                }
                case WebDavConnectionKind.NEXTCLOUD: {
                    const link: FileMirrorShareLink = await ask();
                    expect(link).toMatchObject({ path: `${folder}/Customers/Ada Lovelace`, url: expect.stringMatching(/^https?:\/\/.+\/s\/\w+$/), expiresOn: null });
                    // asked again, while Nextcloud has it
                    expect(await ask()).toEqual(link);
                    break;
                }
            }
        }, CASE_TIMEOUT_IN_MS);
    });
}
