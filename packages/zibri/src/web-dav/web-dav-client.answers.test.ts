import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { WebDavTestServerUtilities } from '../__testing__/web-dav/web-dav-test-server.utilities';
import { InternalError } from '../error-handling/internal-error.model';
import { GlobalRegistry } from '../global/global-registry';
import { HttpMethod, httpMethodKey } from '../http/http-method.enum';
import { HttpStatus } from '../http/http-status.enum';
import { HttpClientError } from '../http-client/http-client.error';
import { WebDavMethod } from '../http-client/web-dav-method.enum';
import { WebDavClient } from './web-dav-client';
import { WebDavConflictError } from './web-dav-conflict.error';
import { WebDavDownload } from './web-dav-download.model';
import { WebDavEntry } from './web-dav-entry.model';
import { WebDavForbiddenError } from './web-dav-forbidden.error';
import { WebDavNotFoundError } from './web-dav-not-found.error';
import { WebDavPreconditionFailedError } from './web-dav-precondition-failed.error';
import { WebDavPutOptions } from './web-dav-put-options.model';

// what the answers of a WebDAV server look like to the client, from a server in this process: how a listing is
// read, which status becomes which error, what each request carries, and which hosts a tenant's connection
// reaches. What real servers do is held by web-dav-client.container.test.ts and web-dav-client.nextcloud.test.ts

/**
 * A request the server received.
 */
type ReceivedRequest = {
    /**
     * The method.
     */
    method: string,
    /**
     * The path and query, as sent.
     */
    url: string,
    /**
     * The headers, by their lowercase names.
     */
    headers: IncomingMessage['headers'],
    /**
     * The body.
     */
    body: Buffer
};

/**
 * What the server answers a request with.
 */
type Answer = {
    /**
     * The status.
     */
    status: number,
    /**
     * The headers.
     */
    headers?: Record<string, string>,
    /**
     * The body.
     */
    body?: string,
    /**
     * Whether the connection is closed instead, without an answer, as a server closes one it keeps alive just as a
     * request arrives on it.
     */
    hangUp?: boolean
};

/**
 * Answers a request of a test.
 */
type Answering = (request: ReceivedRequest) => Answer;

const USERNAME: string = 'ada';
const PASSWORD: string = 'Lovelace-app-password';
const CREDENTIALS: string = `${USERNAME}:${PASSWORD}`;
const FILES_PATH: string = '/remote.php/dav/files/ada/';
const OWNCLOUD_NAMESPACE: string = 'http://owncloud.org/ns';

/**
 * A listing of `Invoices` as Apache's mod_dav answers it: `D:` for the namespace, and the properties of each
 * resource under prefixes of their own.
 */
const APACHE_LISTING: string = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:ns0="DAV:">
<D:response xmlns:lp1="DAV:" xmlns:lp2="http://apache.org/dav/props/">
<D:href>${FILES_PATH}Invoices/</D:href>
<D:propstat>
<D:prop>
<lp1:resourcetype><D:collection/></lp1:resourcetype>
<lp1:getlastmodified>Wed, 25 Nov 2026 10:00:00 GMT</lp1:getlastmodified>
<lp1:getetag>"1000-5f3a"</lp1:getetag>
</D:prop>
<D:status>HTTP/1.1 200 OK</D:status>
</D:propstat>
<D:propstat>
<D:prop>
<D:getcontentlength/>
</D:prop>
<D:status>HTTP/1.1 404 Not Found</D:status>
</D:propstat>
</D:response>
<D:response xmlns:lp1="DAV:" xmlns:lp2="http://apache.org/dav/props/">
<D:href>${FILES_PATH}Invoices/2026%20Q1.pdf</D:href>
<D:propstat>
<D:prop>
<lp1:resourcetype/>
<lp1:getcontentlength>1024</lp1:getcontentlength>
<lp1:getlastmodified>Thu, 26 Nov 2026 08:30:00 GMT</lp1:getlastmodified>
<lp1:getetag>"400-5f3b"</lp1:getetag>
</D:prop>
<D:status>HTTP/1.1 200 OK</D:status>
</D:propstat>
</D:response>
<D:response xmlns:lp1="DAV:" xmlns:lp2="http://apache.org/dav/props/">
<D:href>${FILES_PATH}Invoices/Archive/</D:href>
<D:propstat>
<D:prop>
<lp1:resourcetype><D:collection/></lp1:resourcetype>
<lp1:getlastmodified>Mon, 02 Nov 2026 12:00:00 GMT</lp1:getlastmodified>
<lp1:getetag>"1000-5f3c"</lp1:getetag>
</D:prop>
<D:status>HTTP/1.1 200 OK</D:status>
</D:propstat>
</D:response>
</D:multistatus>`;

/**
 * A listing of `Invoices` as Nextcloud answers it: `d:` for the namespace, the quotes of an ETag escaped, a size it
 * cannot give in a group of its own, and the id it keeps a file under.
 */
const NEXTCLOUD_LISTING: string = '<?xml version="1.0"?>\n'
    + '<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">'
    + `<d:response><d:href>${FILES_PATH}Invoices/</d:href>`
    + '<d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getetag>&quot;6745a1&quot;</d:getetag>'
    + '<d:getlastmodified>Wed, 25 Nov 2026 10:00:00 GMT</d:getlastmodified><oc:fileid>12</oc:fileid></d:prop>'
    + '<d:status>HTTP/1.1 200 OK</d:status></d:propstat>'
    + '<d:propstat><d:prop><d:getcontentlength/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>'
    // eslint-disable-next-line cspell/spellchecker
    + `<d:response><d:href>${FILES_PATH}Invoices/R%C3%BCckerstattung%20%231.pdf</d:href>`
    + '<d:propstat><d:prop><d:resourcetype/><d:getcontentlength>2048</d:getcontentlength><d:getetag>&quot;6745a2&quot;</d:getetag>'
    + '<d:getlastmodified>Thu, 26 Nov 2026 08:30:00 GMT</d:getlastmodified><oc:fileid>13</oc:fileid></d:prop>'
    + '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
    + '</d:multistatus>';

/**
 * What a PROPFIND of one file is answered with by Nextcloud.
 */
const NEXTCLOUD_FILE: string = '<?xml version="1.0"?>\n'
    + '<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">'
    + `<d:response><d:href>${FILES_PATH}Invoices/2026-001.pdf</d:href>`
    + '<d:propstat><d:prop><d:resourcetype/><d:getcontentlength>512</d:getcontentlength><d:getetag>&quot;e1&quot;</d:getetag>'
    + '<d:getlastmodified>Thu, 26 Nov 2026 08:30:00 GMT</d:getlastmodified></d:prop>'
    + '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
    + '</d:multistatus>';

/**
 * What a PROPFIND of one folder is answered with by Nextcloud.
 * @param path - The path of the folder, relative to the files of Ada.
 * @returns The answer.
 */
function nextcloudFolder(path: string): string {
    return '<?xml version="1.0"?>\n'
        + '<d:multistatus xmlns:d="DAV:">'
        + `<d:response><d:href>${FILES_PATH}${path}/</d:href>`
        + '<d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getetag>&quot;f1&quot;</d:getetag></d:prop>'
        + '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
        + '</d:multistatus>';
}

const XML_HEADERS: Record<string, string> = { 'content-type': 'application/xml; charset=utf-8' };

let server: Server;
let origin: string;
let answering: Answering = () => ({ status: HttpStatus.INTERNAL_SERVER_ERROR });
let received: ReceivedRequest[] = [];

/**
 * The client of the files of Ada on the server of this test.
 * @param attempts - How often a request is attempted.
 * @returns The client.
 */
function createClient(attempts?: number): WebDavClient {
    return new WebDavClient({
        connection: { url: `${origin}${FILES_PATH}`, username: USERNAME, password: PASSWORD },
        network: undefined,
        attempts
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

/**
 * Answers every request with what the test says.
 * @param request - The request.
 * @param response - The response.
 */
function handle(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
        const receivedRequest: ReceivedRequest = {
            method: request.method ?? '',
            url: request.url ?? '',
            headers: request.headers,
            body: Buffer.concat(chunks)
        };
        received.push(receivedRequest);
        const answer: Answer = answering(receivedRequest);
        if (answer.hangUp === true) {
            request.socket.destroy();
            return;
        }
        response.writeHead(answer.status, answer.headers);
        response.end(answer.body);
    });
}

beforeAll(async () => {
    // the errors of the http client carry translated messages, which an application not created refuses to build
    GlobalRegistry.markAppAsCreated();
    WebDavTestServerUtilities.initContainer();
    server = createServer(handle);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

beforeEach(() => {
    received = [];
});

describe('WebDavClient, listing a folder', () => {
    it('reads what Apache answers, without the folder itself', async () => {
        answering = () => ({ status: 207, headers: { 'content-type': 'text/xml; charset="utf-8"' }, body: APACHE_LISTING });

        const entries: WebDavEntry[] = await createClient().findEntries('Invoices');

        expect(entries).toEqual([
            {
                name: '2026 Q1.pdf',
                path: 'Invoices/2026 Q1.pdf',
                kind: 'file',
                size: 1024,
                etag: '"400-5f3b"',
                modifiedAt: new Date('2026-11-26T08:30:00Z'),
                properties: {}
            },
            {
                name: 'Archive',
                path: 'Invoices/Archive',
                kind: 'folder',
                size: undefined,
                etag: '"1000-5f3c"',
                modifiedAt: new Date('2026-11-02T12:00:00Z'),
                properties: {}
            }
        ]);
    });

    it('asks for one level of the folder, logged in', async () => {
        answering = () => ({ status: 207, headers: XML_HEADERS, body: NEXTCLOUD_LISTING });

        await createClient().findEntries('Invoices');

        expect(received.map(request => ({
            method: request.method,
            url: request.url,
            depth: request.headers['depth'],
            authorization: request.headers.authorization
        }))).toEqual([
            {
                method: 'PROPFIND',
                url: `${FILES_PATH}Invoices/`,
                depth: '1',
                authorization: `Basic ${Buffer.from(CREDENTIALS).toString('base64')}`
            }
        ]);
        expect(received[0]?.body.toString()).toContain('<d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/></d:prop>');
    });

    it('reads what Nextcloud answers, with the further properties asked for', async () => {
        answering = () => ({ status: 207, headers: XML_HEADERS, body: NEXTCLOUD_LISTING });

        const entries: WebDavEntry<'fileId'>[] = await createClient().findEntries('Invoices', {
            fileId: { namespace: OWNCLOUD_NAMESPACE, name: 'fileid' }
        });

        expect(entries).toEqual([
            {
                name: 'Rückerstattung #1.pdf',
                path: 'Invoices/Rückerstattung #1.pdf',
                kind: 'file',
                size: 2048,
                etag: '"6745a2"',
                modifiedAt: new Date('2026-11-26T08:30:00Z'),
                properties: { fileId: '13' }
            }
        ]);
        expect(received[0]?.body.toString()).toContain(`xmlns:p0="${OWNCLOUD_NAMESPACE}"`);
        expect(received[0]?.body.toString()).toContain('<p0:fileid/>');
    });

    it('reads a further property the server does not give as undefined', async () => {
        answering = () => ({ status: 207, headers: XML_HEADERS, body: NEXTCLOUD_LISTING });

        const entries: WebDavEntry<'favorite'>[] = await createClient().findEntries('Invoices', {
            favorite: { namespace: OWNCLOUD_NAMESPACE, name: 'favorite' }
        });

        expect(entries.map(entry => entry.properties)).toEqual([{ favorite: undefined }]);
    });

    it('reads a further property holding one element as the text of that element, such as the checksums of Nextcloud', async () => {
        answering = () => ({
            status: 207,
            headers: XML_HEADERS,
            body: '<?xml version="1.0"?>\n<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">'
                + `<d:response><d:href>${FILES_PATH}Invoices/2026-001.pdf</d:href><d:propstat><d:prop><d:resourcetype/>`
                + '<d:getetag>&quot;e1&quot;</d:getetag><oc:checksums><oc:checksum>SHA256:abc MD5:def</oc:checksum></oc:checksums></d:prop>'
                + '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'
        });

        const entry: WebDavEntry<'checksums'> | undefined = await createClient().findEntry('Invoices/2026-001.pdf', {
            checksums: { namespace: OWNCLOUD_NAMESPACE, name: 'checksums', child: 'checksum' }
        });

        expect(entry?.properties.checksums).toBe('SHA256:abc MD5:def');
        expect(received[0]?.body.toString()).toContain('checksums');
    });

    it('lists the folder of the connection for an empty path', async () => {
        answering = () => ({ status: 207, headers: XML_HEADERS, body: NEXTCLOUD_LISTING });

        await createClient().findEntries('');

        expect(received.map(request => request.url)).toEqual([FILES_PATH]);
    });

    it('encodes each segment of a path on its own', async () => {
        answering = () => ({ status: 207, headers: XML_HEADERS, body: nextcloudFolder('Kunden/A%26B%3F%20GmbH') });

        await createClient().findEntries('Kunden/A&B? GmbH');

        expect(received.map(request => request.url)).toEqual([`${FILES_PATH}Kunden/A%26B%3F%20GmbH/`]);
    });

    it('refuses a further property named like one every entry is read from', async () => {
        const error: unknown = await failureOf(createClient().findEntries('Invoices', { etag: { namespace: OWNCLOUD_NAMESPACE, name: 'getetag' } }));

        expect(error).toBeInstanceOf(InternalError);
        expect(received).toEqual([]);
    });

    it('refuses a path with an empty segment, without a request', async () => {
        const error: unknown = await failureOf(createClient().findEntries('/Invoices'));

        expect(error).toBeInstanceOf(InternalError);
        expect(received).toEqual([]);
    });

    it('refuses to list a file as a folder', async () => {
        answering = () => ({ status: 207, headers: XML_HEADERS, body: NEXTCLOUD_FILE });

        const error: unknown = await failureOf(createClient().findEntries('Invoices/2026-001.pdf'));

        expect(error).toBeInstanceOf(InternalError);
        expect(error).toMatchObject({ message: expect.stringContaining('is a file') });
    });

    it('refuses an answer for a resource outside the folder of the connection', async () => {
        answering = () => ({ status: 207, headers: XML_HEADERS, body: NEXTCLOUD_LISTING.replaceAll(FILES_PATH, '/remote.php/dav/files/grace/') });

        const error: unknown = await failureOf(createClient().findEntries('Invoices'));

        expect(error).toBeInstanceOf(InternalError);
        expect(error).toMatchObject({ message: expect.stringContaining('outside of it') });
    });

    it('throws a WebDavNotFoundError for a folder that does not exist', async () => {
        answering = () => ({ status: HttpStatus.NOT_FOUND });

        const error: unknown = await failureOf(createClient().findEntries('Invoices'));

        expect(error).toBeInstanceOf(WebDavNotFoundError);
        expect(error).toMatchObject({ path: 'Invoices', responseData: { status: HttpStatus.NOT_FOUND } });
    });
});

describe('WebDavClient, finding an entry', () => {
    it('finds a file by its path', async () => {
        answering = () => ({ status: 207, headers: XML_HEADERS, body: NEXTCLOUD_FILE });

        const entry: WebDavEntry | undefined = await createClient().findEntry('Invoices/2026-001.pdf');

        expect(entry).toEqual({
            name: '2026-001.pdf',
            path: 'Invoices/2026-001.pdf',
            kind: 'file',
            size: 512,
            etag: '"e1"',
            modifiedAt: new Date('2026-11-26T08:30:00Z'),
            properties: {}
        });
        expect(received.map(request => [request.method, request.url, request.headers['depth']]))
            .toEqual([['PROPFIND', `${FILES_PATH}Invoices/2026-001.pdf`, '0']]);
    });

    it('finds nothing where the server holds nothing', async () => {
        answering = () => ({ status: HttpStatus.NOT_FOUND });

        expect(await createClient().findEntry('Invoices/2026-002.pdf')).toBeUndefined();
    });

    it('throws a WebDavForbiddenError for a path it may not read', async () => {
        answering = () => ({ status: HttpStatus.FORBIDDEN });

        expect(await failureOf(createClient().findEntry('Invoices'))).toBeInstanceOf(WebDavForbiddenError);
    });

    it('throws the HttpClientError of a status it gives no type of its own', async () => {
        answering = () => ({ status: HttpStatus.UNAUTHORIZED });

        const error: unknown = await failureOf(createClient().findEntry('Invoices'));

        expect(error).toBeInstanceOf(HttpClientError);
        expect(error).toMatchObject({ name: 'HttpClientError', responseData: { status: HttpStatus.UNAUTHORIZED } });
    });
});

describe('WebDavClient, reading and writing a file', () => {
    it('reads a file with its ETag', async () => {
        answering = () => ({ status: HttpStatus.OK, headers: { 'content-type': 'application/pdf', etag: '"e1"' }, body: '%PDF-1.7' });

        const download: WebDavDownload = await createClient().get('Invoices/2026-001.pdf');

        expect(Buffer.concat(await download.content.toArray()).toString()).toBe('%PDF-1.7');
        expect(download.etag).toBe('"e1"');
    });

    it('throws a WebDavNotFoundError for a file that does not exist', async () => {
        answering = () => ({ status: HttpStatus.NOT_FOUND });

        expect(await failureOf(createClient().get('Invoices/2026-002.pdf'))).toBeInstanceOf(WebDavNotFoundError);
    });

    it('writes bytes under their content type and condition, and returns the ETag the server names', async () => {
        answering = () => ({ status: HttpStatus.CREATED, headers: { 'content-type': 'text/html', etag: '"e2"' }, body: '<html>Created</html>' });

        const etag: string | undefined = await createClient().put(
            'Invoices/2026-001.pdf',
            Buffer.from('%PDF-1.7'),
            { contentType: 'application/pdf', ifMatch: '"e1"' }
        );

        expect(etag).toBe('"e2"');
        expect(received.map(request => ({
            method: request.method,
            contentType: request.headers['content-type'],
            contentLength: request.headers['content-length'],
            ifMatch: request.headers['if-match'],
            ifNoneMatch: request.headers['if-none-match'],
            body: request.body.toString()
        }))).toEqual([
            {
                method: 'PUT',
                contentType: 'application/pdf',
                contentLength: '8',
                ifMatch: '"e1"',
                ifNoneMatch: undefined,
                body: '%PDF-1.7'
            }
        ]);
    });

    it('writes text only where there is no file', async () => {
        answering = () => ({ status: HttpStatus.CREATED });

        const etag: string | undefined = await createClient().put(
            'Calendar/task-1.ics',
            'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
            { contentType: 'text/calendar; charset=utf-8', ifNoneMatch: '*' }
        );

        expect(etag).toBeUndefined();
        expect(received.map(request => [request.headers['if-none-match'], request.headers['content-type'], request.body.toString()]))
            .toEqual([['*', 'text/calendar; charset=utf-8', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n']]);
    });

    it('throws a WebDavPreconditionFailedError for a condition that does not hold', async () => {
        answering = () => ({ status: HttpStatus.PRECONDITION_FAILED });

        const error: unknown = await failureOf(createClient().put('Invoices/2026-001.pdf', 'x', { contentType: 'text/plain', ifMatch: '"old"' }));

        expect(error).toBeInstanceOf(WebDavPreconditionFailedError);
        expect(error).toMatchObject({ path: 'Invoices/2026-001.pdf' });
    });

    // Nextcloud answers it with a 404 naming the folder, where RFC 4918 says 409: a put needs nothing at its own path
    it.each([HttpStatus.CONFLICT, HttpStatus.NOT_FOUND])('throws a WebDavConflictError for a file in a folder that does not exist, answered with %s', async status => {
        answering = () => ({ status });

        expect(await failureOf(createClient().put('Missing/2026-001.pdf', 'x', { contentType: 'text/plain', overwrite: true })))
            .toBeInstanceOf(WebDavConflictError);
    });

    it('sends a put under a condition once, whatever the attempts', async () => {
        answering = () => ({ status: HttpStatus.SERVICE_UNAVAILABLE });

        await failureOf(createClient(3).put('Invoices/2026-001.pdf', 'x', { contentType: 'text/plain', ifNoneMatch: '*' }));

        expect(received).toHaveLength(1);
    });

    it('sends a put that overwrites as often as the attempts allow', async () => {
        answering = () => received.length === 1 ? { status: HttpStatus.SERVICE_UNAVAILABLE } : { status: HttpStatus.NO_CONTENT };

        await createClient(3).put('Invoices/2026-001.pdf', 'x', { contentType: 'text/plain', overwrite: true });

        expect(received).toHaveLength(2);
    });

    it('takes exactly one condition', () => {
        // @ts-expect-error a put names one condition
        const both: WebDavPutOptions = { contentType: 'text/plain', ifMatch: '"e1"', ifNoneMatch: '*' };
        // @ts-expect-error a put names a condition
        const none: WebDavPutOptions = { contentType: 'text/plain' };

        expect([both, none]).toHaveLength(2);
    });
});

describe('WebDavClient, deleting and moving', () => {
    it('deletes a file the server answers with no body for', async () => {
        answering = () => ({ status: HttpStatus.NO_CONTENT });

        await createClient().delete('Invoices/2026-001.pdf');

        expect(received.map(request => [request.method, request.url])).toEqual([['DELETE', `${FILES_PATH}Invoices/2026-001.pdf`]]);
    });

    it('throws a WebDavForbiddenError for a delete it may not make', async () => {
        answering = () => ({ status: HttpStatus.FORBIDDEN });

        expect(await failureOf(createClient().delete('Shared/2026-001.pdf'))).toBeInstanceOf(WebDavForbiddenError);
    });

    it('moves to an absolute destination, saying whether it is replaced', async () => {
        answering = () => ({ status: HttpStatus.CREATED, headers: { 'content-type': 'text/html' }, body: '<html>Created</html>' });

        await createClient().move('Invoices/.2026-001.pdf.part', 'Invoices/2026-001.pdf', { overwrite: false });
        await createClient().move('Invoices/a.pdf', 'Archive/a.pdf', { overwrite: true });

        expect(received.map(request => [request.method, request.url, request.headers['destination'], request.headers['overwrite']])).toEqual([
            ['MOVE', `${FILES_PATH}Invoices/.2026-001.pdf.part`, `${origin}${FILES_PATH}Invoices/2026-001.pdf`, 'F'],
            ['MOVE', `${FILES_PATH}Invoices/a.pdf`, `${origin}${FILES_PATH}Archive/a.pdf`, 'T']
        ]);
    });

    it('names the source of a move that finds nothing, and the destination of one that is refused', async () => {
        answering = () => ({ status: HttpStatus.NOT_FOUND });
        const missing: unknown = await failureOf(createClient().move('Invoices/a.pdf', 'Archive/a.pdf', { overwrite: false }));
        answering = () => ({ status: HttpStatus.PRECONDITION_FAILED });
        const exists: unknown = await failureOf(createClient().move('Invoices/a.pdf', 'Archive/a.pdf', { overwrite: false }));
        answering = () => ({ status: HttpStatus.CONFLICT });
        const noFolder: unknown = await failureOf(createClient().move('Invoices/a.pdf', 'Archive/a.pdf', { overwrite: false }));

        expect(missing).toBeInstanceOf(WebDavNotFoundError);
        expect(missing).toMatchObject({ path: 'Invoices/a.pdf' });
        expect(exists).toBeInstanceOf(WebDavPreconditionFailedError);
        expect(exists).toMatchObject({ path: 'Archive/a.pdf' });
        expect(noFolder).toBeInstanceOf(WebDavConflictError);
        expect(noFolder).toMatchObject({ path: 'Archive/a.pdf' });
    });

    // Apache renames, and answers the folder that is not there with a 500 rather than a 409
    it('throws a WebDavConflictError for a move refused otherwise into a folder that does not exist', async () => {
        answering = request => request.method === 'MOVE' ? { status: HttpStatus.INTERNAL_SERVER_ERROR } : { status: HttpStatus.NOT_FOUND };

        const noFolder: unknown = await failureOf(createClient().move('Invoices/a.pdf', 'Archive/a.pdf', { overwrite: false }));

        expect(noFolder).toBeInstanceOf(WebDavConflictError);
        expect(noFolder).toMatchObject({ path: 'Archive/a.pdf' });
        expect(received.map(request => [request.method, request.url])).toEqual([
            ['MOVE', `${FILES_PATH}Invoices/a.pdf`],
            ['PROPFIND', `${FILES_PATH}Archive`]
        ]);
    });

    it('throws what a move was refused with where the folder it goes into exists', async () => {
        answering = request => request.method === 'MOVE'
            ? { status: HttpStatus.INTERNAL_SERVER_ERROR }
            : { status: 207, headers: XML_HEADERS, body: nextcloudFolder('Archive') };

        const refused: unknown = await failureOf(createClient().move('Invoices/a.pdf', 'Archive/a.pdf', { overwrite: false }));

        expect(refused).toBeInstanceOf(HttpClientError);
        expect(refused).not.toBeInstanceOf(WebDavConflictError);
    });
});

describe('WebDavClient, creating a folder', () => {
    it('creates a folder whose parent exists with one request', async () => {
        answering = () => ({ status: HttpStatus.CREATED });

        await createClient().createFolder('Customers/Ada/Invoices');

        expect(received.map(request => [request.method, request.url])).toEqual([['MKCOL', `${FILES_PATH}Customers/Ada/Invoices/`]]);
    });

    it('creates the folders above that do not exist, from the deepest up', async () => {
        const existing: Set<string> = new Set([FILES_PATH, `${FILES_PATH}Customers/`]);
        answering = request => {
            const parent: string = request.url.replace(/[^/]+\/$/, '');
            if (!existing.has(parent)) {
                return { status: HttpStatus.CONFLICT };
            }
            existing.add(request.url);
            return { status: HttpStatus.CREATED };
        };

        await createClient().createFolder('Customers/Ada/Invoices/2026');

        expect(received.map(request => request.url.slice(FILES_PATH.length))).toEqual([
            'Customers/Ada/Invoices/2026/',
            'Customers/Ada/Invoices/',
            'Customers/Ada/',
            'Customers/Ada/Invoices/',
            'Customers/Ada/Invoices/2026/'
        ]);
    });

    it('leaves a folder that exists as it is', async () => {
        answering = request => request.method === 'MKCOL'
            ? { status: HttpStatus.METHOD_NOT_ALLOWED }
            : { status: 207, headers: XML_HEADERS, body: nextcloudFolder('Invoices') };

        await createClient().createFolder('Invoices');

        expect(received.map(request => request.method)).toEqual(['MKCOL', 'PROPFIND']);
    });

    // Apache answers a folder another request created between its check and its own with a 403
    it('leaves a folder that exists as it is, whatever the server refused it with', async () => {
        answering = request => request.method === 'MKCOL'
            ? { status: HttpStatus.FORBIDDEN }
            : { status: 207, headers: XML_HEADERS, body: nextcloudFolder('Invoices') };

        await createClient().createFolder('Invoices');

        expect(received.map(request => request.method)).toEqual(['MKCOL', 'PROPFIND']);
    });

    it.each([HttpStatus.METHOD_NOT_ALLOWED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST])(
        'throws a WebDavConflictError where a file is, refused with %s',
        async status => {
            answering = request => request.method === 'MKCOL'
                ? { status }
                : { status: 207, headers: XML_HEADERS, body: NEXTCLOUD_FILE };

            expect(await failureOf(createClient().createFolder('Invoices/2026-001.pdf'))).toBeInstanceOf(WebDavConflictError);
        }
    );

    // the puts of a backup into one new folder each created it, which Nextcloud answered all but one of with a 423
    it('creates a folder several calls of one client create at once with one request', async () => {
        answering = () => ({ status: HttpStatus.CREATED });
        const client: WebDavClient = createClient();

        await Promise.all(Array.from({ length: 8 }, async () => await client.createFolder('Invoices')));

        expect(received.map(request => [request.method, request.url])).toEqual([['MKCOL', `${FILES_PATH}Invoices/`]]);
    });

    it('creates a folder the server holds locked while another instance creates it, once the lock is gone', async () => {
        let locked: number = 2;
        answering = () => locked-- > 0 ? { status: HttpStatus.LOCKED } : { status: HttpStatus.CREATED };

        await createClient().createFolder('Invoices');

        expect(received.map(request => request.method)).toEqual(['MKCOL', 'MKCOL', 'MKCOL']);
    });

    it('throws the 423 of a folder the server holds locked for good, after a few attempts', async () => {
        answering = request => request.method === 'MKCOL' ? { status: HttpStatus.LOCKED } : { status: HttpStatus.NOT_FOUND };

        const refused: unknown = await failureOf(createClient().createFolder('Invoices'));

        expect(refused).toBeInstanceOf(HttpClientError);
        expect(refused).toMatchObject({ responseData: { status: HttpStatus.LOCKED } });
        expect(received.map(request => request.method)).toEqual(['MKCOL', 'MKCOL', 'MKCOL', 'MKCOL', 'MKCOL', 'PROPFIND']);
    });

    it('throws what a folder was refused with where nothing is', async () => {
        answering = request => request.method === 'MKCOL' ? { status: HttpStatus.FORBIDDEN } : { status: HttpStatus.NOT_FOUND };

        expect(await failureOf(createClient().createFolder('Shared'))).toBeInstanceOf(WebDavForbiddenError);
    });

    it('throws a WebDavConflictError when the folder of the connection does not exist', async () => {
        answering = () => ({ status: HttpStatus.CONFLICT });

        expect(await failureOf(createClient().createFolder('Invoices'))).toBeInstanceOf(WebDavConflictError);
        expect(received).toHaveLength(1);
    });
});

// Nextcloud answers a write a 423 while another request holds the folder it is in, such as the MKCOL of a folder beside
// it: the puts of a backup into new folders, at once, failed with it
describe('WebDavClient, while the server holds a folder locked', () => {
    it('writes a file once the lock is gone, under its condition', async () => {
        let locked: number = 2;
        answering = () => locked-- > 0 ? { status: HttpStatus.LOCKED } : { status: HttpStatus.CREATED, headers: { etag: '"e2"' } };

        const etag: string | undefined = await createClient().put(
            'Invoices/2026-001.pdf',
            Buffer.from('%PDF-1.7'),
            { contentType: 'application/pdf', ifMatch: '"e1"' }
        );

        expect(etag).toBe('"e2"');
        expect(received.map(request => [request.method, request.headers['if-match']])).toEqual([
            ['PUT', '"e1"'],
            ['PUT', '"e1"'],
            ['PUT', '"e1"']
        ]);
    });

    it('moves a file once the lock is gone', async () => {
        let locked: number = 2;
        answering = () => locked-- > 0 ? { status: HttpStatus.LOCKED } : { status: HttpStatus.CREATED };

        await createClient().move('Invoices/.upload', 'Invoices/2026-001.pdf', { overwrite: true });

        expect(received.map(request => request.method)).toEqual(['MOVE', 'MOVE', 'MOVE']);
    });

    it('deletes a file once the lock is gone', async () => {
        let locked: number = 2;
        answering = () => locked-- > 0 ? { status: HttpStatus.LOCKED } : { status: HttpStatus.NO_CONTENT };

        await createClient().delete('Invoices/2026-001.pdf');

        expect(received.map(request => request.method)).toEqual(['DELETE', 'DELETE', 'DELETE']);
    });

    it('throws the 423 of a file the server holds locked for good, after a few attempts', async () => {
        answering = () => ({ status: HttpStatus.LOCKED });

        const refused: unknown = await failureOf(createClient().put('Invoices/2026-001.pdf', 'text', { contentType: 'text/plain', overwrite: true }));

        expect(refused).toBeInstanceOf(HttpClientError);
        expect(refused).toMatchObject({ responseData: { status: HttpStatus.LOCKED } });
        expect(received.map(request => request.method)).toEqual(['PUT', 'PUT', 'PUT', 'PUT', 'PUT']);
    });
});

// Apache closed a connection it kept alive as a MOVE arrived on it, among the puts of a backup at once. The http client
// repeats no MOVE, as one repeated after its answer got lost fails on what the first one did, so what is at both paths
// says whether it was carried out
describe('WebDavClient, moving without an answer', () => {
    const SOURCE: string = 'Invoices/.upload-1';
    const DESTINATION: string = 'Invoices/2026-001.pdf';

    /**
     * Answers a PROPFIND of one path as Nextcloud does, with a file there or with nothing.
     * @param request - The request.
     * @param present - The paths a file is at.
     * @returns The answer.
     */
    function propfindOf(request: ReceivedRequest, present: string[]): Answer {
        const path: string | undefined = present.find(candidate => request.url === `${FILES_PATH}${candidate}`);
        return path == undefined
            ? { status: HttpStatus.NOT_FOUND }
            : { status: 207, headers: XML_HEADERS, body: NEXTCLOUD_FILE.replace('Invoices/2026-001.pdf', path) };
    }

    it('sends the move again where the file is still at its source', async () => {
        let moves: number = 0;
        answering = request => request.method === 'MOVE'
            ? moves++ === 0 ? { status: HttpStatus.CREATED, hangUp: true } : { status: HttpStatus.CREATED }
            : propfindOf(request, [SOURCE]);

        await createClient().move(SOURCE, DESTINATION, { overwrite: true });

        expect(received.map(request => request.method)).toEqual(['MOVE', 'PROPFIND', 'MOVE']);
    });

    it('takes the move as done where the file is at its destination and gone from its source', async () => {
        answering = request => request.method === 'MOVE' ? { status: HttpStatus.CREATED, hangUp: true } : propfindOf(request, [DESTINATION]);

        await createClient().move(SOURCE, DESTINATION, { overwrite: true });

        expect(received.map(request => request.method)).toEqual(['MOVE', 'PROPFIND', 'PROPFIND']);
    });

    it('throws that it got no answer where the file is at neither path', async () => {
        answering = request => request.method === 'MOVE' ? { status: HttpStatus.CREATED, hangUp: true } : propfindOf(request, []);

        const refused: unknown = await failureOf(createClient().move(SOURCE, DESTINATION, { overwrite: true }));

        expect(refused).toBeInstanceOf(HttpClientError);
        expect(refused).toMatchObject({ responseData: undefined });
        expect(received.map(request => request.method)).toEqual(['MOVE', 'PROPFIND', 'PROPFIND']);
    });
});

describe('WebDavClient of a tenant', () => {
    afterAll(() => {
        WebDavTestServerUtilities.initContainer();
    });

    it('refuses a server over plain http, without a request', async () => {
        WebDavTestServerUtilities.initContainer({ allowedHosts: undefined, allowPrivateNetworks: false });
        const client: WebDavClient = WebDavClient.createForTenant({ url: `${origin}${FILES_PATH}`, username: USERNAME, password: PASSWORD });

        const error: unknown = await failureOf(client.findEntries('Invoices'));

        expect(error).toBeInstanceOf(InternalError);
        expect(error).toMatchObject({ message: expect.stringContaining('needs to be reached over https') });
        expect(received).toEqual([]);
    });

    it('refuses a server at a private address, without a request', async () => {
        WebDavTestServerUtilities.initContainer({ allowedHosts: undefined, allowPrivateNetworks: false });
        const client: WebDavClient = WebDavClient.createForTenant({ url: `https://10.0.0.5${FILES_PATH}`, username: USERNAME, password: PASSWORD });

        const error: unknown = await failureOf(client.findEntries('Invoices'));

        expect(error).toBeInstanceOf(InternalError);
        expect(error).toMatchObject({ message: expect.stringContaining('public addresses') });
    });

    it('reaches a server at a private address where private networks are allowed', async () => {
        WebDavTestServerUtilities.initContainer({ allowedHosts: undefined, allowPrivateNetworks: true });
        answering = () => ({ status: 207, headers: XML_HEADERS, body: NEXTCLOUD_LISTING });
        const client: WebDavClient = WebDavClient.createForTenant({ url: `${origin}${FILES_PATH}`, username: USERNAME, password: PASSWORD });

        expect(await client.findEntries('Invoices')).toHaveLength(1);
    });

    it('refuses a host the allowed hosts do not name', async () => {
        WebDavTestServerUtilities.initContainer({ allowedHosts: ['cloud.example.com'], allowPrivateNetworks: true });
        const client: WebDavClient = WebDavClient.createForTenant({ url: `${origin}${FILES_PATH}`, username: USERNAME, password: PASSWORD });

        expect(await failureOf(client.findEntries('Invoices'))).toBeInstanceOf(InternalError);
        expect(received).toEqual([]);
    });

    it('follows no redirect to a host the allowed hosts do not name', async () => {
        WebDavTestServerUtilities.initContainer({ allowedHosts: ['127.0.0.1'], allowPrivateNetworks: true });
        answering = request => request.url.startsWith(FILES_PATH)
            ? { status: HttpStatus.TEMPORARY_REDIRECT, headers: { location: `${origin.replace('127.0.0.1', 'localhost')}/elsewhere/` } }
            : { status: 207, headers: XML_HEADERS, body: NEXTCLOUD_LISTING };
        const client: WebDavClient = WebDavClient.createForTenant({ url: `${origin}${FILES_PATH}`, username: USERNAME, password: PASSWORD });

        const error: unknown = await failureOf(client.findEntries('Invoices'));

        expect(error).toBeInstanceOf(HttpClientError);
        expect(error).toMatchObject({ message: expect.stringContaining('which is not followed') });
        expect(received).toHaveLength(1);
    });
});

describe('WebDavMethod', () => {
    it('is no method a route or the open api can be declared with', () => {
        // @ts-expect-error a method of WebDAV is no HttpMethod
        const method: HttpMethod = WebDavMethod.PROPFIND;
        // @ts-expect-error express and the open api know no method of WebDAV
        const key: string = httpMethodKey(WebDavMethod.MKCOL);

        expect([method, key]).toEqual(['PROPFIND', 'mkcol']);
    });
});