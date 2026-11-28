import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { StartedWebDavTestServer, WebDavTestServerUtilities } from '../__testing__/web-dav/web-dav-test-server.utilities';
import { GlobalRegistry } from '../global/global-registry';
import { HttpStatus } from '../http/http-status.enum';
import { HttpClientError } from '../http-client/http-client.error';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebDavClient } from './web-dav-client';
import { describeWebDavClient } from './web-dav-client.cases';
import { WebDavDownload } from './web-dav-download.model';
import { WebDavEntry } from './web-dav-entry.model';
import { WebDavPreconditionFailedError } from './web-dav-precondition-failed.error';

// what Nextcloud does that a client of it, a calendar sync, a mirror of files or a backup on it depends on, against
// the server in a container. A group of its own, `npm run test:nextcloud`: the image is half a gigabyte, and it
// installs itself on every start. The cases every server answers alike run here too

const ADMIN: string = 'ada';
const ADMIN_PASSWORD: string = 'Lovelace-1815-Analytical';
const NEXTCLOUD_NAMESPACE: string = 'http://nextcloud.org/ns';
const OWNCLOUD_NAMESPACE: string = 'http://owncloud.org/ns';
const MIB: number = 1024 * 1024;

let server: StartedWebDavTestServer | undefined;

/**
 * The client of the files of the admin, logged in with the app password.
 * @returns The client.
 */
function createClient(): WebDavClient {
    if (server == undefined) {
        throw new Error('Nextcloud did not start.');
    }
    return new WebDavClient({ connection: server.connection, network: undefined, timeoutInMs: Ms.MINUTE });
}

/**
 * The client of the trash bin of the admin, where Nextcloud keeps what is deleted.
 * @returns The client.
 */
function createTrashBinClient(): WebDavClient {
    if (server == undefined) {
        throw new Error('Nextcloud did not start.');
    }
    return new WebDavClient({
        connection: { ...server.connection, url: `${server.origin}/remote.php/dav/trashbin/${ADMIN}/trash/` },
        network: undefined,
        timeoutInMs: Ms.MINUTE
    });
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
    server = await WebDavTestServerUtilities.startNextcloud({ username: ADMIN, password: ADMIN_PASSWORD });
}, Ms.MINUTE * 6);

afterAll(async () => {
    await server?.container.stop();
});

describeWebDavClient('Nextcloud', createClient);

describe('WebDavClient against what only Nextcloud does', () => {
    it('names the same ETag for a put, a get and a listing, and a new one for a change', async () => {
        const client: WebDavClient = createClient();
        const folder: string = `etags-${UUIDUtilities.generate()}`;
        await client.createFolder(folder);

        const written: string | undefined = await client.put(`${folder}/2026-001.pdf`, '%PDF-1.7 a', { contentType: 'application/pdf', ifNoneMatch: '*' });
        const read: WebDavDownload = await client.get(`${folder}/2026-001.pdf`);
        await read.content.toArray();
        const listed: WebDavEntry | undefined = (await client.findEntries(folder))[0];
        const changed: string | undefined = await client.put(`${folder}/2026-001.pdf`, '%PDF-1.7 b', { contentType: 'application/pdf', ifMatch: written ?? '' });

        expect(written).toEqual(expect.stringMatching(/^"[^"]+"$/));
        expect([read.etag, listed?.etag]).toEqual([written, written]);
        expect(changed).toEqual(expect.any(String));
        expect(changed).not.toBe(written);
        expect(await failureOf(client.put(`${folder}/2026-001.pdf`, '%PDF-1.7 c', { contentType: 'application/pdf', ifMatch: written ?? '' })))
            .toBeInstanceOf(WebDavPreconditionFailedError);
    });

    it('takes a file of 8 MiB in one put, twice the largest chunk of a backup', async () => {
        const client: WebDavClient = createClient();
        const folder: string = `large-${UUIDUtilities.generate()}`;
        await client.createFolder(folder);
        const content: Buffer = randomBytes(8 * MIB);

        await client.put(`${folder}/chunk`, content, { contentType: 'application/octet-stream', overwrite: true });
        const read: WebDavDownload = await client.get(`${folder}/chunk`, '16mb');

        expect(Buffer.concat(await read.content.toArray()).equals(content)).toBe(true);
        expect((await client.findEntry(`${folder}/chunk`))?.size).toBe(8 * MIB);
    }, Ms.MINUTE * 2);

    it('keeps a deleted file in the trash bin, where it still takes up space', async () => {
        const client: WebDavClient = createClient();
        const folder: string = `trash-${UUIDUtilities.generate()}`;
        const name: string = `${UUIDUtilities.generate()}.txt`;
        await client.createFolder(folder);
        await client.put(`${folder}/${name}`, 'deleted, and kept', { contentType: 'text/plain', overwrite: true });

        await client.delete(`${folder}/${name}`);

        const trashed: WebDavEntry<'filename' | 'location'>[] = await createTrashBinClient().findEntries('', {
            filename: { namespace: NEXTCLOUD_NAMESPACE, name: 'trashbin-filename' },
            location: { namespace: NEXTCLOUD_NAMESPACE, name: 'trashbin-original-location' }
        });
        expect(await client.findEntry(`${folder}/${name}`)).toBeUndefined();
        expect(trashed.filter(entry => entry.properties.filename === name)).toEqual([
            expect.objectContaining({ kind: 'file', size: 17, properties: { filename: name, location: `${folder}/${name}` } })
        ]);
    });

    it('replaces the destination of a move only when told to', async () => {
        const client: WebDavClient = createClient();
        const folder: string = `move-${UUIDUtilities.generate()}`;
        await client.createFolder(folder);
        await client.put(`${folder}/.chunk.part`, 'new', { contentType: 'application/octet-stream', overwrite: true });
        await client.put(`${folder}/chunk`, 'old', { contentType: 'application/octet-stream', overwrite: true });

        const refused: unknown = await failureOf(client.move(`${folder}/.chunk.part`, `${folder}/chunk`, { overwrite: false }));
        await client.move(`${folder}/.chunk.part`, `${folder}/chunk`, { overwrite: true });
        const read: WebDavDownload = await client.get(`${folder}/chunk`);

        expect(refused).toBeInstanceOf(WebDavPreconditionFailedError);
        expect(Buffer.concat(await read.content.toArray()).toString()).toBe('new');
        expect((await client.findEntries(folder)).map(entry => entry.name)).toEqual(['chunk']);
    });

    it('creates folders four levels deep, and names the id it keeps each under', async () => {
        const client: WebDavClient = createClient();
        const folder: string = `nested-${UUIDUtilities.generate()}`;

        await client.createFolder(`${folder}/Customers/Ada/Invoices/2026`);

        const entries: WebDavEntry<'fileId'>[] = await client.findEntries(`${folder}/Customers/Ada/Invoices`, {
            fileId: { namespace: OWNCLOUD_NAMESPACE, name: 'fileid' }
        });
        expect(entries).toEqual([expect.objectContaining({ name: '2026', kind: 'folder', properties: { fileId: expect.stringMatching(/^\d+$/) } })]);
    });

    // last: a login Nextcloud refuses slows the next ones from the same address down
    it('logs in with an app password, and refuses one it does not know', async () => {
        if (server == undefined) {
            throw new Error('Nextcloud did not start.');
        }
        const refused: WebDavClient = new WebDavClient({
            connection: { ...server.connection, password: 'not-an-app-password' },
            network: undefined
        });

        expect(server.connection.password).not.toBe(ADMIN_PASSWORD);
        expect(await createClient().findEntry('')).toMatchObject({ kind: 'folder' });
        const error: unknown = await failureOf(refused.findEntry(''));
        expect(error).toBeInstanceOf(HttpClientError);
        expect(error).toMatchObject({ responseData: { status: HttpStatus.UNAUTHORIZED } });
    });
});
