import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { TenantTransportNetwork } from '../backup/tenant/tenant-transport-network.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { XmlString } from '../document/xml-string.type';
import { XmlUtilities } from '../document/xml.utilities';
import { FileSize } from '../entity/models/file-property-metadata.model';
import { InternalError } from '../error-handling/internal-error.model';
import { HttpMethod } from '../http/http-method.enum';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { CircuitOpenError } from '../http-client/circuit-open.error';
import { HttpClientBufferedBody } from '../http-client/http-client-buffered-body.model';
import { HttpClientMethod } from '../http-client/http-client-method.type';
import { HttpClientResponse } from '../http-client/http-client-response.model';
import { HttpClientError } from '../http-client/http-client.error';
import { HttpClientInterface } from '../http-client/http-client.interface';
import { WebDavMethod } from '../http-client/web-dav-method.enum';
import { HtmlUtilities } from '../parsing/html/html.utilities';
import { StorageUtilities } from '../storage/storage.utilities';
import { NetworkAddressUtilities } from '../utilities/network-address.utilities';
import { WebDavMultistatusResponse } from './multistatus/web-dav-multistatus-response.model';
import { WebDavMultistatus } from './multistatus/web-dav-multistatus.model';
import { WebDavProp } from './multistatus/web-dav-prop.model';
import { WebDavClientOptions } from './web-dav-client-options.model';
import { WebDavConflictError } from './web-dav-conflict.error';
import { WebDavConnection } from './web-dav-connection.model';
import { WebDavDownload } from './web-dav-download.model';
import { WebDavEntry } from './web-dav-entry.model';
import { WebDavForbiddenError } from './web-dav-forbidden.error';
import { WebDavMoveOptions } from './web-dav-move-options.model';
import { WebDavNotFoundError } from './web-dav-not-found.error';
import { WebDavPreconditionFailedError } from './web-dav-precondition-failed.error';
import { WebDavProperty } from './web-dav-property.model';
import { WebDavPutOptions } from './web-dav-put-options.model';
import { WebDavRequestOptions } from './web-dav-request-options.model';
import { WebDavTenantConnectionOptions } from './web-dav-tenant-connection-options.model';

// the headers of WebDAV (RFC 4918, section 10), which no route reads and KnownHeader does not name
const DEPTH_HEADER: string = 'depth';
const DESTINATION_HEADER: string = 'destination';
const OVERWRITE_HEADER: string = 'overwrite';

// a listing names every entry of a folder in one answer, without pages, at a few hundred bytes an entry: some
// ten thousand entries of Nextcloud, which names more of each than most servers
const MAX_LISTING_SIZE: FileSize = '32mb';
// what a server says beside a status that is the whole answer, such as the html page of a 201
const MAX_IGNORED_BODY_SIZE: FileSize = '1mb';

/**
 * How long a folder is waited for between the attempts to create one that is locked, before what is there is read.
 */
const LOCKED_FOLDER_RETRY_DELAYS_IN_MS: readonly number[] = [100, 200, 400, 800];

// the status line of a group of properties the server found, such as `HTTP/1.1 200 OK`
const SUCCESS_STATUS_LINE: RegExp = /^HTTP\/\S+ 2\d\d\b/;
// the name of a property within its namespace, as an xml element is named
const PROPERTY_NAME: RegExp = /^[A-Za-z_][\w.-]*$/;
// the properties every entry is read from, by their element names and the keys of WebDavProp: a further property
// of one of these names would be read as one of them
const RESERVED_PROPERTY_NAMES: string[] = [
    'resourcetype',
    'getcontentlength',
    'getetag',
    'getlastmodified',
    'resourceType',
    'contentLength',
    'etag',
    'lastModified'
];

/**
 * Reads and writes the files and folders of a folder on a WebDAV server, such as Nextcloud, through the http
 * client: its timeout, retries, circuit breaker and redirects.
 *
 * Every path is relative to the url of the connection, its segments separated by `/`, none of them empty, `.` or
 * `..`. A request the server refuses throws a `WebDavNotFoundError`, `WebDavPreconditionFailedError`,
 * `WebDavConflictError` or `WebDavForbiddenError` for a `404`, `412`, `409` or `403`, and the `HttpClientError` of
 * the http client for any other.
 *
 * A class building on it, such as for an api of the server beside WebDAV, sends its own requests with
 * `resolveRequestOptions`, to the urls `resolveUrl` resolves, and throws what `resolveError` resolves.
 */
export class WebDavClient {
    /**
     * The url of the folder every path is relative to, ending in `/`.
     */
    protected readonly baseUrl: URL;

    /**
     * The decoded segments of the path of the folder, which every href the server answers with starts with.
     */
    private readonly baseSegments: string[];

    /**
     * The `authorization` header every request is sent with.
     */
    private readonly authorization: string;

    /**
     * What checks where a redirect leads, for a connection of a tenant.
     */
    private readonly validateRedirect: ((to: URL) => Promise<void>) | undefined;

    /**
     * Whether the host of a tenant's connection was checked.
     */
    private networkValidated: boolean = false;

    /**
     * The folders being created, by their path, which a call creating the same one waits for.
     */
    private readonly foldersBeingCreated: Map<string, Promise<void>> = new Map();

    /**
     * Creates the client of a folder.
     * @param options - The folder, who logs in to it, what its hosts are checked by, and how requests are sent.
     * @throws {InternalError} When the url of the connection is no http or https url.
     */
    constructor(private readonly options: WebDavClientOptions) {
        this.baseUrl = WebDavClient.resolveBaseUrl(options.connection.url);
        this.baseSegments = WebDavClient.resolveDecodedSegments(this.baseUrl.pathname);
        const credentials: string = `${options.connection.username}:${options.connection.password}`;
        this.authorization = `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`;
        const network: TenantTransportNetwork | undefined = options.network;
        this.validateRedirect = network == undefined
            ? undefined
            : async to => {
                WebDavClient.validateProtocol(to, network);
                await network.resolveAddress(to.hostname);
            };
    }

    /**
     * Creates the client of a folder a tenant configured, its host and every redirect checked against
     * `ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS`.
     * @param connection - The tenant's connection, such as a `TenantWebDavConnection` as a repository reads it, its
     * password decrypted.
     * @param options - How requests are sent.
     * @returns The client.
     * @throws {InternalError} When the url of the connection is no http or https url.
     */
    static createForTenant(
        connection: WebDavConnection,
        options: Pick<WebDavClientOptions, 'timeoutInMs' | 'attempts'> = {}
    ): WebDavClient {
        return new WebDavClient({ ...options, connection, network: WebDavClient.resolveTenantNetwork() });
    }

    /**
     * Resolves what the hosts of a tenant's connection are checked by, as
     * `ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS` says, for the `createForTenant` of a class building on this
     * one.
     * @returns The network.
     */
    protected static resolveTenantNetwork(): TenantTransportNetwork {
        const allowed: WebDavTenantConnectionOptions = inject(ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS);
        return {
            resolveAddress: async host => {
                if (allowed.allowPrivateNetworks) {
                    NetworkAddressUtilities.validateAllowedHost(host, allowed.allowedHosts);
                    return host;
                }
                return await NetworkAddressUtilities.resolvePublicAddress(host, allowed.allowedHosts);
            },
            allowPrivateNetworks: allowed.allowPrivateNetworks
        };
    }

    /**
     * The http client every request is sent with.
     * @returns The client.
     */
    protected get httpClient(): HttpClientInterface {
        return inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    }

    /**
     * Reads a file.
     * @param path - The path of the file.
     * @param maxSize - The most the file may hold, `maxBodySizes.stream` of the http client by default. A larger one
     * is refused, before any of it is read when the server names its size.
     * @returns Its bytes, and the ETag of what was read.
     * @throws {WebDavNotFoundError} When there is no file at the path.
     */
    async get(path: string, maxSize?: FileSize): Promise<WebDavDownload> {
        const url: string = this.resolveUrl(path, false);
        const options: WebDavRequestOptions = await this.resolveRequestOptions();
        return await this.sendMappingErrors(path, async () => {
            const response: HttpClientResponse<Readable, Record<string, string | undefined>> = await this.httpClient.get(url, {
                ...options,
                responseBody: { type: MimeType.OCTET_STREAM, maxSize },
                responseHeaders: { [KnownHeader.ETAG]: { type: 'string', required: false } }
            });
            return { content: response.body, etag: response.headers[KnownHeader.ETAG] };
        });
    }

    /**
     * Writes a file, under exactly one of the conditions of `WebDavPutOptions`.
     * @param path - The path of the file. The folder it is in exists.
     * @param content - What the file holds: text, written as utf-8, bytes, or the chunks of an
     * `HttpClientBufferedBody`, sent as they are.
     * @param options - Its content type, and the condition it is written under.
     * @returns The ETag of what was written, or undefined when the server names none in its answer.
     * @throws {WebDavPreconditionFailedError} When the condition does not hold.
     * @throws {WebDavConflictError} When the folder the file is in does not exist.
     */
    async put(path: string, content: string | Uint8Array | HttpClientBufferedBody, options: WebDavPutOptions): Promise<string | undefined> {
        return await this.putWithHeaders(path, content, options, {});
    }

    /**
     * Writes a file with further headers, for a class building on this one whose server reads one, such as the
     * checksum Nextcloud keeps with a file.
     * @param path - The path of the file. The folder it is in exists.
     * @param content - What the file holds.
     * @param options - Its content type, and the condition it is written under.
     * @param headers - The further headers.
     * @returns The ETag of what was written, or undefined when the server names none in its answer.
     * @throws {WebDavPreconditionFailedError} When the condition does not hold.
     * @throws {WebDavConflictError} When the folder the file is in does not exist.
     */
    protected async putWithHeaders(
        path: string,
        content: string | Uint8Array | HttpClientBufferedBody,
        options: WebDavPutOptions,
        headers: Record<string, string>
    ): Promise<string | undefined> {
        const url: string = this.resolveUrl(path, false);
        const requestOptions: WebDavRequestOptions = await this.resolveRequestOptions();
        const conditions: Record<string, string> = {
            ...options.ifMatch == undefined ? {} : { [KnownHeader.IF_MATCH]: options.ifMatch },
            ...options.ifNoneMatch == undefined ? {} : { [KnownHeader.IF_NONE_MATCH]: options.ifNoneMatch }
        };
        try {
            return await this.sendPut(url, content, requestOptions, conditions, headers, options);
        }
        catch (error) {
            // a put needs nothing at its own path, so a 404 is of the folder it is in: Nextcloud answers a folder that
            // does not exist with one, where RFC 4918 says 409
            if (error instanceof HttpClientError && WebDavClient.findStatus(error) === HttpStatus.NOT_FOUND) {
                throw new WebDavConflictError(path, error);
            }
            throw WebDavClient.resolveError(path, error);
        }
    }

    /**
     * Sends the PUT of a file.
     * @param url - The url of the file.
     * @param content - What the file holds.
     * @param requestOptions - What every request of the connection is sent with.
     * @param conditions - The headers of the condition it is written under.
     * @param headers - The further headers.
     * @param options - Its content type, and the condition it is written under.
     * @returns The ETag of what was written, or undefined when the server names none in its answer.
     */
    private async sendPut(
        url: string,
        content: string | Uint8Array | HttpClientBufferedBody,
        requestOptions: WebDavRequestOptions,
        conditions: Record<string, string>,
        headers: Record<string, string>,
        options: WebDavPutOptions
    ): Promise<string | undefined> {
        const body: string | HttpClientBufferedBody = typeof content === 'string' || content instanceof HttpClientBufferedBody
            ? content
            : new HttpClientBufferedBody([content]);
        const response: HttpClientResponse<Readable, Record<string, string | undefined>> = await this.httpClient.put(url, body, {
            ...requestOptions,
            // once under a condition: an attempt that reached the server changed the ETag, so a repeat after
            // its answer got lost is refused for what the first one did, and reports a put that succeeded as
            // a conflict
            attempts: Object.keys(conditions).length ? 1 : requestOptions.attempts,
            headers: { ...requestOptions.headers, ...headers, ...conditions, [KnownHeader.CONTENT_TYPE]: options.contentType },
            // the bytes go as they are, under the type the caller named
            requestBodyType: MimeType.OCTET_STREAM,
            responseBody: { type: MimeType.OCTET_STREAM, maxSize: MAX_IGNORED_BODY_SIZE },
            responseHeaders: { [KnownHeader.ETAG]: { type: 'string', required: false } }
        });
        await this.discard(response.body);
        return response.headers[KnownHeader.ETAG];
    }

    /**
     * Deletes a file, or a folder with everything in it.
     * @param path - The path of the file or the folder.
     * @throws {WebDavNotFoundError} When there is nothing at the path.
     */
    async delete(path: string): Promise<void> {
        const url: string = this.resolveUrl(path, false);
        await this.sendMappingErrors(path, async () => await this.sendIgnoringBody(HttpMethod.DELETE, url, {}));
    }

    /**
     * Moves a file or a folder.
     * @param from - The path of the file or the folder.
     * @param to - Where it is moved to. The folder it is moved into exists.
     * @param options - Whether what is at the destination is replaced.
     * @throws {WebDavNotFoundError} When there is nothing at `from`.
     * @throws {WebDavPreconditionFailedError} When something is at `to`, and `overwrite` is false.
     * @throws {WebDavConflictError} When the folder `to` is in does not exist.
     */
    async move(from: string, to: string, options: WebDavMoveOptions): Promise<void> {
        const source: string = this.resolveUrl(from, false);
        const destination: string = this.resolveUrl(to, false);
        try {
            await this.sendIgnoringBody(WebDavMethod.MOVE, source, {
                // absolute, which RFC 4918 allows a path for, and which some servers insist on
                [DESTINATION_HEADER]: destination,
                [OVERWRITE_HEADER]: options.overwrite ? 'T' : 'F'
            });
        }
        catch (error) {
            const status: HttpStatus | undefined = WebDavClient.findStatus(error);
            // a 404 is about what is moved, every other refusal about where it goes
            if (status === HttpStatus.NOT_FOUND) {
                throw WebDavClient.resolveError(from, error);
            }
            // a server need not answer a folder that is not there with the 409 of RFC 4918: Apache renames, and
            // answers a 500. So a refusal saying nothing of its own is judged by whether the folder is there
            if (
                error instanceof HttpClientError && status != undefined
                && status !== HttpStatus.PRECONDITION_FAILED && status !== HttpStatus.CONFLICT
                && await this.isMissingFolderOf(to)
            ) {
                throw new WebDavConflictError(to, error);
            }
            throw WebDavClient.resolveError(to, error);
        }
    }

    /**
     * Resolves whether the folder a path is in is missing.
     * @param path - The path.
     * @returns True when no folder is where it would be, false when one is, or when that cannot be read.
     */
    private async isMissingFolderOf(path: string): Promise<boolean> {
        const segments: string[] = this.resolveSegments(path, false);
        // the folder of the connection is there, or no request would have been answered
        if (segments.length < 2) {
            return false;
        }
        try {
            return (await this.findEntry(segments.slice(0, -1).join('/')))?.kind !== 'folder';
        }
        catch {
            return false;
        }
    }

    /**
     * Creates a folder, with the folders above it that do not exist. A folder that exists is left as it is.
     * @param path - The path of the folder.
     * @throws {WebDavConflictError} When a file is where the folder, or a folder above it, would be.
     */
    async createFolder(path: string): Promise<void> {
        await this.createFolderAt(this.resolveSegments(path, false));
    }

    /**
     * Finds the files and folders directly in a folder.
     * @param path - The path of the folder, `''` for the folder of the connection.
     * @returns Them, in the order the server names them.
     * @throws {WebDavNotFoundError} When there is no folder at the path.
     */
    async findEntries(path: string): Promise<WebDavEntry[]>;
    /**
     * Finds the files and folders directly in a folder, with further properties of each.
     * @param path - The path of the folder, `''` for the folder of the connection.
     * @param properties - The further properties, by the name each is read under in `properties` of an entry.
     * @returns Them, in the order the server names them.
     * @throws {WebDavNotFoundError} When there is no folder at the path.
     */
    async findEntries<TProperty extends string>(
        path: string,
        properties: Record<TProperty, WebDavProperty>
    ): Promise<WebDavEntry<TProperty>[]>;
    async findEntries(path: string, properties: Record<string, WebDavProperty> = {}): Promise<WebDavEntry<string>[]> {
        const segments: string[] = this.resolveSegments(path, true);
        const multistatus: WebDavMultistatus = await this.sendMappingErrors(
            path,
            async () => await this.sendPropfind(this.resolveUrlOf(segments, true), '1', properties)
        );
        const entries: WebDavEntry<string>[] = this.resolveEntries(multistatus, properties);
        // the folder answers for itself as well
        const folder: WebDavEntry<string> | undefined = entries.find(entry => entry.path === segments.join('/'));
        if (folder?.kind === 'file') {
            throw new InternalError(`"${path}" on the WebDAV server at ${this.baseUrl.href} is a file, where a folder was listed.`);
        }
        return entries.filter(entry => entry !== folder);
    }

    /**
     * Finds the file or the folder at a path.
     * @param path - The path, `''` for the folder of the connection.
     * @returns It, or undefined when there is nothing at the path.
     */
    async findEntry(path: string): Promise<WebDavEntry | undefined>;
    /**
     * Finds the file or the folder at a path, with further properties.
     * @param path - The path, `''` for the folder of the connection.
     * @param properties - The further properties, by the name each is read under in `properties` of the entry.
     * @returns It, or undefined when there is nothing at the path.
     */
    async findEntry<TProperty extends string>(
        path: string,
        properties: Record<TProperty, WebDavProperty>
    ): Promise<WebDavEntry<TProperty> | undefined>;
    async findEntry(path: string, properties: Record<string, WebDavProperty> = {}): Promise<WebDavEntry<string> | undefined> {
        const segments: string[] = this.resolveSegments(path, true);
        let multistatus: WebDavMultistatus;
        try {
            multistatus = await this.sendPropfind(this.resolveUrlOf(segments, false), '0', properties);
        }
        catch (error) {
            if (WebDavClient.findStatus(error) === HttpStatus.NOT_FOUND) {
                return undefined;
            }
            throw WebDavClient.resolveError(path, error);
        }
        return this.resolveEntries(multistatus, properties).find(entry => entry.path === segments.join('/'));
    }

    /**
     * Resolves the options every request to the server is sent with, for a request a class building on this one
     * sends itself. A connection of a tenant has its host checked first.
     * @returns The credentials, the timeout and attempts, and the check of every redirect.
     * @throws {InternalError} When the host of a tenant's connection may not be reached.
     */
    protected async resolveRequestOptions(): Promise<WebDavRequestOptions> {
        await this.validateNetwork();
        return {
            headers: { [KnownHeader.AUTHORIZATION]: this.authorization },
            timeoutInMs: this.options.timeoutInMs,
            attempts: this.options.attempts,
            validateRedirect: this.validateRedirect
        };
    }

    /**
     * Resolves the url of a path below the folder of the connection, each segment encoded.
     * @param path - The path, `''` for the folder of the connection.
     * @param isFolder - Whether the path is of a folder, whose url ends in `/`.
     * @returns The url.
     * @throws {InternalError} When a segment is empty, `.` or `..`.
     */
    protected resolveUrl(path: string, isFolder: boolean): string {
        return this.resolveUrlOf(this.resolveSegments(path, true), isFolder);
    }

    /**
     * Resolves the error a refused request throws: the typed error of a `404`, `412`, `409` or `403`, and the error
     * itself for anything else.
     * @param path - The path the request was about, relative to the connection.
     * @param error - What the request failed with.
     * @returns The error to throw.
     */
    protected static resolveError(path: string, error: unknown): unknown {
        // a circuit that is open sent nothing, and carries no answer of the server
        if (!(error instanceof HttpClientError) || error instanceof CircuitOpenError) {
            return error;
        }
        switch (error.responseData?.status) {
            case HttpStatus.NOT_FOUND: {
                return new WebDavNotFoundError(path, error);
            }
            case HttpStatus.PRECONDITION_FAILED: {
                return new WebDavPreconditionFailedError(path, error);
            }
            case HttpStatus.CONFLICT: {
                return new WebDavConflictError(path, error);
            }
            case HttpStatus.FORBIDDEN: {
                return new WebDavForbiddenError(path, error);
            }
            case HttpStatus.CONTINUE:
            case HttpStatus.SWITCHING_PROTOCOLS:
            case HttpStatus.PROCESSING:
            case HttpStatus.OK:
            case HttpStatus.CREATED:
            case HttpStatus.ACCEPTED:
            case HttpStatus.NON_AUTHORITATIVE_INFORMATION:
            case HttpStatus.NO_CONTENT:
            case HttpStatus.RESET_CONTENT:
            case HttpStatus.PARTIAL_CONTENT:
            case HttpStatus.MULTIPLE_CHOICES:
            case HttpStatus.MOVED_PERMANENTLY:
            case HttpStatus.FOUND:
            case HttpStatus.SEE_OTHER:
            case HttpStatus.NOT_MODIFIED:
            case HttpStatus.TEMPORARY_REDIRECT:
            case HttpStatus.PERMANENT_REDIRECT:
            case HttpStatus.BAD_REQUEST:
            case HttpStatus.UNAUTHORIZED:
            case HttpStatus.PAYMENT_REQUIRED:
            case HttpStatus.METHOD_NOT_ALLOWED:
            case HttpStatus.NOT_ACCEPTABLE:
            case HttpStatus.REQUEST_TIMEOUT:
            case HttpStatus.GONE:
            case HttpStatus.CONTENT_TOO_LARGE:
            case HttpStatus.URI_TOO_LONG:
            case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
            case HttpStatus.UNPROCESSABLE_ENTITY:
            case HttpStatus.LOCKED:
            case HttpStatus.TOO_MANY_REQUESTS:
            case HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE:
            case HttpStatus.INTERNAL_SERVER_ERROR:
            case HttpStatus.NOT_IMPLEMENTED:
            case HttpStatus.BAD_GATEWAY:
            case HttpStatus.SERVICE_UNAVAILABLE:
            case HttpStatus.GATEWAY_TIMEOUT:
            case HttpStatus.HTTP_VERSION_NOT_SUPPORTED:
            case undefined:
            // a status the enum does not name, such as a 207 of WebDAV
            default: {
                return error;
            }
        }
    }

    /**
     * Resolves the url of a connection as the folder it names.
     * @param url - The url.
     * @returns The url, ending in `/`.
     * @throws {InternalError} When it is no http or https url.
     */
    private static resolveBaseUrl(url: string): URL {
        let parsed: URL;
        try {
            parsed = new URL(url);
        }
        catch (error) {
            throw new InternalError(`The url of a WebDAV connection needs to be an absolute url, and is "${url}".`, { cause: error });
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            throw new InternalError(`The url of a WebDAV connection needs to be http or https, and is "${url}".`);
        }
        // a folder, so that a path is resolved below it rather than beside it
        if (!parsed.pathname.endsWith('/')) {
            parsed.pathname = `${parsed.pathname}/`;
        }
        return parsed;
    }

    /**
     * Validates that a url of a tenant's connection is encrypted, unless private networks are allowed.
     * @param url - The url.
     * @param network - What the connection is checked by.
     * @throws {InternalError} When it is plain http, and private networks are not allowed.
     */
    private static validateProtocol(url: URL, network: TenantTransportNetwork): void {
        if (url.protocol !== 'https:' && !network.allowPrivateNetworks) {
            throw new InternalError(`A WebDAV server of a tenant needs to be reached over https, and ${url.origin} is not.`);
        }
    }

    /**
     * Finds the status the server refused a request with.
     * @param error - What the request failed with.
     * @returns The status, or undefined when no answer arrived.
     */
    private static findStatus(error: unknown): HttpStatus | undefined {
        return error instanceof HttpClientError && !(error instanceof CircuitOpenError) ? error.responseData?.status : undefined;
    }

    /**
     * Resolves the decoded segments of the path of a url.
     * @param pathname - The path, encoded.
     * @returns Its segments, without the empty ones.
     */
    private static resolveDecodedSegments(pathname: string): string[] {
        return pathname.split('/').filter(segment => segment !== '')
            .map(segment => decodeURIComponent(segment));
    }

    /**
     * Resolves the body of a PROPFIND asking for the properties every entry is read from, and the further ones.
     * @param properties - The further properties.
     * @returns The body.
     * @throws {InternalError} When a further property has no name an element can have, or one of the properties
     * every entry is read from, or two of them share a name.
     */
    private static resolvePropfindBody(properties: WebDavProperty[]): XmlString {
        const names: string[] = properties.map(property => property.name);
        const refused: string | undefined = names.find((name, index) => !PROPERTY_NAME.test(name)
            || RESERVED_PROPERTY_NAMES.includes(name)
            || names.indexOf(name) !== index)
        ?? properties.map(property => property.child).find(child => child != undefined && !PROPERTY_NAME.test(child));
        if (refused != undefined) {
            // the answer is read by the names of its elements alone, whatever their namespace
            throw new InternalError(
                'A further property of a WebDAV entry needs a name an xml element can have, of no property every entry is '
                + `read from and of no other property asked for, and "${refused}" is not one.`
            );
        }
        const prefixes: string = properties
            .map((property, index) => ` xmlns:p${index}="${HtmlUtilities.escape(property.namespace)}"`)
            .join('');
        const elements: string = properties.map((property, index) => `<p${index}:${property.name}/>`).join('');
        return XmlUtilities.resolveXmlString(
            `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"${prefixes}><d:prop>`
            + `<d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/>${elements}</d:prop></d:propfind>`
        );
    }

    /**
     * Finds the text of a property among the properties a server found.
     * @param props - The properties of each group the server found.
     * @param property - The property, and the element it holds whose text it is read as, if it is read so.
     * @returns The text, or undefined when no group holds it as text.
     */
    private static findText(props: WebDavProp[], property: WebDavProperty): string | undefined {
        for (const prop of props) {
            // a property the model does not declare is kept under its own name, as its text, or as an object of
            // what it holds for one holding elements
            const value: unknown = Reflect.get(prop, property.name);
            const text: unknown = property.child != undefined && typeof value === 'object' && value != undefined
                ? Reflect.get(value, property.child)
                : value;
            if (typeof text === 'string') {
                return text;
            }
        }
        return undefined;
    }

    /**
     * Validates the host of a tenant's connection, once for the client.
     * @throws {InternalError} When it may not be reached.
     */
    private async validateNetwork(): Promise<void> {
        const network: TenantTransportNetwork | undefined = this.options.network;
        if (network == undefined || this.networkValidated) {
            return;
        }
        WebDavClient.validateProtocol(this.baseUrl, network);
        await network.resolveAddress(this.baseUrl.hostname);
        // once rather than before every request: over https, a server proves its name with its certificate, so a
        // name pointed elsewhere later cannot answer for it, and plain http is allowed only where the private
        // networks are. Every redirect is checked on its own
        this.networkValidated = true;
    }

    /**
     * Resolves the segments of a path.
     * @param path - The path.
     * @param allowsRoot - Whether `''` names the folder of the connection.
     * @returns The segments.
     * @throws {InternalError} When a segment is empty, `.` or `..`.
     */
    private resolveSegments(path: string, allowsRoot: boolean): string[] {
        return path === '' && allowsRoot ? [] : StorageUtilities.resolveKeySegments(`WebDAV folder ${this.baseUrl.href}`, path);
    }

    /**
     * Resolves the url of the segments of a path.
     * @param segments - The segments.
     * @param isFolder - Whether they name a folder, whose url ends in `/`.
     * @returns The url.
     */
    private resolveUrlOf(segments: string[], isFolder: boolean): string {
        // each segment encoded on its own, so that a "?", a "#" or a ":" in a name stays part of it
        const encoded: string = segments.map(segment => encodeURIComponent(segment)).join('/');
        return new URL(isFolder && segments.length ? `${encoded}/` : encoded, this.baseUrl).href;
    }

    /**
     * Creates a folder, and the folders above it that do not exist.
     * @param segments - The segments of the path of the folder.
     * @throws {WebDavConflictError} When a file is where the folder, or a folder above it, would be.
     */
    private async createFolderAt(segments: string[]): Promise<void> {
        // the calls creating one folder at once wait for the same requests, rather than each sending their own and
        // racing for it: the files of a backup or a mirror are put into one new folder at once
        const key: string = segments.join('/');
        const creating: Promise<void> | undefined = this.foldersBeingCreated.get(key);
        if (creating != undefined) {
            await creating;
            return;
        }
        const created: Promise<void> = this.createFolderAtOnce(segments);
        this.foldersBeingCreated.set(key, created);
        try {
            await created;
        }
        finally {
            this.foldersBeingCreated.delete(key);
        }
    }

    /**
     * Creates a folder, and the folders above it that do not exist, for the one call that does.
     * @param segments - The segments of the path of the folder.
     * @throws {WebDavConflictError} When a file is where the folder, or a folder above it, would be.
     */
    private async createFolderAtOnce(segments: string[]): Promise<void> {
        const missingParent: HttpClientError | undefined = await this.resolveFolderCreation(segments);
        if (missingParent == undefined) {
            return;
        }
        // the folder of the connection is not created: a url that leads nowhere is a mistake to report
        if (segments.length === 1) {
            throw new WebDavConflictError(segments.join('/'), missingParent);
        }
        // from the deepest folder up rather than from the top down, so that a folder whose parent exists, the usual
        // case, costs one request
        await this.createFolderAt(segments.slice(0, -1));
        const stillMissing: HttpClientError | undefined = await this.resolveFolderCreation(segments);
        if (stillMissing != undefined) {
            throw new WebDavConflictError(segments.join('/'), stillMissing);
        }
    }

    /**
     * Sends the MKCOL of one folder.
     * @param segments - The segments of the path of the folder.
     * @returns The refusal of the server for a folder above that does not exist, or undefined once the folder exists.
     * @throws {WebDavConflictError} When a file is where the folder would be.
     */
    private async resolveFolderCreation(segments: string[]): Promise<HttpClientError | undefined> {
        const path: string = segments.join('/');
        try {
            await this.sendFolderCreation(segments);
            return undefined;
        }
        catch (error) {
            if (!(error instanceof HttpClientError)) {
                throw error;
            }
            const status: HttpStatus | undefined = WebDavClient.findStatus(error);
            if (status === HttpStatus.CONFLICT) {
                return error;
            }
            if (status == undefined) {
                throw WebDavClient.resolveError(path, error);
            }
            // a 405 is what a server answers for a folder that exists, and for a file at its path as well. Others
            // answer them otherwise: Apache a folder another request created between its check and its own with a
            // 403, and a path leading into a file with a status of its own. So the refusal is judged by what is there
            const found: WebDavEntry | undefined = await this.findEntryAfterRefusal(path, error);
            if (found?.kind === 'folder') {
                return undefined;
            }
            if (found?.kind === 'file' || status === HttpStatus.METHOD_NOT_ALLOWED) {
                throw new WebDavConflictError(path, error);
            }
            throw WebDavClient.resolveError(path, error);
        }
    }

    /**
     * Sends the MKCOL of one folder, again while the server answers that the folder is locked: another instance creating
     * it, which a server such as Nextcloud locks until it is done.
     * @param segments - The segments of the path of the folder.
     * @throws The error of the last attempt, a 423 among them once the attempts are used up.
     */
    private async sendFolderCreation(segments: string[]): Promise<void> {
        for (const delayInMs of [...LOCKED_FOLDER_RETRY_DELAYS_IN_MS, undefined]) {
            try {
                await this.sendIgnoringBody(WebDavMethod.MKCOL, this.resolveUrlOf(segments, true), {});
                return;
            }
            catch (error) {
                if (delayInMs == undefined || WebDavClient.findStatus(error) !== HttpStatus.LOCKED) {
                    throw error;
                }
                await sleep(delayInMs);
            }
        }
    }

    /**
     * Finds what is at a path after a request about it was refused.
     * @param path - The path.
     * @param refusal - What the request was refused with.
     * @returns What is there, or undefined when nothing is.
     * @throws The typed error of the refusal when what is there cannot be read either.
     */
    private async findEntryAfterRefusal(path: string, refusal: HttpClientError): Promise<WebDavEntry | undefined> {
        try {
            return await this.findEntry(path);
        }
        catch {
            // the refusal says more of what went wrong than the read after it
            throw WebDavClient.resolveError(path, refusal);
        }
    }

    /**
     * Sends a PROPFIND.
     * @param url - The url of the file or the folder.
     * @param depth - `'0'` for it alone, `'1'` for a folder and what is directly in it.
     * @param properties - The further properties to ask for.
     * @returns The answer.
     */
    private async sendPropfind(url: string, depth: '0' | '1', properties: Record<string, WebDavProperty>): Promise<WebDavMultistatus> {
        const options: WebDavRequestOptions = await this.resolveRequestOptions();
        const response: HttpClientResponse<WebDavMultistatus, Record<string, unknown>> = await this.httpClient.request(
            WebDavMethod.PROPFIND,
            url,
            WebDavClient.resolvePropfindBody(Object.values(properties)),
            {
                ...options,
                headers: { ...options.headers, [DEPTH_HEADER]: depth },
                requestBodyType: MimeType.XML,
                responseBody: {
                    type: MimeType.XML,
                    modelClass: WebDavMultistatus,
                    allowAdditionalProperties: true,
                    maxSize: MAX_LISTING_SIZE
                }
            }
        );
        return response.body;
    }

    /**
     * Sends a request whose answer is its status alone, reading the body a server may send beside it to its end.
     * @param method - The method.
     * @param url - The url.
     * @param headers - The headers besides the credentials.
     */
    private async sendIgnoringBody(method: HttpClientMethod, url: string, headers: Record<string, string>): Promise<void> {
        const options: WebDavRequestOptions = await this.resolveRequestOptions();
        const response: HttpClientResponse<Readable, Record<string, unknown>> = await this.httpClient.request(method, url, undefined, {
            ...options,
            headers: { ...options.headers, ...headers },
            responseBody: { type: MimeType.OCTET_STREAM, maxSize: MAX_IGNORED_BODY_SIZE }
        });
        await this.discard(response.body);
    }

    /**
     * Sends a request, throwing the typed error of a refusal.
     * @param path - The path the request is about.
     * @param send - Sends the request.
     * @returns What the request resolves to.
     */
    private async sendMappingErrors<T>(path: string, send: () => Promise<T>): Promise<T> {
        try {
            return await send();
        }
        catch (error) {
            throw WebDavClient.resolveError(path, error);
        }
    }

    /**
     * Reads a body to its end, so that the connection is free for the next request.
     * @param body - The body.
     */
    private async discard(body: Readable): Promise<void> {
        body.resume();
        await finished(body);
    }

    /**
     * Resolves the entries a multistatus answer names, for a class building on this one that sends a request
     * answered with one, such as a SEARCH.
     * @param multistatus - The answer.
     * @param properties - The further properties asked for.
     * @returns The entries, each with the properties the server found.
     * @throws {InternalError} When the answer is about a resource outside the folder of the connection.
     */
    protected resolveEntries(multistatus: WebDavMultistatus, properties: Record<string, WebDavProperty>): WebDavEntry<string>[] {
        return (multistatus.responses ?? []).flatMap(response => {
            const entry: WebDavEntry<string> | undefined = this.findEntryOf(response, properties);
            return entry == undefined ? [] : [entry];
        });
    }

    /**
     * Finds the entry one response of a multistatus answer names.
     * @param response - The response.
     * @param properties - The further properties asked for.
     * @returns The entry, or undefined for a response without properties the server found.
     * @throws {InternalError} When the response is about a resource outside the folder of the connection.
     */
    private findEntryOf(response: WebDavMultistatusResponse, properties: Record<string, WebDavProperty>): WebDavEntry<string> | undefined {
        const props: WebDavProp[] = (response.propstats ?? [])
            .filter(propstat => SUCCESS_STATUS_LINE.test(propstat.status))
            .map(propstat => propstat.prop);
        if (!props.length) {
            return undefined;
        }
        const segments: string[] = WebDavClient.resolveDecodedSegments(new URL(response.href, this.baseUrl).pathname);
        if (this.baseSegments.some((segment, index) => segments[index] !== segment)) {
            // a proxy in front of the server that hides a part of the path, or a server answering for another
            // folder: every path read from it would be wrong
            throw new InternalError(`The WebDAV server at ${this.baseUrl.href} answered for "${response.href}", which is outside of it.`);
        }
        const relative: string[] = segments.slice(this.baseSegments.length);
        const isFolder: boolean = props.some(prop => prop.resourceType?.collection !== undefined);
        // a property the server cannot give is an empty element, in a group of its own or, by some servers, here
        const contentLength: string | undefined = props.map(prop => prop.contentLength).find(value => value != undefined && value !== '');
        const lastModified: string | undefined = props.map(prop => prop.lastModified).find(value => value != undefined && value !== '');
        const modifiedAt: Date | undefined = lastModified == undefined ? undefined : new Date(lastModified);
        return {
            name: relative.at(-1) ?? '',
            path: relative.join('/'),
            kind: isFolder ? 'folder' : 'file',
            size: isFolder || contentLength == undefined ? undefined : Number(contentLength),
            etag: props.map(prop => prop.etag).find(value => value != undefined && value !== ''),
            modifiedAt: modifiedAt == undefined || Number.isNaN(modifiedAt.getTime()) ? undefined : modifiedAt,
            properties: Object.fromEntries(
                Object.entries(properties).map(([key, property]) => [key, WebDavClient.findText(props, property)])
            )
        };
    }
}