import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { StartedWebDavTestServer, WebDavTestServerUtilities } from '../../__testing__/web-dav/web-dav-test-server.utilities';
import { GlobalRegistry } from '../../global/global-registry';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { type WebDavEntry } from '../web-dav-entry.model';
import { WebDavNotFoundError } from '../web-dav-not-found.error';
import { NextcloudClient } from './nextcloud-client';
import { type NextcloudShare } from './nextcloud-share.model';
import { type NextcloudTrashBinEntry } from './nextcloud-trash-bin-entry.model';

// what Nextcloud answers the Nextcloud client with, against the server in a container: the id of a file after it is
// moved, and the shares by link. A group of its own, `npm run test:nextcloud`, as the image is half a gigabyte and
// installs itself on every start

const ADMIN: string = 'ada';
let server: StartedWebDavTestServer | undefined;

/**
 * The client of the WebDAV root, logged in with the app password of the admin.
 * @returns The client.
 */
function createClient(): NextcloudClient {
    if (server == undefined) {
        throw new Error('Nextcloud did not start.');
    }
    return new NextcloudClient({ connection: { ...server.connection, url: `${server.origin}/remote.php/dav/` }, network: undefined, timeoutInMs: Ms.MINUTE });
}

/**
 * Deletes a share, as a user does in Nextcloud.
 * @param shareId - The id of the share.
 * @throws When Nextcloud does not delete it.
 */
async function deleteShare(shareId: string): Promise<void> {
    if (server == undefined) {
        throw new Error('Nextcloud did not start.');
    }
    const credentials: string = `${server.connection.username}:${server.connection.password}`;
    const response: Response = await fetch(`${server.origin}/ocs/v2.php/apps/files_sharing/api/v1/shares/${shareId}?format=json`, {
        method: 'DELETE',
        headers: {
            authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
            'ocs-apirequest': 'true'
        }
    });
    if (!response.ok) {
        throw new Error(`Nextcloud deleted no share: ${response.status} ${await response.text()}`);
    }
}

beforeAll(async () => {
    // the errors of the http client carry translated messages, which an application not created refuses to build
    GlobalRegistry.markAppAsCreated();
    WebDavTestServerUtilities.initContainer();
    server = await WebDavTestServerUtilities.startNextcloud({ username: ADMIN, password: 'Lovelace-1815-Analytical' });
}, Ms.MINUTE * 6);

afterAll(async () => {
    await server?.stop();
});

describe('NextcloudClient against Nextcloud', () => {
    it('finds a file by its id after it is moved, with the ETag it had, and nothing once it is in the trash bin', async () => {
        const client: NextcloudClient = createClient();
        const folder: string = `files/${ADMIN}/moves-${UUIDUtilities.generate()}`;
        await client.createFolder(`${folder}/Archive`);
        await client.put(`${folder}/2026-001.pdf`, '%PDF-1.7 invoice', { contentType: 'application/pdf', ifNoneMatch: '*' });
        const written: WebDavEntry<'fileId'> | undefined = await client.findEntry(`${folder}/2026-001.pdf`, { fileId: NextcloudClient.FILE_ID_PROPERTY });
        const fileId: string = written?.properties.fileId ?? '';

        await client.move(`${folder}/2026-001.pdf`, `${folder}/Archive/2026-001 paid.pdf`, { overwrite: false });
        const moved: WebDavEntry<'fileId'> | undefined = await client.findEntryByFileId(fileId, `${folder}/2026-001.pdf`);
        await client.delete(`${folder}/Archive/2026-001 paid.pdf`);

        expect(fileId).toMatch(/^\d+$/);
        expect(moved).toMatchObject({ path: `${folder}/Archive/2026-001 paid.pdf`, kind: 'file', size: 16, etag: written?.etag, properties: { fileId } });
        expect(await client.findEntryByFileId(fileId, `${folder}/2026-001.pdf`)).toBeUndefined();
    });

    it('finds a file by its id through a connection to a folder of the user, and nothing moved out of it', async () => {
        if (server == undefined) {
            throw new Error('Nextcloud did not start.');
        }
        const name: string = `scope-${UUIDUtilities.generate()}`;
        const root: NextcloudClient = createClient();
        await root.createFolder(`files/${ADMIN}/${name}/Invoices`);
        const folder: NextcloudClient = new NextcloudClient({
            connection: { ...server.connection, url: `${server.origin}/remote.php/dav/files/${ADMIN}/${name}/` },
            network: undefined,
            timeoutInMs: Ms.MINUTE
        });
        await folder.put('2026-002.pdf', '%PDF-1.7 invoice', { contentType: 'application/pdf', ifNoneMatch: '*' });
        const fileId: string = (await folder.findEntry('2026-002.pdf', { fileId: NextcloudClient.FILE_ID_PROPERTY }))?.properties.fileId ?? '';

        await folder.move('2026-002.pdf', 'Invoices/2026-002.pdf', { overwrite: false });
        const within: WebDavEntry<'fileId'> | undefined = await folder.findEntryByFileId(fileId, '2026-002.pdf');
        await root.move(`files/${ADMIN}/${name}/Invoices/2026-002.pdf`, `files/${ADMIN}/${name}-2026-002.pdf`, { overwrite: false });

        expect(within).toMatchObject({ path: 'Invoices/2026-002.pdf' });
        expect(await folder.findEntryByFileId(fileId, 'Invoices/2026-002.pdf')).toBeUndefined();
    });

    it('creates a link to read a folder, finds it by its id, and finds nothing once it is deleted', async () => {
        const client: NextcloudClient = createClient();
        const folder: string = `files/${ADMIN}/Customers/${UUIDUtilities.generate()}`;
        await client.createFolder(folder);

        const share: NextcloudShare = await client.createShare({ type: 'link', path: folder, password: undefined, expiresOn: '2099-01-31' });
        const found: NextcloudShare | undefined = await client.findShare(share.id);
        await deleteShare(share.id);

        // to read, and to pass on, which Nextcloud adds to every link
        expect(share).toEqual({ id: expect.stringMatching(/^\d+$/), type: 'link', permissions: 17, url: expect.stringMatching(/\/s\/\w+$/), shareWith: undefined, expiresOn: '2099-01-31' });
        expect(found).toEqual(share);
        expect(await client.findShare(share.id)).toBeUndefined();
    });

    it('deletes a share, and takes a share already deleted as deleted', async () => {
        const client: NextcloudClient = createClient();
        const folder: string = `files/${ADMIN}/Customers/${UUIDUtilities.generate()}`;
        await client.createFolder(folder);
        const share: NextcloudShare = await client.createShare({ type: 'link', path: folder, password: undefined, expiresOn: undefined });

        await client.deleteShare(share.id);
        await client.deleteShare(share.id);

        expect(await client.findShare(share.id)).toBeUndefined();
    });

    it('refuses a link of a path that holds nothing', async () => {
        const client: NextcloudClient = createClient();

        const error: unknown = await client.createShare({ type: 'link', path: `files/${ADMIN}/missing-${UUIDUtilities.generate()}`, password: undefined, expiresOn: undefined })
            .then(() => undefined, (error_: unknown) => error_);

        expect(error).toBeInstanceOf(WebDavNotFoundError);
    });

    it('shares a folder with a user and a group, finds every share of it, and makes one read-only', async () => {
        if (server == undefined) {
            throw new Error('Nextcloud did not start.');
        }
        await WebDavTestServerUtilities.createNextcloudUser(server, { username: 'grace', password: 'Hopper-1906-Compiler' }, ['accounting']);
        const client: NextcloudClient = createClient();
        const folder: string = `files/${ADMIN}/Shared-${UUIDUtilities.generate()}`;
        await client.createFolder(folder);

        const withUser: NextcloudShare = await client.createShare({ type: 'user', path: folder, shareWith: 'grace', permissions: 31 });
        const withGroup: NextcloudShare = await client.createShare({ type: 'group', path: folder, shareWith: 'accounting', permissions: 1 });
        const changed: NextcloudShare = await client.updateShare(withUser.id, { permissions: 1 });
        const found: NextcloudShare[] = await client.findShares(folder);

        expect(withUser).toMatchObject({ type: 'user', shareWith: 'grace', permissions: 31 });
        expect(withGroup).toMatchObject({ type: 'group', shareWith: 'accounting', permissions: 1 });
        expect(changed).toEqual({ ...withUser, permissions: 1 });
        expect(found.map(share => [share.type, share.shareWith, share.permissions]).sort()).toEqual([['group', 'accounting', 1], ['user', 'grace', 1]]);
        expect(await client.findShares(`files/${ADMIN}`)).toEqual([]);
    // a user, a group and an app password created first, of which Nextcloud hashes each password slowly on purpose
    }, Ms.SECOND * 30);

    // what the file mirror tells a change by, as Nextcloud names the same ETag for one in the second of the write before
    it('keeps the checksum a put names, and none once a put naming none overwrites the file', async () => {
        const client: NextcloudClient = createClient();
        const folder: string = `files/${ADMIN}/checksums-${UUIDUtilities.generate()}`;
        await client.createFolder(folder);
        const sha256: string = createHash('sha256').update('%PDF-1.7 as issued')
            .digest('hex');
        const checksumOf: () => Promise<string | undefined> = async () => (await client.findEntry(`${folder}/2026-001.pdf`, {
            checksums: NextcloudClient.CHECKSUMS_PROPERTY
        }))?.properties.checksums;

        await client.putWithChecksum(`${folder}/2026-001.pdf`, '%PDF-1.7 as issued', { contentType: 'application/pdf', ifNoneMatch: '*' }, sha256);
        const written: string | undefined = await checksumOf();
        await client.put(`${folder}/2026-001.pdf`, '%PDF-1.7 signed by the customer', { contentType: 'application/pdf', overwrite: true });
        const overwritten: string | undefined = await checksumOf();

        expect(NextcloudClient.holdsChecksum(written, sha256)).toBe(true);
        expect(NextcloudClient.holdsChecksum(overwritten, sha256)).toBe(false);
    }, Ms.SECOND * 30);

    it('finds what the trash bin holds of a folder by where each was, and deletes it for good', async () => {
        const client: NextcloudClient = createClient();
        const folder: string = `files/${ADMIN}/trash-${UUIDUtilities.generate()}`;
        await client.createFolder(`${folder}/Invoices`);
        await client.put(`${folder}/Invoices/2026-001.pdf`, '%PDF-1.7 invoice', { contentType: 'application/pdf', ifNoneMatch: '*' });
        await client.delete(`${folder}/Invoices/2026-001.pdf`);

        const trashed: NextcloudTrashBinEntry[] = await client.findTrashBinEntries(folder);
        await Promise.all(trashed.map(async entry => await client.deleteTrashBinEntry(entry)));

        expect(trashed).toEqual([{ id: expect.stringMatching(/^2026-001\.pdf\.d\d+$/), user: ADMIN, originalPath: `${folder}/Invoices/2026-001.pdf`, kind: 'file', size: 16, deletedAt: expect.any(Date) }]);
        expect(await client.findTrashBinEntries(folder)).toEqual([]);
    });
});