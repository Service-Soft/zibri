import { createHash } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { WebDavConnection } from '../../web-dav/web-dav-connection.model';

/**
 * The path every path of the server is below, as Nextcloud's `remote.php/dav`.
 */
const DAV_PATH: string = '/remote.php/dav/';

/**
 * The content type of an answer in xml, as Nextcloud names it.
 */
const XML_CONTENT_TYPE: string = 'application/xml; charset=utf-8';

/**
 * The path of the share api, as Nextcloud's.
 */
const SHARES_PATH: string = '/ocs/v2.php/apps/files_sharing/api/v1/shares';

/**
 * What the share api numbers a share with a user, with a group and by link as.
 */
const USER_SHARE_TYPE: number = 0;
const GROUP_SHARE_TYPE: number = 1;
const LINK_SHARE_TYPE: number = 3;

/**
 * How a response of a multistatus ends that found what it names.
 */
const PROPSTAT_OK_END: string = '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';

/**
 * A file the server stores: what was put, the ETag of that version, the id it keeps when it is moved, and when it was
 * written.
 */
export type InProcessWebDavFile = {
    /**
     * What the file holds, as it was put.
     */
    content: Buffer,
    /**
     * The ETag of this version, quotes included.
     */
    etag: string,
    /**
     * The id the file keeps when it is moved, as Nextcloud's `oc:fileid`.
     */
    fileId: string,
    /**
     * When this version was written, which a listing names as `getlastmodified`, to the second.
     */
    modifiedAt: Date,
    /**
     * The checksum the put that wrote this version named in `OC-Checksum`, as Nextcloud's `oc:checksums`, or undefined
     * for a version written without one.
     */
    checksum: string | undefined
};

/**
 * A share the server keeps, by link or with a user or a group, as Nextcloud's share api answers it.
 */
export type InProcessWebDavShare = {
    /**
     * The id of the share.
     */
    id: string,
    /**
     * Who it is for, as Nextcloud numbers it: 0 a user, 1 a group, 3 a link, 4 an email.
     */
    shareType: number,
    /**
     * The user or the group of a share with one.
     */
    shareWith: string | undefined,
    /**
     * The path within the files of the user, as the share api takes it, such as `/Customers/Ada`.
     */
    path: string,
    /**
     * The address of a link.
     */
    url: string | undefined,
    /**
     * The password the link asks for, if any.
     */
    password: string | undefined,
    /**
     * The day it expires on, if any.
     */
    expiresOn: string | undefined,
    /**
     * The permissions it was created with.
     */
    permissions: number
};

/**
 * A file or a folder the trash bin of the user keeps, as Nextcloud's trash bin names it.
 */
export type InProcessWebDavTrashed = {
    /**
     * Where it was, relative to the files of the user, such as `Backups/chunk`.
     */
    originalLocation: string,
    /**
     * Whether it is a file or a folder.
     */
    kind: 'file' | 'folder',
    /**
     * How many bytes a file held.
     */
    size: number | undefined,
    /**
     * When it was deleted, in seconds since 1970.
     */
    deletedAt: number
};

/**
 * A request the server received, by its method and its path below `remote.php/dav/`, decoded, or below the origin
 * for one to the share api.
 */
export type InProcessWebDavRequest = {
    /**
     * The method.
     */
    method: string,
    /**
     * The path, decoded.
     */
    path: string,
    /**
     * The `if-match` header, if any.
     */
    ifMatch: string | undefined,
    /**
     * The `if-none-match` header, if any.
     */
    ifNoneMatch: string | undefined
};

/**
 * A WebDAV server in the test's process, answering as Nextcloud does, for the suites that check what the calendar
 * sync, the file mirror, the backup transports and the Nextcloud client do where no container runs. It keeps its
 * folders and files in memory, logs in one user with a password, and answers below `remote.php/dav/`: a put, a get, a
 * delete, a MKCOL and a MOVE under their conditions as RFC 4918 and RFC 7232 say, a PROPFIND of depth 0 or 1 naming the
 * ETag, the size, the `oc:fileid` and the time it was written of each file, and a SEARCH for a file by its id. A file or a folder deleted among
 * the files of the user goes to the trash bin of the user, which `trashbin/<user>/trash/` lists and deletes from.
 * Beside it, the share api of Nextcloud creates a share by link or with a user or a group, lists the shares of a path,
 * and reads, changes and deletes one by its id.
 *
 * A calendar is a folder, and an event a file in it. What a user does in the folder or a calendar app is `edit`,
 * `move`, `addShare` and `deleteShare`, a server that is down `down`, and one failing part way `interruptedPuts` and
 * `refusedMoves`.
 */
export class InProcessWebDavServer {
    /**
     * The files, by their paths below `remote.php/dav/`.
     */
    readonly files: Map<string, InProcessWebDavFile> = new Map();

    /**
     * The shares, by their ids.
     */
    readonly shares: Map<string, InProcessWebDavShare> = new Map();

    /**
     * What the trash bin of the user keeps, by the name it keeps each under, such as `chunk.d1764160000`.
     */
    readonly trashBin: Map<string, InProcessWebDavTrashed> = new Map();

    /**
     * Every request, in the order it came in.
     */
    readonly requests: InProcessWebDavRequest[] = [];

    /**
     * Whether it answers every request with `503 Service Unavailable`, as a server that is down behind its proxy.
     */
    down: boolean = false;

    /**
     * Whether a put is answered with the ETag of what it wrote. Apache, and a server changing what it stores, name
     * none.
     */
    namesEtagOnPut: boolean = true;

    /**
     * How many of the next puts the server cuts off while their body arrives, storing nothing of them, as a
     * connection that breaks halfway.
     */
    interruptedPuts: number = 0;

    /**
     * How many of the next moves the server answers with `500 Internal Server Error`, moving nothing, as a storage
     * that fails.
     */
    refusedMoves: number = 0;

    /**
     * How many of the next moves the server refuses as a folder another request holds locked, moving nothing: with a
     * `500` naming `OCP\Lock\LockedException`, as Nextcloud answers a move rather than with a `423`.
     */
    lockedMoves: number = 0;

    /**
     * The folders, by their paths below `remote.php/dav/` without a slash at the end, with the ids they keep. The
     * root is `''`.
     */
    private readonly folders: Map<string, string> = new Map([['', '1']]);

    /**
     * How many versions, ids and shares were written, which each is made unique by.
     */
    private counter: number = 1;

    private readonly server: Server;

    private origin: string = '';

    constructor(
        private readonly username: string,
        private readonly password: string
    ) {
        this.server = createServer((request, response) => this.handle(request, response));
    }

    /**
     * The connection of the user, at `remote.php/dav/` as Nextcloud's.
     * @returns The connection.
     */
    get connection(): WebDavConnection {
        return { url: `${this.origin}${DAV_PATH}`, username: this.username, password: this.password };
    }

    /**
     * Starts listening on a free port of localhost.
     */
    async start(): Promise<void> {
        await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
        this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    }

    /**
     * Stops listening.
     */
    async stop(): Promise<void> {
        this.server.closeAllConnections();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }

    /**
     * Creates a folder with the folders above it, such as a calendar, as a user does in a calendar app.
     * @param path - Its path below `remote.php/dav/`, such as `calendars/ada/projects`.
     */
    createFolder(path: string): void {
        const segments: string[] = path.split('/').filter(segment => segment !== '');
        for (let index: number = 1; index <= segments.length; index++) {
            const folder: string = segments.slice(0, index).join('/');
            if (!this.folders.has(folder)) {
                this.folders.set(folder, this.nextId());
            }
        }
    }

    /**
     * Changes a file, as a user does in the folder or a calendar app, which gives it a new ETag and, as through the
     * web interface of Nextcloud, no checksum.
     * @param path - Its path below `remote.php/dav/`.
     * @param content - What it holds now.
     * @param modifiedAt - When it was changed, now by default, such as a day ago for what a process left behind then.
     */
    edit(path: string, content: string | Buffer, modifiedAt: Date = new Date()): void {
        const bytes: Buffer = Buffer.from(content);
        this.files.set(path, {
            content: bytes,
            etag: this.resolveEtag(bytes),
            fileId: this.files.get(path)?.fileId ?? this.nextId(),
            modifiedAt,
            checksum: undefined
        });
    }

    /**
     * Changes a file in the second it was written in, as Nextcloud keeps its ETag then: what a client can tell the
     * change by is the checksum, which a change through the web interface leaves the file without.
     * @param path - Its path below `remote.php/dav/`.
     * @param content - What it holds now.
     * @throws When there is no file at the path.
     */
    editKeepingEtag(path: string, content: string | Buffer): void {
        const file: InProcessWebDavFile | undefined = this.files.get(path);
        if (file == undefined) {
            throw new Error(`There is no file at "${path}" to change.`);
        }
        this.files.set(path, { ...file, content: Buffer.from(content), checksum: undefined });
    }

    /**
     * Moves or renames a file or a folder, as a user does in the folder, which keeps its id and its ETag.
     * @param from - Its path below `remote.php/dav/`.
     * @param to - Where it goes. The folder it goes into exists.
     */
    move(from: string, to: string): void {
        const file: InProcessWebDavFile | undefined = this.files.get(from);
        if (file != undefined) {
            this.files.delete(from);
            this.files.set(to, file);
            return;
        }
        for (const [path, id] of this.folders) {
            if (path === from || path.startsWith(`${from}/`)) {
                this.folders.delete(path);
                this.folders.set(`${to}${path.slice(from.length)}`, id);
            }
        }
        for (const [path, moved] of this.files) {
            if (path.startsWith(`${from}/`)) {
                this.files.delete(path);
                this.files.set(`${to}${path.slice(from.length)}`, moved);
            }
        }
    }

    /**
     * Shares a file or a folder of the user, as a user does in Nextcloud.
     * @param share - The share, without its id.
     * @returns The id of the share.
     */
    addShare(share: Omit<InProcessWebDavShare, 'id'>): string {
        const id: string = this.nextId();
        this.shares.set(id, { ...share, id });
        return id;
    }

    /**
     * Deletes a share, as a user does in Nextcloud.
     * @param id - The id of the share.
     */
    deleteShare(id: string): void {
        this.shares.delete(id);
    }

    /**
     * Finds the files of a folder, and of the folders below it.
     * @param folder - Its path below `remote.php/dav/`.
     * @returns The paths of its files, sorted.
     */
    findFilePaths(folder: string): string[] {
        return [...this.files.keys()].filter(path => path.startsWith(`${folder}/`)).sort();
    }

    /**
     * Finds the folders below a folder, at any depth.
     * @param folder - Its path below `remote.php/dav/`.
     * @returns Their paths, sorted.
     */
    findFolderPaths(folder: string): string[] {
        return [...this.folders.keys()].filter(path => path.startsWith(`${folder}/`)).sort();
    }

    private handle(request: IncomingMessage, response: ServerResponse): void {
        const chunks: Buffer[] = [];
        let interrupted: boolean = false;
        request.on('data', (chunk: Buffer) => {
            if (request.method === 'PUT' && !interrupted && this.interruptedPuts > 0) {
                // once part of the body arrived, before the server stored any of it
                interrupted = true;
                this.interruptedPuts--;
                request.socket.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (interrupted) {
                return;
            }
            const url: URL = new URL(request.url ?? '/', this.origin);
            const isDav: boolean = `${url.pathname}/`.startsWith(DAV_PATH);
            const path: string = isDav ? decodeURIComponent(url.pathname.slice(DAV_PATH.length)) : url.pathname.slice(1);
            const header: (name: string) => string | undefined = name => {
                const value: string | string[] | undefined = request.headers[name];
                return Array.isArray(value) ? value.join(', ') : value;
            };
            this.requests.push({ method: request.method ?? '', path, ifMatch: header('if-match'), ifNoneMatch: header('if-none-match') });
            const credentials: string = `${this.username}:${this.password}`;
            const expected: string = `Basic ${Buffer.from(credentials).toString('base64')}`;
            if (this.down) {
                this.answer(response, 503);
                return;
            }
            if (header('authorization') !== expected) {
                this.answer(response, 401);
                return;
            }
            const body: Buffer = Buffer.concat(chunks);
            if (!isDav) {
                this.handleShares(request, response, url, header('ocs-apirequest'), body);
                return;
            }
            const trimmed: string = path.replace(/\/+$/, '');
            if (trimmed === this.trashBinPath || trimmed.startsWith(`${this.trashBinPath}/`)) {
                this.handleTrashBin(request.method ?? '', response, trimmed);
                return;
            }
            this.handleDav(request.method ?? '', response, trimmed, header, body);
        });
    }

    /**
     * The path of the trash bin of the user below `remote.php/dav/`.
     * @returns The path.
     */
    private get trashBinPath(): string {
        return `trashbin/${this.username}/trash`;
    }

    private handleDav(
        method: string,
        response: ServerResponse,
        path: string,
        header: (name: string) => string | undefined,
        body: Buffer
    ): void {
        switch (method) {
            case 'PUT': {
                this.put(response, path, body, header('if-match'), header('if-none-match'), header('oc-checksum'));
                return;
            }
            case 'GET': {
                const file: InProcessWebDavFile | undefined = this.files.get(path);
                if (file == undefined) {
                    this.answer(response, 404);
                    return;
                }
                response.writeHead(200, { 'content-type': 'application/octet-stream', etag: file.etag });
                response.end(file.content);
                return;
            }
            case 'DELETE': {
                this.delete(response, path);
                return;
            }
            case 'MKCOL': {
                this.createFolderOf(response, path);
                return;
            }
            case 'PROPFIND': {
                this.propfind(response, path, header('depth') === '1');
                return;
            }
            case 'SEARCH': {
                this.search(response, body.toString('utf8'));
                return;
            }
            case 'MOVE': {
                if (this.refusedMoves > 0) {
                    this.refusedMoves--;
                    this.answer(response, 500);
                    return;
                }
                if (this.lockedMoves > 0) {
                    this.lockedMoves--;
                    response.writeHead(500, { 'content-type': XML_CONTENT_TYPE });
                    response.end('<?xml version="1.0" encoding="utf-8"?>\n'
                        + '<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">'
                        + '<s:exception>OCP\\Lock\\LockedException</s:exception>'
                        + `<s:message>"${path}" is locked, existing lock on file: none</s:message></d:error>`);
                    return;
                }
                this.moveTo(response, path, header('destination'), header('overwrite') !== 'F');
                return;
            }
            default: {
                this.answer(response, 405);
            }
        }
    }

    private put(
        response: ServerResponse,
        path: string,
        content: Buffer,
        ifMatch: string | undefined,
        ifNoneMatch: string | undefined,
        checksum: string | undefined
    ): void {
        const existing: InProcessWebDavFile | undefined = this.files.get(path);
        // RFC 7232, section 3: an If-Match of no current version fails as well, and If-None-Match: * of any. Read
        // before the folder, as Nextcloud does
        if ((ifMatch != undefined && existing?.etag !== ifMatch) || (ifNoneMatch === '*' && existing != undefined)) {
            this.answer(response, 412);
            return;
        }
        if (!this.folders.has(this.parentOf(path)) || this.folders.has(path)) {
            this.answer(response, 409);
            return;
        }
        const etag: string = this.resolveEtag(content);
        // a put naming no checksum leaves the version without one, as Nextcloud clears the one before
        this.files.set(path, { content, etag, fileId: existing?.fileId ?? this.nextId(), modifiedAt: new Date(), checksum });
        response.writeHead(existing == undefined ? 201 : 204, this.namesEtagOnPut ? { etag } : {});
        response.end();
    }

    private delete(response: ServerResponse, path: string): void {
        const file: InProcessWebDavFile | undefined = this.files.get(path);
        if (file != undefined) {
            this.files.delete(path);
            this.keepInTrashBin(path, 'file', file.content.length);
            this.answer(response, 204);
            return;
        }
        if (path === '' || !this.folders.has(path)) {
            this.answer(response, 404);
            return;
        }
        for (const folder of this.folders.keys()) {
            if (folder === path || folder.startsWith(`${path}/`)) {
                this.folders.delete(folder);
            }
        }
        for (const inside of this.files.keys()) {
            if (inside.startsWith(`${path}/`)) {
                this.files.delete(inside);
            }
        }
        this.keepInTrashBin(path, 'folder', undefined);
        this.answer(response, 204);
    }

    /**
     * Keeps what was deleted among the files of the user in the trash bin, as Nextcloud does: a folder as one, with
     * what it held.
     * @param path - Where it was, below `remote.php/dav/`.
     * @param kind - Whether it is a file or a folder.
     * @param size - How many bytes a file held.
     */
    private keepInTrashBin(path: string, kind: 'file' | 'folder', size: number | undefined): void {
        const filesOfUser: string = `files/${this.username}/`;
        if (!path.startsWith(filesOfUser)) {
            return;
        }
        const name: string = path.split('/').at(-1) ?? '';
        // the name and the second it was deleted in, as Nextcloud names it, a later second for one of the same name
        let deletedAt: number = Math.floor(Date.now() / 1000);
        while (this.trashBin.has(`${name}.d${deletedAt}`)) {
            deletedAt++;
        }
        this.trashBin.set(`${name}.d${deletedAt}`, { originalLocation: path.slice(filesOfUser.length), kind, size, deletedAt });
    }

    private handleTrashBin(method: string, response: ServerResponse, path: string): void {
        const name: string | undefined = path === this.trashBinPath ? undefined : path.slice(this.trashBinPath.length + 1);
        if (method === 'PROPFIND' && name == undefined) {
            const responses: string = [
                `<d:response><d:href>${DAV_PATH}${this.trashBinPath}/</d:href><d:propstat><d:prop>`
                + '<d:resourcetype><d:collection/></d:resourcetype></d:prop>'
                + PROPSTAT_OK_END,
                ...[...this.trashBin].map(([trashed, entry]) => {
                    const href: string = `${DAV_PATH}${this.trashBinPath}/${encodeURIComponent(trashed)}`
                        + (entry.kind === 'folder' ? '/' : '');
                    const resourceType: string = entry.kind === 'folder'
                        ? '<d:resourcetype><d:collection/></d:resourcetype>'
                        : `<d:resourcetype/><d:getcontentlength>${entry.size ?? 0}</d:getcontentlength>`;
                    const props: string = resourceType
                        + `<nc:trashbin-filename>${this.escape(entry.originalLocation.split('/').at(-1) ?? '')}</nc:trashbin-filename>`
                        + `<nc:trashbin-original-location>${this.escape(entry.originalLocation)}</nc:trashbin-original-location>`
                        + `<nc:trashbin-deletion-time>${entry.deletedAt}</nc:trashbin-deletion-time>`;
                    return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop>`
                        + PROPSTAT_OK_END;
                })
            ].join('');
            response.writeHead(207, { 'content-type': XML_CONTENT_TYPE });
            response.end(`<?xml version="1.0"?>\n<d:multistatus xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">${responses}</d:multistatus>`);
            return;
        }
        if (method === 'DELETE' && name != undefined) {
            this.answer(response, this.trashBin.delete(name) ? 204 : 404);
            return;
        }
        this.answer(response, 405);
    }

    private moveTo(response: ServerResponse, path: string, destination: string | undefined, overwrite: boolean): void {
        const to: string = decodeURIComponent(new URL(destination ?? '', this.origin).pathname.slice(DAV_PATH.length)).replace(/\/+$/, '');
        if (!this.files.has(path) && (path === '' || !this.folders.has(path))) {
            this.answer(response, 404);
            return;
        }
        if (!this.folders.has(this.parentOf(to))) {
            this.answer(response, 409);
            return;
        }
        const exists: boolean = this.files.has(to) || this.folders.has(to);
        if (exists && !overwrite) {
            this.answer(response, 412);
            return;
        }
        this.files.delete(to);
        this.move(path, to);
        this.answer(response, exists ? 204 : 201);
    }

    private createFolderOf(response: ServerResponse, path: string): void {
        if (this.folders.has(path) || this.files.has(path)) {
            this.answer(response, 405);
            return;
        }
        if (!this.folders.has(this.parentOf(path))) {
            this.answer(response, 409);
            return;
        }
        this.folders.set(path, this.nextId());
        this.answer(response, 201);
    }

    private propfind(response: ServerResponse, path: string, withChildren: boolean): void {
        const isFile: boolean = this.files.has(path);
        if (!isFile && !this.folders.has(path)) {
            this.answer(response, 404);
            return;
        }
        const children: string[] = isFile || !withChildren
            ? []
            : [...this.folders.keys(), ...this.files.keys()]
                .filter(candidate => candidate !== '' && candidate !== path && this.parentOf(candidate) === path);
        this.answerMultistatus(response, [path, ...children]);
    }

    private search(response: ServerResponse, body: string): void {
        // the scope as Nextcloud reads it, a path relative to the WebDAV root, and the id the search is for
        const scope: string = (/<d:href>([^<]*)<\/d:href>/.exec(body)?.[1] ?? '').replaceAll(/^\/+|\/+$/g, '');
        const fileId: string | undefined = /<d:literal>(\d+)<\/d:literal>/.exec(body)?.[1];
        const found: string[] = [...this.files].filter(([path, file]) => file.fileId === fileId && path.startsWith(`${scope}/`))
            .map(([path]) => path);
        this.answerMultistatus(response, found);
    }

    private answerMultistatus(response: ServerResponse, paths: string[]): void {
        const responses: string = paths.map(path => {
            const file: InProcessWebDavFile | undefined = this.files.get(path);
            const href: string = `${DAV_PATH}${path.split('/').map(segment => encodeURIComponent(segment))
                .join('/')}${file == undefined && path !== '' ? '/' : ''}`;
            const props: string = file == undefined
                ? `<d:resourcetype><d:collection/></d:resourcetype><oc:fileid>${this.folders.get(path) ?? ''}</oc:fileid>`
                : `<d:resourcetype/><d:getetag>${file.etag.replaceAll('"', '&quot;')}</d:getetag>`
                    + `<d:getcontentlength>${file.content.length}</d:getcontentlength><oc:fileid>${file.fileId}</oc:fileid>`
                    + `<d:getlastmodified>${file.modifiedAt.toUTCString()}</d:getlastmodified>`
                    + `<oc:checksums><oc:checksum>${file.checksum ?? ''}</oc:checksum></oc:checksums>`;
            return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop>`
                + PROPSTAT_OK_END;
        }).join('');
        response.writeHead(207, { 'content-type': XML_CONTENT_TYPE });
        response.end(`<?xml version="1.0"?>\n<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">${responses}</d:multistatus>`);
    }

    private handleShares(request: IncomingMessage, response: ServerResponse, url: URL, apiRequest: string | undefined, body: Buffer): void {
        // the share api answers a request without the header as one of a browser without a session
        if (apiRequest !== 'true' || url.searchParams.get('format') !== 'json') {
            this.answer(response, 412);
            return;
        }
        if (url.pathname === SHARES_PATH) {
            if (request.method === 'POST') {
                this.createShare(response, this.parseObject(body));
                return;
            }
            if (request.method === 'GET') {
                this.findShares(response, url.searchParams.get('path') ?? undefined);
                return;
            }
        }
        const shareId: string | undefined = url.pathname.startsWith(`${SHARES_PATH}/`)
            ? decodeURIComponent(url.pathname.slice(SHARES_PATH.length + 1))
            : undefined;
        const share: InProcessWebDavShare | undefined = shareId == undefined ? undefined : this.shares.get(shareId);
        if (share == undefined || (request.method !== 'GET' && request.method !== 'DELETE' && request.method !== 'PUT')) {
            this.answerOcs(response, 404, []);
            return;
        }
        if (request.method === 'DELETE') {
            this.shares.delete(share.id);
            this.answerOcs(response, 200, []);
            return;
        }
        if (request.method === 'PUT') {
            const permissions: unknown = Reflect.get(this.parseObject(body), 'permissions');
            const changed: InProcessWebDavShare = {
                ...share,
                permissions: typeof permissions === 'number' ? permissions : share.permissions
            };
            this.shares.set(share.id, changed);
            this.answerOcs(response, 200, this.toOcsShare(changed));
            return;
        }
        this.answerOcs(response, 200, [this.toOcsShare(share)]);
    }

    private findShares(response: ServerResponse, path: string | undefined): void {
        if (path != undefined && !this.holdsSharePath(path)) {
            this.answerOcs(response, 404, []);
            return;
        }
        this.answerOcs(
            response,
            200,
            [...this.shares.values()].filter(share => path == undefined || share.path === path).map(share => this.toOcsShare(share))
        );
    }

    private createShare(response: ServerResponse, body: object): void {
        const path: unknown = Reflect.get(body, 'path');
        const shareType: unknown = Reflect.get(body, 'shareType');
        const shareWith: unknown = Reflect.get(body, 'shareWith');
        if (typeof path !== 'string' || !this.holdsSharePath(path)) {
            this.answerOcs(response, 404, []);
            return;
        }
        const isRecipient: boolean = shareType === USER_SHARE_TYPE || shareType === GROUP_SHARE_TYPE;
        if (
            typeof shareType !== 'number'
            || (shareType !== LINK_SHARE_TYPE && !isRecipient)
            || (isRecipient && typeof shareWith !== 'string')
        ) {
            this.answerOcs(response, 400, []);
            return;
        }
        // Nextcloud shares a path with a user or a group once
        if (
            isRecipient
            && [...this.shares.values()]
                .some(share => share.path === path && share.shareType === shareType && share.shareWith === shareWith)
        ) {
            this.answerOcs(response, 403, []);
            return;
        }
        const id: string = this.nextId();
        const password: unknown = Reflect.get(body, 'password');
        const expiresOn: unknown = Reflect.get(body, 'expireDate');
        const permissions: unknown = Reflect.get(body, 'permissions');
        const share: InProcessWebDavShare = {
            id,
            shareType,
            shareWith: typeof shareWith === 'string' ? shareWith : undefined,
            path,
            url: isRecipient
                ? undefined
                : `${this.origin}/s/${createHash('sha256').update(id)
                    .digest('hex')
                    .slice(0, 15)}`,
            password: typeof password === 'string' ? password : undefined,
            expiresOn: typeof expiresOn === 'string' ? expiresOn : undefined,
            permissions: typeof permissions === 'number' ? permissions : 1
        };
        this.shares.set(id, share);
        this.answerOcs(response, 200, this.toOcsShare(share));
    }

    /**
     * Whether a path, as the share api takes it, is a file or a folder of the user.
     * @param path - The path within the files of the user, such as `/Customers/Ada`.
     * @returns Whether there is one.
     */
    private holdsSharePath(path: string): boolean {
        const target: string = `files/${this.username}${path === '/' ? '' : path}`;
        return this.files.has(target) || this.folders.has(target);
    }

    private toOcsShare(share: InProcessWebDavShare): object {
        const isRecipient: boolean = share.shareType === USER_SHARE_TYPE || share.shareType === GROUP_SHARE_TYPE;
        return {
            id: share.id,
            share_type: share.shareType,
            permissions: share.permissions,
            path: share.path,
            url: share.url ?? null,
            // as Nextcloud names the hash of the password of a link, and the user or the group of a share with one
            share_with: isRecipient
                ? share.shareWith ?? null
                : share.password == undefined
                    ? null
                    : createHash('sha256').update(share.password)
                        .digest('hex'),
            expiration: share.expiresOn == undefined ? null : `${share.expiresOn} 00:00:00`
        };
    }

    private answerOcs(response: ServerResponse, status: number, data: unknown): void {
        response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({
            ocs: { meta: { status: status === 200 ? 'ok' : 'failure', statuscode: status, message: '' }, data }
        }));
    }

    private answer(response: ServerResponse, status: number): void {
        response.writeHead(status);
        response.end();
    }

    private parseObject(body: Buffer): object {
        const parsed: unknown = JSON.parse(body.toString('utf8'));
        return typeof parsed === 'object' && parsed != undefined ? parsed : {};
    }

    private escape(text: string): string {
        return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;');
    }

    private parentOf(path: string): string {
        return path.split('/').slice(0, -1)
            .join('/');
    }

    private nextId(): string {
        this.counter++;
        return String(this.counter);
    }

    private resolveEtag(content: Buffer): string {
        this.counter++;
        const prefix: string = `${this.counter}:`;
        return `"${createHash('sha256').update(prefix)
            .update(content)
            .digest('hex')
            .slice(0, 16)}"`;
    }
}