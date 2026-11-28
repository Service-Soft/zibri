import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { InProcessWebDavServer } from '../../__testing__/web-dav/in-process-web-dav-server.model';
import { WebDavTestServerUtilities } from '../../__testing__/web-dav/web-dav-test-server.utilities';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { type WebDavEntry } from '../web-dav-entry.model';
import { WebDavNotFoundError } from '../web-dav-not-found.error';
import { NextcloudClient } from './nextcloud-client';
import { type NextcloudShare } from './nextcloud-share.model';
import { type NextcloudTrashBinEntry } from './nextcloud-trash-bin-entry.model';

// what the Nextcloud client sends and how it reads the answers, against a server in this process that answers as
// Nextcloud does. What Nextcloud itself does is held by nextcloud-client.nextcloud.test.ts

const server: InProcessWebDavServer = new InProcessWebDavServer('ada', 'Lovelace-app-password');

/**
 * The client of a folder of the server.
 * @param folder - The folder below `remote.php/dav/`, `''` for the WebDAV root.
 * @returns The client.
 */
function createClient(folder: string): NextcloudClient {
    return new NextcloudClient({ connection: { ...server.connection, url: `${server.connection.url}${folder}` }, network: undefined });
}

/**
 * What a call ends with.
 * @param call - The call.
 * @returns The error it rejected with, or undefined when it resolved.
 */
async function failureOf(call: Promise<unknown>): Promise<unknown> {
    return await call.then(() => undefined, (error: unknown) => error);
}

beforeAll(async () => {
    // the errors of the http client carry translated messages, which an application not created refuses to build
    GlobalRegistry.markAppAsCreated();
    WebDavTestServerUtilities.initContainer();
    await server.start();
});

afterAll(async () => {
    await server.stop();
});

describe('NextcloudClient', () => {
    it('refuses a url that is not below /remote.php/dav/', () => {
        const create: (url: string) => NextcloudClient = url => new NextcloudClient({ connection: { ...server.connection, url }, network: undefined });

        expect(() => create('https://cloud.example.com/remote.php/webdav/')).toThrow(InternalError);
        expect(() => create('https://cloud.example.com/dav/files/ada/')).toThrow(InternalError);
        expect(create('https://cloud.example.com/nextcloud/remote.php/dav/files/ada/')).toBeInstanceOf(NextcloudClient);
    });

    it('finds a file by its id where somebody moved it, through the WebDAV root and through a folder of the user', async () => {
        const folder: string = `files/ada/${UUIDUtilities.generate()}`;
        server.createFolder(`${folder}/Archive`);
        server.edit(`${folder}/2026-001.pdf`, '%PDF-1.7 invoice');
        const fileId: string = server.files.get(`${folder}/2026-001.pdf`)?.fileId ?? '';
        server.move(`${folder}/2026-001.pdf`, `${folder}/Archive/2026-001.pdf`);

        const fromRoot: WebDavEntry<'fileId'> | undefined = await createClient('').findEntryByFileId(fileId, `${folder}/2026-001.pdf`);
        const fromFolder: WebDavEntry<'fileId'> | undefined = await createClient(`${folder}/`).findEntryByFileId(fileId, '2026-001.pdf');

        expect(fromRoot).toMatchObject({ path: `${folder}/Archive/2026-001.pdf`, kind: 'file', etag: server.files.get(`${folder}/Archive/2026-001.pdf`)?.etag, properties: { fileId } });
        expect(fromFolder).toMatchObject({ path: 'Archive/2026-001.pdf', properties: { fileId } });
    });

    it('finds nothing of a file moved out of the folder of the connection, or of an id nothing has', async () => {
        const folder: string = `files/ada/${UUIDUtilities.generate()}`;
        server.createFolder(folder);
        server.edit(`${folder}/2026-002.pdf`, '%PDF-1.7 invoice');
        const fileId: string = server.files.get(`${folder}/2026-002.pdf`)?.fileId ?? '';
        server.move(`${folder}/2026-002.pdf`, 'files/ada/2026-002.pdf');

        expect(await createClient(`${folder}/`).findEntryByFileId(fileId, '2026-002.pdf')).toBeUndefined();
        expect(await createClient('').findEntryByFileId('999999', `${folder}/2026-002.pdf`)).toBeUndefined();
    });

    it('refuses an id that is no id of Nextcloud, and a path that is not among the files of a user', async () => {
        expect(await failureOf(createClient('').findEntryByFileId('12 OR 1', 'files/ada/2026-001.pdf'))).toBeInstanceOf(InternalError);
        expect(await failureOf(createClient('').findEntryByFileId('12', 'calendars/ada/personal/task.ics'))).toBeInstanceOf(InternalError);
        expect(await failureOf(createClient('').createShare({ type: 'link', path: 'files', password: undefined, expiresOn: undefined }))).toBeInstanceOf(InternalError);
    });

    it('creates a link to read a folder by its path within the files of the user, and finds it by its id', async () => {
        const customer: string = UUIDUtilities.generate();
        server.createFolder(`files/ada/Customers/${customer}`);

        const share: NextcloudShare = await createClient('files/ada/Customers/').createShare({ type: 'link', path: customer, password: 'Analytical-Engine-1843', expiresOn: '2027-01-31' });

        expect(server.shares.get(share.id)).toMatchObject({ path: `/Customers/${customer}`, password: 'Analytical-Engine-1843', expiresOn: '2027-01-31', permissions: 1 });
        expect(share).toEqual({ id: share.id, type: 'link', permissions: 1, url: expect.stringMatching(/\/s\/\w+$/), shareWith: undefined, expiresOn: '2027-01-31' });
        expect(await createClient('').findShare(share.id)).toEqual(share);
    });

    it('deletes a share by its id, and takes one Nextcloud does not have as deleted', async () => {
        const customer: string = UUIDUtilities.generate();
        server.createFolder(`files/ada/Customers/${customer}`);
        const client: NextcloudClient = createClient('');
        const share: NextcloudShare = await client.createShare({ type: 'link', path: `files/ada/Customers/${customer}`, password: undefined, expiresOn: undefined });

        await client.deleteShare(share.id);
        await client.deleteShare(share.id);

        expect(server.shares.has(share.id)).toBe(false);
        expect(await client.findShare(share.id)).toBeUndefined();
    });

    it('finds no share of an id Nextcloud does not have, and refuses a link of a path that holds nothing or an expiry that is no day', async () => {
        const client: NextcloudClient = createClient('');

        expect(await client.findShare('404404')).toBeUndefined();
        expect(await failureOf(client.createShare({ type: 'link', path: `files/ada/${UUIDUtilities.generate()}`, password: undefined, expiresOn: undefined })))
            .toBeInstanceOf(WebDavNotFoundError);
        expect(await failureOf(client.createShare({ type: 'link', path: 'files/ada', password: undefined, expiresOn: '31.01.2027' }))).toBeInstanceOf(InternalError);
    });

    it('shares a folder with a user and a group, finds every share of it, and changes what one permits', async () => {
        const customer: string = UUIDUtilities.generate();
        server.createFolder(`files/ada/Customers/${customer}`);
        const client: NextcloudClient = createClient('files/ada/');

        const withUser: NextcloudShare = await client.createShare({ type: 'user', path: `Customers/${customer}`, shareWith: 'grace', permissions: 31 });
        const withGroup: NextcloudShare = await client.createShare({ type: 'group', path: `Customers/${customer}`, shareWith: 'accounting', permissions: 1 });
        const changed: NextcloudShare = await client.updateShare(withUser.id, { permissions: 1 });

        expect(withUser).toEqual({ id: withUser.id, type: 'user', permissions: 31, url: undefined, shareWith: 'grace', expiresOn: undefined });
        expect(withGroup).toMatchObject({ type: 'group', permissions: 1, shareWith: 'accounting' });
        expect(changed).toEqual({ ...withUser, permissions: 1 });
        expect(await client.findShares(`Customers/${customer}`)).toEqual([changed, withGroup]);
        expect(await client.findShares('Customers')).toEqual([]);
        expect(await failureOf(client.findShares(`Customers/${UUIDUtilities.generate()}`))).toBeInstanceOf(WebDavNotFoundError);
        expect(await failureOf(client.updateShare('404404', { permissions: 1 }))).toBeInstanceOf(WebDavNotFoundError);
    });

    it('finds what the trash bin holds of a folder, by where each was, and deletes one for good', async () => {
        const folder: string = UUIDUtilities.generate();
        server.createFolder(`files/ada/${folder}/Invoices`);
        server.edit(`files/ada/${folder}/Invoices/2026-001.pdf`, '%PDF-1.7 invoice');
        server.edit(`files/ada/${folder}-elsewhere.pdf`, '%PDF-1.7 elsewhere');
        const client: NextcloudClient = createClient(`files/ada/${folder}/`);
        await client.delete('Invoices/2026-001.pdf');
        await client.delete('Invoices');
        await createClient('files/ada/').delete(`${folder}-elsewhere.pdf`);

        const trashed: NextcloudTrashBinEntry[] = (await client.findTrashBinEntries('')).sort((a, b) => a.originalPath.localeCompare(b.originalPath));
        const invoice: NextcloudTrashBinEntry | undefined = trashed.find(entry => entry.kind === 'file');
        assert(invoice, 'the invoice is not in the trash bin');
        await client.deleteTrashBinEntry(invoice);

        expect(trashed).toEqual([
            { id: expect.stringMatching(/^Invoices\.d\d+$/), user: 'ada', originalPath: 'Invoices', kind: 'folder', size: undefined, deletedAt: expect.any(Date) },
            { id: expect.stringMatching(/^2026-001\.pdf\.d\d+$/), user: 'ada', originalPath: 'Invoices/2026-001.pdf', kind: 'file', size: 16, deletedAt: expect.any(Date) }
        ]);
        expect((await client.findTrashBinEntries('')).map(entry => entry.originalPath)).toEqual(['Invoices']);
        expect(await createClient('').findTrashBinEntries(`files/ada/${folder}/Invoices`)).toEqual([expect.objectContaining({ originalPath: `files/ada/${folder}/Invoices` })]);
    });

    it('takes an entry the trash bin no longer holds as deleted', async () => {
        const client: NextcloudClient = createClient('files/ada/');

        await client.deleteTrashBinEntry({ id: 'gone.d1764160000', user: 'ada', originalPath: 'gone', kind: 'file', size: 4, deletedAt: undefined });

        expect(server.trashBin.has('gone.d1764160000')).toBe(false);
    });
});