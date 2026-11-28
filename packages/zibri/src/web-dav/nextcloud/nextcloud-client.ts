import { XmlUtilities } from '../../document/xml.utilities';
import { FileSize } from '../../entity/models/file-property-metadata.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { HttpClientResponse } from '../../http-client/http-client-response.model';
import { WebDavMethod } from '../../http-client/web-dav-method.enum';
import { HtmlUtilities } from '../../parsing/html/html.utilities';
import { StorageUtilities } from '../../storage/storage.utilities';
import { Ms } from '../../utilities/ms';
import { WebDavMultistatus } from '../multistatus/web-dav-multistatus.model';
import { WebDavClient } from '../web-dav-client';
import { WebDavClientOptions } from '../web-dav-client-options.model';
import { WebDavConnection } from '../web-dav-connection.model';
import { WebDavEntry } from '../web-dav-entry.model';
import { WebDavNotFoundError } from '../web-dav-not-found.error';
import { WebDavProperty } from '../web-dav-property.model';
import { WebDavRequestOptions } from '../web-dav-request-options.model';
import { NewNextcloudShare } from './new-nextcloud-share.model';
import { NextcloudShareChange } from './nextcloud-share-change.model';
import { NextcloudShareType } from './nextcloud-share-type.model';
import { NextcloudShare } from './nextcloud-share.model';
import { NextcloudTrashBinEntry } from './nextcloud-trash-bin-entry.model';
import { NextcloudOcsShareAnswer } from './ocs/nextcloud-ocs-share-answer.model';
import { NextcloudOcsShareListAnswer } from './ocs/nextcloud-ocs-share-list-answer.model';
import { NextcloudOcsShare } from './ocs/nextcloud-ocs-share.model';

/**
 * The segments of the path of the WebDAV root of Nextcloud, below the folder it is installed in.
 */
const DAV_ROOT_SEGMENTS: [string, string] = ['remote.php', 'dav'];

/**
 * The folder of the WebDAV root the files of each user are in, as `files/<user>`.
 */
const FILES_SEGMENT: string = 'files';

/**
 * The path of the share api below the OCS api, version 2, whose answers carry the status in the http status too.
 */
const SHARES_PATH: string = 'apps/files_sharing/api/v1/shares';

/**
 * What a share with a user, with a group and by link are numbered as by the share api.
 */
const USER_SHARE_TYPE: number = 0;
const GROUP_SHARE_TYPE: number = 1;
const LINK_SHARE_TYPE: number = 3;

/**
 * The share types of the share api, as `NextcloudShare` names them.
 */
const SHARE_TYPES: ReadonlyMap<number, NextcloudShareType> = new Map([
    [USER_SHARE_TYPE, 'user'],
    [GROUP_SHARE_TYPE, 'group'],
    [LINK_SHARE_TYPE, 'link']
]);

/**
 * The namespace of the properties Nextcloud names what its trash bin holds with.
 */
const NEXTCLOUD_NAMESPACE: string = 'http://nextcloud.org/ns';

/**
 * Where a file or a folder of the trash bin was before it was deleted, relative to the files of its user.
 */
const TRASH_BIN_ORIGINAL_LOCATION: WebDavProperty = { namespace: NEXTCLOUD_NAMESPACE, name: 'trashbin-original-location' };

/**
 * When a file or a folder of the trash bin was deleted, in seconds since 1970.
 */
const TRASH_BIN_DELETION_TIME: WebDavProperty = { namespace: NEXTCLOUD_NAMESPACE, name: 'trashbin-deletion-time' };

/**
 * What the share api answers about the shares of one file at most: a few hundred bytes a share.
 */
const MAX_SHARE_LIST_ANSWER_SIZE: FileSize = '5mb';

/**
 * The permission to read, the one a share by link gets.
 */
const READ_PERMISSION: number = 1;

/**
 * What the share api answers about one share, or the shares of one file, at most.
 */
const MAX_SHARE_ANSWER_SIZE: FileSize = '1mb';

/**
 * What a search for one file is answered with at most: the file, and what else the server names beside it.
 */
const MAX_SEARCH_ANSWER_SIZE: FileSize = '1mb';

/**
 * The id Nextcloud keeps a file under: digits.
 */
const FILE_ID: RegExp = /^\d+$/;

/**
 * A day, as the share api takes and answers it.
 */
const DAY: RegExp = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads and writes the files of a Nextcloud through WebDAV, as `WebDavClient` does, and through what Nextcloud has
 * beside it: finding a file by the id it keeps when it is renamed or moved, sharing a file or a folder, and deleting
 * what its trash bin keeps.
 *
 * The url of the connection is below `/remote.php/dav/` of the server, such as
 * `https://cloud.example.com/remote.php/dav/` for every folder of the user, or
 * `https://cloud.example.com/remote.php/dav/files/ada/` for the files of Ada. A path a share or a search is about is
 * among the files of the user, `files/<user>/` below `/remote.php/dav/`.
 */
export class NextcloudClient extends WebDavClient {
    /**
     * The property Nextcloud names the id of a file or a folder in, which stays when it is renamed or moved, as
     * `findEntries` and `findEntry` take it.
     */
    static readonly FILE_ID_PROPERTY: WebDavProperty = { namespace: 'http://owncloud.org/ns', name: 'fileid' };

    /**
     * The url of the WebDAV root, `/remote.php/dav/`, which a search is sent to.
     */
    private readonly davRootUrl: URL;

    /**
     * The url of the OCS api, version 2, ending in `/`.
     */
    private readonly ocsUrl: URL;

    /**
     * The decoded segments of the folder of the connection below the WebDAV root, such as `['files', 'ada']`.
     */
    private readonly davSegments: string[];

    /**
     * The clients of the trash bins of the users, by user, which list and delete what each holds.
     */
    private readonly trashBinClients: Map<string, WebDavClient> = new Map();

    /**
     * Creates the client of a folder of a Nextcloud.
     * @param clientOptions - The folder, who logs in to it, what its hosts are checked by, and how requests are sent.
     * @throws {InternalError} When the url of the connection is no http or https url, or not below `/remote.php/dav/`.
     */
    // kept for the clients of the trash bins, which log in and are checked as this one is
    constructor(private readonly clientOptions: WebDavClientOptions) {
        super(clientOptions);
        const segments: string[] = this.baseUrl.pathname.split('/').filter(segment => segment !== '')
            .map(segment => decodeURIComponent(segment));
        const root: number = segments.findIndex((segment, index) => segment === DAV_ROOT_SEGMENTS[0] && segments[index + 1] === DAV_ROOT_SEGMENTS[1]);
        if (root < 0) {
            throw new InternalError(`The url of a Nextcloud connection needs to be below /remote.php/dav/ of the server, and is "${clientOptions.connection.url}".`);
        }
        // the folder Nextcloud is installed in, such as /nextcloud/, which the OCS api is below as well
        const installation: string = segments.slice(0, root).map(segment => `${encodeURIComponent(segment)}/`)
            .join('');
        this.davRootUrl = new URL(`/${installation}${DAV_ROOT_SEGMENTS.join('/')}/`, this.baseUrl);
        this.ocsUrl = new URL(`/${installation}ocs/v2.php/`, this.baseUrl);
        this.davSegments = segments.slice(root + DAV_ROOT_SEGMENTS.length);
    }

    /**
     * Creates the client of a folder of a Nextcloud a tenant configured, its host and every redirect checked against
     * `ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS`.
     * @param connection - The tenant's connection, such as a `TenantWebDavConnection` of the kind `NEXTCLOUD` as a
     * repository reads it, its password decrypted.
     * @param options - How requests are sent.
     * @returns The client.
     * @throws {InternalError} When the url of the connection is no http or https url, or not below `/remote.php/dav/`.
     */
    static override createForTenant(
        connection: WebDavConnection,
        options: Pick<WebDavClientOptions, 'timeoutInMs' | 'attempts'> = {}
    ): NextcloudClient {
        return new NextcloudClient({ ...options, connection, network: NextcloudClient.resolveTenantNetwork() });
    }

    /**
     * Finds a file or a folder by the id Nextcloud keeps it under, wherever it was renamed or moved to within the
     * folder of the connection, with a SEARCH (RFC 5323) of the files of its user. A file in the trash bin is not
     * found.
     * @param fileId - The id, as `FILE_ID_PROPERTY` names it.
     * @param formerPath - A path it was at, relative to the url of the connection, which names the user whose files
     * are searched.
     * @returns It, with its id, or undefined when the files of the user hold nothing of that id within the folder of
     * the connection.
     * @throws {InternalError} When the id is no id of Nextcloud, or the path is not among the files of a user.
     */
    async findEntryByFileId(fileId: string, formerPath: string): Promise<WebDavEntry<'fileId'> | undefined> {
        if (!FILE_ID.test(fileId)) {
            throw new InternalError(`The id of a file of Nextcloud needs to be digits, and is "${fileId}".`);
        }
        const user: string = this.resolveFilesSegments(formerPath)[1];
        const property: WebDavProperty = NextcloudClient.FILE_ID_PROPERTY;
        // the scope is a path relative to the WebDAV root, as Nextcloud reads it, rather than a url: the files of the
        // user as a whole, since a connection to a folder deeper down is below them
        const body: string = '<?xml version="1.0" encoding="utf-8"?>'
            + `<d:searchrequest xmlns:d="DAV:" xmlns:oc="${HtmlUtilities.escape(property.namespace)}"><d:basicsearch>`
            + `<d:select><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/><oc:${property.name}/></d:prop></d:select>`
            + `<d:from><d:scope><d:href>/${FILES_SEGMENT}/${HtmlUtilities.escape(user)}</d:href><d:depth>infinity</d:depth></d:scope></d:from>`
            + `<d:where><d:eq><d:prop><oc:${property.name}/></d:prop><d:literal>${fileId}</d:literal></d:eq></d:where>`
            + '<d:orderby/></d:basicsearch></d:searchrequest>';
        const options: WebDavRequestOptions = await this.resolveRequestOptions();
        let multistatus: WebDavMultistatus;
        try {
            const response: HttpClientResponse<WebDavMultistatus, Record<string, unknown>> = await this.httpClient.request(
                WebDavMethod.SEARCH,
                this.davRootUrl.href,
                XmlUtilities.resolveXmlString(body),
                {
                    ...options,
                    requestBodyType: MimeType.XML,
                    responseBody: { type: MimeType.XML, modelClass: WebDavMultistatus, allowAdditionalProperties: true, maxSize: MAX_SEARCH_ANSWER_SIZE }
                }
            );
            multistatus = response.body;
        }
        catch (error) {
            throw WebDavClient.resolveError(formerPath, error);
        }
        // a file moved out of the folder of the connection is out of its reach, as anything above it
        const within: WebDavMultistatus = {
            responses: multistatus.responses?.filter(response => new URL(response.href, this.baseUrl).pathname.startsWith(this.baseUrl.pathname))
        };
        return this.resolveEntries(within, { fileId: property }).find(entry => entry.properties['fileId'] === fileId);
    }

    /**
     * Creates a share of a file or a folder: a link to read it, or a share with a user or a group.
     * @param share - What is shared, and how.
     * @returns The share.
     * @throws {WebDavNotFoundError} When there is nothing at the path.
     * @throws {HttpClientError} When Nextcloud refuses the share, such as for a password its policy refuses, or a
     * user or a group it does not have.
     * @throws {InternalError} When the path is not among the files of a user, or `expiresOn` is no day.
     */
    async createShare(share: NewNextcloudShare): Promise<NextcloudShare> {
        if (share.type === 'link' && share.expiresOn != undefined && !DAY.test(share.expiresOn)) {
            throw new InternalError(`The day a share of Nextcloud expires on needs to be written as 2027-01-31, and is "${share.expiresOn}".`);
        }
        const path: string = this.resolveSharePath(share.path);
        const body: Record<string, string | number> = share.type === 'link'
            ? {
                path,
                shareType: LINK_SHARE_TYPE,
                permissions: READ_PERMISSION,
                ...share.password == undefined ? {} : { password: share.password },
                ...share.expiresOn == undefined ? {} : { expireDate: share.expiresOn }
            }
            : {
                path,
                shareType: share.type === 'user' ? USER_SHARE_TYPE : GROUP_SHARE_TYPE,
                shareWith: share.shareWith,
                permissions: share.permissions
            };
        const options: WebDavRequestOptions = await this.resolveRequestOptions();
        try {
            const response: HttpClientResponse<NextcloudOcsShareAnswer, Record<string, unknown>> = await this.httpClient.post(
                new URL(SHARES_PATH, this.ocsUrl).href,
                body,
                {
                    ...options,
                    headers: this.resolveOcsHeaders(options),
                    query: { format: 'json' },
                    requestBodyType: MimeType.JSON,
                    responseBody: { type: MimeType.JSON, modelClass: NextcloudOcsShareAnswer, allowAdditionalProperties: true, maxSize: MAX_SHARE_ANSWER_SIZE }
                }
            );
            return this.toShare(response.body.ocs.data);
        }
        catch (error) {
            throw WebDavClient.resolveError(share.path, error);
        }
    }

    /**
     * Finds a share by its id.
     * @param shareId - The id.
     * @returns The share, or undefined when there is none of the id, such as one somebody deleted in Nextcloud.
     */
    async findShare(shareId: string): Promise<NextcloudShare | undefined> {
        const options: WebDavRequestOptions = await this.resolveRequestOptions();
        try {
            const response: HttpClientResponse<NextcloudOcsShareListAnswer, Record<string, unknown>> = await this.httpClient.get(
                new URL(`${SHARES_PATH}/${encodeURIComponent(shareId)}`, this.ocsUrl).href,
                {
                    ...options,
                    headers: this.resolveOcsHeaders(options),
                    query: { format: 'json' },
                    responseBody: { type: MimeType.JSON, modelClass: NextcloudOcsShareListAnswer, allowAdditionalProperties: true, maxSize: MAX_SHARE_ANSWER_SIZE }
                }
            );
            const found: NextcloudOcsShare | undefined = response.body.ocs.data[0];
            return found == undefined ? undefined : this.toShare(found);
        }
        catch (error) {
            const resolved: unknown = WebDavClient.resolveError(`share ${shareId}`, error);
            if (resolved instanceof WebDavNotFoundError) {
                return undefined;
            }
            throw resolved;
        }
    }

    /**
     * Finds every share of a file or a folder, whoever created it: the user of the connection, or a user it was
     * shared with who shared it on.
     * @param path - The path of the file or the folder, relative to the url of the connection.
     * @returns The shares, none for a file or a folder that is not shared.
     * @throws {WebDavNotFoundError} When there is nothing at the path.
     * @throws {InternalError} When the path is not among the files of a user.
     */
    async findShares(path: string): Promise<NextcloudShare[]> {
        const sharePath: string = this.resolveSharePath(path);
        const options: WebDavRequestOptions = await this.resolveRequestOptions();
        try {
            const response: HttpClientResponse<NextcloudOcsShareListAnswer, Record<string, unknown>> = await this.httpClient.get(
                new URL(SHARES_PATH, this.ocsUrl).href,
                {
                    ...options,
                    headers: this.resolveOcsHeaders(options),
                    // the shares others created of it as well, which only reshares names
                    query: { format: 'json', path: sharePath, reshares: 'true' },
                    responseBody: { type: MimeType.JSON, modelClass: NextcloudOcsShareListAnswer, allowAdditionalProperties: true, maxSize: MAX_SHARE_LIST_ANSWER_SIZE }
                }
            );
            return response.body.ocs.data.map(share => this.toShare(share));
        }
        catch (error) {
            throw WebDavClient.resolveError(path, error);
        }
    }

    /**
     * Changes a share, such as what a share with a user or a group lets them do.
     * @param shareId - The id of the share.
     * @param change - The change.
     * @returns The share, changed.
     * @throws {WebDavNotFoundError} When Nextcloud has no share of the id.
     * @throws {WebDavForbiddenError} When the user of the connection may not change the share.
     * @throws {HttpClientError} When Nextcloud refuses the change otherwise, or cannot be reached.
     */
    async updateShare(shareId: string, change: NextcloudShareChange): Promise<NextcloudShare> {
        const options: WebDavRequestOptions = await this.resolveRequestOptions();
        try {
            const response: HttpClientResponse<NextcloudOcsShareAnswer, Record<string, unknown>> = await this.httpClient.put(
                new URL(`${SHARES_PATH}/${encodeURIComponent(shareId)}`, this.ocsUrl).href,
                { permissions: change.permissions },
                {
                    ...options,
                    headers: this.resolveOcsHeaders(options),
                    query: { format: 'json' },
                    requestBodyType: MimeType.JSON,
                    responseBody: { type: MimeType.JSON, modelClass: NextcloudOcsShareAnswer, allowAdditionalProperties: true, maxSize: MAX_SHARE_ANSWER_SIZE }
                }
            );
            return this.toShare(response.body.ocs.data);
        }
        catch (error) {
            throw WebDavClient.resolveError(`share ${shareId}`, error);
        }
    }

    /**
     * Finds what the trash bin of a user holds that was deleted from within a folder: the folder itself, and the files
     * and folders that were in it or below it.
     * @param folder - The path of the folder, relative to the url of the connection, `''` for the folder of the
     * connection. It is among the files of the user whose trash bin is read.
     * @returns What the trash bin holds of it, none for a Nextcloud without a trash bin.
     * @throws {InternalError} When the path is not among the files of a user.
     */
    async findTrashBinEntries(folder: string): Promise<NextcloudTrashBinEntry[]> {
        const [filesSegment, user, ...within] = this.resolveFilesSegments(folder);
        let entries: WebDavEntry<'location' | 'deletedAt'>[];
        try {
            entries = await this.resolveTrashBinClient(user).findEntries('', {
                location: TRASH_BIN_ORIGINAL_LOCATION,
                deletedAt: TRASH_BIN_DELETION_TIME
            });
        }
        catch (error) {
            // a Nextcloud without its trash bin app keeps nothing of what is deleted
            if (error instanceof WebDavNotFoundError) {
                return [];
            }
            throw error;
        }
        return entries.flatMap(entry => {
            // relative to the files of the user, such as `Backups/chunk`
            const location: string[] = (entry.properties.location ?? '').split('/').filter(segment => segment !== '');
            if (!location.length || within.some((segment, index) => location[index] !== segment)) {
                return [];
            }
            const deletedInSeconds: number = Number(entry.properties.deletedAt);
            const trashed: NextcloudTrashBinEntry = {
                id: entry.name,
                user,
                // within the folder, and so within the folder of the connection, which every path is relative to
                originalPath: [filesSegment, user, ...location].slice(this.davSegments.length).join('/'),
                kind: entry.kind,
                size: entry.size,
                deletedAt: entry.properties.deletedAt == undefined || !Number.isFinite(deletedInSeconds)
                    ? undefined
                    : new Date(deletedInSeconds * Ms.SECOND)
            };
            return [trashed];
        });
    }

    /**
     * Deletes a file or a folder from the trash bin of its user for good, which frees the storage it took up. One the
     * trash bin no longer holds, such as one Nextcloud expired, counts as deleted.
     * @param entry - The file or the folder, as `findTrashBinEntries` found it.
     * @throws {HttpClientError} When Nextcloud refuses, or cannot be reached.
     */
    async deleteTrashBinEntry(entry: NextcloudTrashBinEntry): Promise<void> {
        try {
            await this.resolveTrashBinClient(entry.user).delete(entry.id);
        }
        catch (error) {
            if (error instanceof WebDavNotFoundError) {
                return;
            }
            throw error;
        }
    }

    /**
     * Deletes a share, such as a link, which then opens nothing. A share of the id Nextcloud does not have, such as
     * one somebody deleted in Nextcloud, counts as deleted.
     * @param shareId - The id of the share.
     * @throws {WebDavForbiddenError} When the user of the connection may not delete the share.
     * @throws {HttpClientError} When Nextcloud refuses otherwise, or cannot be reached.
     */
    async deleteShare(shareId: string): Promise<void> {
        const options: WebDavRequestOptions = await this.resolveRequestOptions();
        try {
            // the answer names nothing beside its status
            await this.httpClient.delete(
                new URL(`${SHARES_PATH}/${encodeURIComponent(shareId)}`, this.ocsUrl).href,
                { ...options, headers: this.resolveOcsHeaders(options), query: { format: 'json' } }
            );
        }
        catch (error) {
            const resolved: unknown = WebDavClient.resolveError(`share ${shareId}`, error);
            if (resolved instanceof WebDavNotFoundError) {
                return;
            }
            throw resolved;
        }
    }

    /**
     * Resolves the url of a path of the OCS api, version 2, for a request a class building on this one sends itself,
     * such as to the users and groups of the provisioning api.
     * @param path - The path below `/ocs/v2.php/`, such as `apps/files_sharing/api/v1/shares`.
     * @returns The url.
     */
    protected resolveOcsUrl(path: string): string {
        return new URL(path, this.ocsUrl).href;
    }

    /**
     * Resolves the headers a request to the OCS api is sent with, for a request a class building on this one sends
     * itself: the credentials, and the header without which the OCS api answers as to a browser without a session.
     * @param options - The options of the request, as `resolveRequestOptions` resolves them.
     * @returns The headers.
     */
    protected resolveOcsHeaders(options: WebDavRequestOptions): Record<string, string> {
        return { ...options.headers, 'ocs-apirequest': 'true', [KnownHeader.ACCEPT]: MimeType.JSON };
    }

    /**
     * Resolves the segments of a path below the WebDAV root, validating that it is among the files of a user.
     * @param path - The path, relative to the url of the connection.
     * @returns The segments, starting with `files` and the user.
     * @throws {InternalError} When the path is not among the files of a user, or has an empty segment, `.` or `..`.
     */
    private resolveFilesSegments(path: string): [string, string, ...string[]] {
        const segments: string[] = [...this.davSegments, ...path === '' ? [] : StorageUtilities.resolveKeySegments(`Nextcloud ${this.baseUrl.href}`, path)];
        const [folder, user, ...rest] = segments;
        if (folder !== FILES_SEGMENT || user == undefined) {
            throw new InternalError(`"${path}" of the Nextcloud connection ${this.baseUrl.href} needs to be among the files of a user, below /remote.php/dav/files/<user>/.`);
        }
        return [folder, user, ...rest];
    }

    /**
     * Resolves the path of a file or a folder as the share api takes it: within the files of the user, from `/`.
     * @param path - The path, relative to the url of the connection.
     * @returns The path within the files of the user.
     * @throws {InternalError} When the path is not among the files of a user.
     */
    private resolveSharePath(path: string): string {
        return `/${this.resolveFilesSegments(path).slice(2)
            .join('/')}`;
    }

    /**
     * Resolves the client of the trash bin of a user, which logs in and is checked as this one is.
     * @param user - The user.
     * @returns The client.
     */
    private resolveTrashBinClient(user: string): WebDavClient {
        const known: WebDavClient | undefined = this.trashBinClients.get(user);
        if (known != undefined) {
            return known;
        }
        const url: URL = new URL(`trashbin/${encodeURIComponent(user)}/trash/`, this.davRootUrl);
        const created: WebDavClient = new WebDavClient({ ...this.clientOptions, connection: { ...this.clientOptions.connection, url: url.href } });
        this.trashBinClients.set(user, created);
        return created;
    }

    /**
     * Gets a share as the share api answered it, as a `NextcloudShare`.
     * @param share - The share, as answered.
     * @returns The share.
     */
    private toShare(share: NextcloudOcsShare): NextcloudShare {
        const type: NextcloudShareType = SHARE_TYPES.get(share.share_type) ?? 'other';
        return {
            id: share.id,
            type,
            permissions: share.permissions,
            url: share.url ?? undefined,
            // the share api names the hash of the password of a link here
            shareWith: type === 'user' || type === 'group' ? share.share_with ?? undefined : undefined,
            // a moment at the start of the day, of which the day is what the share api takes
            expiresOn: share.expiration == undefined ? undefined : share.expiration.slice(0, 10)
        };
    }
}
