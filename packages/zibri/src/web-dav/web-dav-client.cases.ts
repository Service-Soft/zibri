import { beforeEach, describe, expect, it } from '@jest/globals';

import { MimeType } from '../http/mime-type.enum';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebDavClient } from './web-dav-client';
import { WebDavConflictError } from './web-dav-conflict.error';
import { WebDavDownload } from './web-dav-download.model';
import { WebDavEntry } from './web-dav-entry.model';
import { WebDavNotFoundError } from './web-dav-not-found.error';
import { WebDavPreconditionFailedError } from './web-dav-precondition-failed.error';

/**
 * The content type the calendar files of the cases are written as.
 */
const CALENDAR_CONTENT_TYPE: string = 'text/calendar';

/**
 * What a case ends with.
 * @param call - The call.
 * @returns The error it rejected with, or undefined when it resolved.
 */
async function failureOf(call: Promise<unknown>): Promise<unknown> {
    return await call.then(() => undefined, (error: unknown) => error);
}

/**
 * Reads what a file holds.
 * @param download - The file, as the client read it.
 * @returns Its content, as text.
 */
async function readText(download: WebDavDownload): Promise<string> {
    return Buffer.concat(await download.content.toArray()).toString('utf8');
}

/**
 * The cases every WebDAV server a client is tested against answers the same.
 * @param name - What the server is, as the suite names it.
 * @param resolveClient - The client of a folder of the server, called once the server runs.
 * @param etags - How the server names the version of a file: `'per-write'` a new ETag for every write, `'per-second'`
 * the same one for a write in the second of the one before, as Nextcloud does, whose cases write the next version in
 * the second after.
 */
export function describeWebDavClient(name: string, resolveClient: () => WebDavClient, etags: 'per-write' | 'per-second'): void {
    /**
     * Waits for the second after the one a write was in, on a server naming one ETag per second: a person or a
     * process writes the next version later than that.
     */
    async function waitForNextVersion(): Promise<void> {
        if (etags === 'per-second') {
            await new Promise(resolve => setTimeout(resolve, 1000 - (Date.now() % 1000) + 50));
        }
    }

    describe(`WebDavClient against ${name}`, () => {
        let client: WebDavClient;
        // a folder of its own for each case, so that no case sees what another wrote
        let folder: string;

        beforeEach(async () => {
            client = resolveClient();
            folder = `case-${UUIDUtilities.generate()}`;
            await client.createFolder(folder);
        });

        it('writes a file, reads it back and lists it, with one ETag throughout', async () => {
            await client.put(`${folder}/2026-001.pdf`, '%PDF-1.7 invoice', { contentType: MimeType.PDF, ifNoneMatch: '*' });

            const download: WebDavDownload = await client.get(`${folder}/2026-001.pdf`);
            const entries: WebDavEntry[] = await client.findEntries(folder);

            expect(await readText(download)).toBe('%PDF-1.7 invoice');
            expect(entries).toEqual([
                {
                    name: '2026-001.pdf',
                    path: `${folder}/2026-001.pdf`,
                    kind: 'file',
                    size: 16,
                    etag: download.etag,
                    modifiedAt: expect.any(Date),
                    properties: {}
                }
            ]);
            expect(download.etag).toEqual(expect.any(String));
        });

        it('keeps names with spaces, umlauts and signs a url gives a meaning to', async () => {
            await client.createFolder(`${folder}/Kunden/Müller & Söhne #1`);
            await client.put(
                `${folder}/Kunden/Müller & Söhne #1/Rechnung 100%?.txt`,
                'paid',
                { contentType: MimeType.TXT, overwrite: true }
            );

            const entries: WebDavEntry[] = await client.findEntries(`${folder}/Kunden/Müller & Söhne #1`);

            expect(entries.map(entry => [entry.name, entry.path]))
                .toEqual([['Rechnung 100%?.txt', `${folder}/Kunden/Müller & Söhne #1/Rechnung 100%?.txt`]]);
        });

        it('creates nested folders, and leaves a folder that exists as it is', async () => {
            await client.createFolder(`${folder}/Customers/Ada/Invoices`);
            await client.put(`${folder}/Customers/Ada/Invoices/2026-001.pdf`, 'invoice', { contentType: MimeType.PDF, overwrite: true });
            await client.createFolder(`${folder}/Customers/Ada/Invoices`);

            expect((await client.findEntries(`${folder}/Customers/Ada`)).map(entry => [entry.name, entry.kind]))
                .toEqual([['Invoices', 'folder']]);
            expect((await client.findEntries(`${folder}/Customers/Ada/Invoices`)).map(entry => entry.name)).toEqual(['2026-001.pdf']);
        });

        // each found the folder missing, and the server refused all but the first that created it
        it('creates a folder several calls create at once', async () => {
            await Promise.all(Array.from({ length: 8 }, async () => await client.createFolder(`${folder}/Parallel/Invoices`)));

            expect((await client.findEntry(`${folder}/Parallel/Invoices`))?.kind).toBe('folder');
        });

        it('refuses a folder where a file is', async () => {
            await client.put(`${folder}/Invoices`, 'a file', { contentType: MimeType.TXT, overwrite: true });

            expect(await failureOf(client.createFolder(`${folder}/Invoices`))).toBeInstanceOf(WebDavConflictError);
        });

        it('lists one level of a folder, its files and folders apart', async () => {
            await client.createFolder(`${folder}/Archive/2025`);
            await client.put(`${folder}/notes.txt`, 'hello', { contentType: MimeType.TXT, overwrite: true });

            const entries: WebDavEntry[] = await client.findEntries(folder);

            expect(entries.map(entry => [entry.name, entry.kind, entry.size]).sort()).toEqual([
                ['Archive', 'folder', undefined],
                ['notes.txt', 'file', 5]
            ]);
        });

        it('finds a file and a folder by their path, and nothing where nothing is', async () => {
            await client.put(`${folder}/notes.txt`, 'hello', { contentType: MimeType.TXT, overwrite: true });

            expect(await client.findEntry(`${folder}/notes.txt`)).toMatchObject({ kind: 'file', size: 5, name: 'notes.txt' });
            expect(await client.findEntry(folder)).toMatchObject({ kind: 'folder', path: folder });
            expect(await client.findEntry(`${folder}/missing.txt`)).toBeUndefined();
        });

        it('refuses a put under an ETag the file has moved on from', async () => {
            await client.put(`${folder}/task.ics`, 'version 1', { contentType: CALENDAR_CONTENT_TYPE, overwrite: true });
            const first: string | undefined = (await client.findEntry(`${folder}/task.ics`))?.etag;
            await waitForNextVersion();
            await client.put(`${folder}/task.ics`, 'version two', { contentType: CALENDAR_CONTENT_TYPE, overwrite: true });

            const error: unknown = await failureOf(
                client.put(`${folder}/task.ics`, 'version 3!', { contentType: CALENDAR_CONTENT_TYPE, ifMatch: first ?? '' })
            );

            expect(first).toEqual(expect.any(String));
            expect(error).toBeInstanceOf(WebDavPreconditionFailedError);
            expect(await readText(await client.get(`${folder}/task.ics`))).toBe('version two');
        });

        // what the file mirror writes under: the ETag the answer to its own put names, and somebody overwriting it since
        it('refuses a put under the ETag its own put was answered with, once somebody overwrote the file', async () => {
            const written: string | undefined = await client.put(
                `${folder}/mirrored.pdf`,
                '%PDF-1.7 as issued',
                { contentType: MimeType.PDF, ifNoneMatch: '*' }
            );
            // read before anybody else writes, as the mirror does for a server whose answer names none, such as Apache
            const etag: string | undefined = written ?? (await client.findEntry(`${folder}/mirrored.pdf`))?.etag;
            await waitForNextVersion();
            await client.put(`${folder}/mirrored.pdf`, '%PDF-1.7 signed by the customer', { contentType: MimeType.PDF, overwrite: true });
            // whether the server itself names the file by another ETag once it was overwritten, which a client could
            // compare with before it writes
            const listed: string | undefined = (await client.findEntry(`${folder}/mirrored.pdf`))?.etag;

            const error: unknown = await failureOf(
                client.put(`${folder}/mirrored.pdf`, '%PDF-1.7 corrected', { contentType: MimeType.PDF, ifMatch: etag ?? '' })
            );

            expect(listed).not.toBe(etag);
            expect(error).toBeInstanceOf(WebDavPreconditionFailedError);
            expect(await readText(await client.get(`${folder}/mirrored.pdf`))).toBe('%PDF-1.7 signed by the customer');
        });

        it('writes a put under the ETag the file has', async () => {
            await client.put(`${folder}/task.ics`, 'version 1', { contentType: CALENDAR_CONTENT_TYPE, overwrite: true });
            const current: string | undefined = (await client.findEntry(`${folder}/task.ics`))?.etag;

            await client.put(`${folder}/task.ics`, 'version 2', { contentType: CALENDAR_CONTENT_TYPE, ifMatch: current ?? '' });

            expect(await readText(await client.get(`${folder}/task.ics`))).toBe('version 2');
        });

        it('refuses a put only where there is no file, where there is one', async () => {
            await client.put(`${folder}/task.ics`, 'version 1', { contentType: CALENDAR_CONTENT_TYPE, ifNoneMatch: '*' });

            const error: unknown = await failureOf(
                client.put(`${folder}/task.ics`, 'version 2', { contentType: CALENDAR_CONTENT_TYPE, ifNoneMatch: '*' })
            );

            expect(error).toBeInstanceOf(WebDavPreconditionFailedError);
            expect(await readText(await client.get(`${folder}/task.ics`))).toBe('version 1');
        });

        it('refuses a put into a folder that does not exist', async () => {
            const error: unknown = await failureOf(
                client.put(`${folder}/Missing/notes.txt`, 'hello', { contentType: MimeType.TXT, overwrite: true })
            );

            expect(error).toBeInstanceOf(WebDavConflictError);
        });

        it('moves a file into place, replacing what is there only when told to', async () => {
            await client.put(`${folder}/.chunk.upload`, 'new', { contentType: MimeType.OCTET_STREAM, overwrite: true });
            await client.put(`${folder}/chunk`, 'old', { contentType: MimeType.OCTET_STREAM, overwrite: true });

            const refused: unknown = await failureOf(client.move(`${folder}/.chunk.upload`, `${folder}/chunk`, { overwrite: false }));
            await client.move(`${folder}/.chunk.upload`, `${folder}/chunk`, { overwrite: true });

            expect(refused).toBeInstanceOf(WebDavPreconditionFailedError);
            expect(await readText(await client.get(`${folder}/chunk`))).toBe('new');
            expect(await client.findEntry(`${folder}/.chunk.upload`)).toBeUndefined();
        });

        it('refuses a move of what does not exist, and into a folder that does not exist', async () => {
            await client.put(`${folder}/chunk`, 'data', { contentType: MimeType.OCTET_STREAM, overwrite: true });

            const missing: unknown = await failureOf(client.move(`${folder}/missing`, `${folder}/chunk-2`, { overwrite: false }));
            const noFolder: unknown = await failureOf(client.move(`${folder}/chunk`, `${folder}/Missing/chunk`, { overwrite: false }));

            expect(missing).toBeInstanceOf(WebDavNotFoundError);
            expect(noFolder).toBeInstanceOf(WebDavConflictError);
        });

        it('deletes a file, and a folder with what it holds', async () => {
            await client.createFolder(`${folder}/Archive/2025`);
            await client.put(`${folder}/Archive/2025/notes.txt`, 'hello', { contentType: MimeType.TXT, overwrite: true });
            await client.put(`${folder}/notes.txt`, 'hello', { contentType: MimeType.TXT, overwrite: true });

            await client.delete(`${folder}/notes.txt`);
            await client.delete(`${folder}/Archive`);

            expect(await client.findEntries(folder)).toEqual([]);
            expect(await failureOf(client.delete(`${folder}/notes.txt`))).toBeInstanceOf(WebDavNotFoundError);
        });

        it('refuses to read a file that does not exist', async () => {
            expect(await failureOf(client.get(`${folder}/missing.txt`))).toBeInstanceOf(WebDavNotFoundError);
        });

        it('refuses to list a folder that does not exist', async () => {
            expect(await failureOf(client.findEntries(`${folder}/Missing`))).toBeInstanceOf(WebDavNotFoundError);
        });
    });
}