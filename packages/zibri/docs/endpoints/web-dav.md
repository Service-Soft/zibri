---
keywords: [webdav, nextcloud, owncloud, caldav, app password, etag, if-match, propfind, cloud storage, file sync]
---

# WebDAV
WebDAV is the protocol Nextcloud, ownCloud and many other self-hosted storages share their folders with, over HTTP. `WebDavClient` reads and writes the files and folders of one such folder: it writes a file only while nobody changed it, lists a folder, creates folders, moves and deletes. Every request goes through the [HTTP client](./http-client.md), with its timeout, retries, circuit breaker and redirects.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `WebDavClient` | class | Reads and writes the files and folders of a folder on a WebDAV server: `get`, `put`, `delete`, `move`, `createFolder`, `findEntries`, `findEntry` |
| `WebDavClientOptions` | type | What a client connects to, what its hosts are checked by, its `timeoutInMs` and `attempts` |
| `WebDavConnection` | type | The `url` of a folder, and the `username` and `password` that log in to it |
| `WebDavPutOptions` | type | The `contentType` of a file, and the one condition it is written under: `ifMatch`, `ifNoneMatch` or `overwrite` |
| `WebDavMoveOptions` | type | Whether a move replaces what is at its destination. Required |
| `WebDavEntry` | type | A file or a folder a listing names: its `name`, `path`, `kind`, `size`, `etag`, `modifiedAt` and further `properties` |
| `WebDavProperty` | type | A further property a listing asks for, by its `namespace` and `name` |
| `WebDavDownload` | type | A file read from the server: its `content` as a stream, and its `etag` |
| `WebDavNotFoundError` | error | A request for a path that holds nothing, a `404` |
| `WebDavPreconditionFailedError` | error | A request whose condition does not hold, a `412` |
| `WebDavConflictError` | error | A write into a folder that does not exist, or a folder where a file is, a `409` |
| `WebDavForbiddenError` | error | A request the user of the connection may not make, a `403` |
| `TenantWebDavConnection` | entity | A folder a [tenant](../glossary.md#tenant) [connects to](#connecting-to-the-server-of-a-tenant), its password stored encrypted |
| `WebDavConnectionKind` | enum | What server a connection of a tenant reaches: `WEB_DAV` for any, or `NEXTCLOUD` for a [Nextcloud](./nextcloud.md). Required |
| `TenantWebDavConnectionTest` | type | What `validateConnection` tests: the `kind`, `url`, `username` and `password` of a connection |
| `WebDavTenantConnectionOptions` | type | What the connections of tenants may reach: `allowedHosts` and `allowPrivateNetworks` |
| `ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS` | DI token | The `WebDavTenantConnectionOptions`. Defaults to any public host, over https |
| `WebDavRequestOptions` | type | What every request of a client is sent with, for a [class building on it](#building-on-the-client) |
| `TenantWebDavConnectionController` | class | The routes a tenant [manages its connections](#letting-tenants-manage-their-connections) with, which your controller extends |
| `TenantWebDavConnectionServiceInterface`, `TenantWebDavConnectionService` | interface, class | Lists, adds, changes and deletes the connections of the tenant, and tests one with `validateConnection`. Replaceable through `ZIBRI_DI_TOKENS.TENANT_WEB_DAV_CONNECTION_SERVICE` |
| `NewTenantWebDavConnection`, `TenantWebDavConnectionChange` | class, class | What adding and changing a connection take |
| `ZIBRI_WEB_DAV_PERMISSIONS`, `ZibriWebDavPermissions` | constant, constant | `web-dav-connections.read` and `web-dav-connections.manage`, to spread into your tenant permissions, and the same by name |
| `ZIBRI_WEB_DAV_CONNECTION_LIMITS` | constant | The longest name, url, username and password the routes take |
| `TenantWebDavConnectionUsageFinderInterface` | interface | Finds where a feature uses a connection, which keeps it from being deleted, see [keeping a connection that is in use](#keeping-a-connection-that-is-in-use) |
| `DiVariants.WEB_DAV_CONNECTION_USAGE_FINDER` | constant | The variant every usage finder is provided with |
| `TenantWebDavConnectionUsageCleanerInterface` | interface | Removes the rows of a feature that point at a connection, in the transaction the connection is deleted in, see [keeping a connection that is in use](#keeping-a-connection-that-is-in-use) |
| `CalendarEntryLinkUsageCleaner` | class | Removes the links to the events written through a connection that is deleted. Registered for you as `ZIBRI_DI_TOKENS.CALENDAR_ENTRY_LINK_USAGE_CLEANER` |
| `FileMirrorUsageCleaner` | class | Removes the [mirrored files](./file-mirror.md#deleting-a-connection) of a connection that is deleted. Registered for you as `ZIBRI_DI_TOKENS.FILE_MIRROR_USAGE_CLEANER` |
| `DiVariants.WEB_DAV_CONNECTION_USAGE_CLEANER` | constant | The variant every usage cleaner is provided with |

## Connecting to a folder
A client is the folder of a `WebDavConnection`, and every path is relative to its `url`. For Nextcloud, the folder of the files of a user is `/remote.php/dav/files/<user>/`:

```ts
// src/services/invoice-folder.service.ts
import { WebDavClient } from 'zibri';

export function createInvoiceFolder(appPassword: string): WebDavClient {
    return new WebDavClient({
        connection: {
            url: 'https://cloud.example.com/remote.php/dav/files/accounting/', // your own server
            username: 'accounting',
            password: appPassword
        },
        network: undefined,
        timeoutInMs: 30000
    });
}
```

`network` is required. It is `undefined` for a folder your application configures itself, as above, and the network of a tenant for a folder a tenant gave you, see [connecting to the server of a tenant](#connecting-to-the-server-of-a-tenant).

A path is segments separated by `/`, such as `Customers/Ada/Invoices/2026-001.pdf`, without a `/` at its start. A segment holds any character but `/` and `\`, and is encoded on its own. A path with an empty segment, a `.` or a `..` is refused before anything is sent.

The client logs in with basic auth on every request. `timeoutInMs` is the HTTP client's five seconds by default, short for a large file over a slow line. `attempts` is once by default. A `put` under `ifMatch` or `ifNoneMatch` is sent once whatever `attempts` says, since a repeat after an answer that got lost would be refused for what the first attempt wrote. A `move` and a new folder are attempted again only after a `429` or `503`, like a `POST`, see [what gets retried](./http-client.md#what-gets-retried).

## Writing and reading a file
`put` writes a file into a folder that exists, as text or bytes, under one of three conditions:

| Condition | The file is written |
|---|---|
| `ifNoneMatch: '*'` | Only where there is none. Fails with a `WebDavPreconditionFailedError` where there is |
| `ifMatch: etag` | Only while it is the version of that ETag. Fails with a `WebDavPreconditionFailedError` for any other version, or no file |
| `overwrite: true` | Whatever is there |

A put names exactly one of them, which the compiler checks. It returns the ETag of what it wrote, or `undefined` when the server names none in its answer, as Apache does:

```ts
// src/services/invoice-mirror.service.ts
import { WebDavClient } from 'zibri';

export async function mirrorInvoice(folder: WebDavClient, invoiceNumber: string, pdf: Buffer): Promise<string | undefined> {
    await folder.createFolder('Invoices/2026');
    return await folder.put(`Invoices/2026/${invoiceNumber}.pdf`, pdf, { contentType: 'application/pdf', ifNoneMatch: '*' });
}
```

An ETag is a version of a file, which the server names and changes with each write. It is kept with its quotes, as the server writes it, such as `"6745a2"`.

`get` reads a file as a stream, with the ETag of what was read. The file may hold as much as `maxBodySizes.stream` of the HTTP client, 10 MB by default, unless `get` names a size of its own:

```ts
// src/services/invoice-download.service.ts
import { WebDavClient, WebDavDownload } from 'zibri';

export async function readInvoice(folder: WebDavClient, path: string): Promise<Buffer> {
    const download: WebDavDownload = await folder.get(path, '50mb');
    return Buffer.concat(await download.content.toArray());
}
```

The text or bytes of a `put` are sent in one request, with their length. A file is held in memory once while it goes out. Bytes read in chunks, such as from a stream, go as an [`HttpClientBufferedBody`](./http-client.md) of the chunks, which sends them as they are, without joining them first.

## Writing only what nobody changed
Keep the ETag a put returns, and write the next version under `ifMatch`. A file somebody changed on the server since has another ETag, and the put fails with a `WebDavPreconditionFailedError` instead of replacing their change:

```ts
// src/services/invoice-update.service.ts
import { WebDavClient, WebDavPreconditionFailedError } from 'zibri';

export async function updateInvoice(folder: WebDavClient, path: string, pdf: Buffer, storedEtag: string): Promise<string | undefined> {
    try {
        return await folder.put(path, pdf, { contentType: 'application/pdf', ifMatch: storedEtag });
    }
    catch (error) {
        if (error instanceof WebDavPreconditionFailedError) {
            // your own handling of a file changed on the server
            return undefined;
        }
        throw error;
    }
}
```

> [!NOTE]
> A server may name a weak ETag, one starting with `W/`, such as Apache for a file changed within the last second. No `ifMatch` matches a weak ETag, so a put under one fails with a `WebDavPreconditionFailedError`.

## Listing a folder
`findEntries` lists the files and folders directly in a folder, one level deep, and `findEntry` finds the one at a path, or `undefined` where there is nothing. `''` is the folder of the connection. Each `WebDavEntry` has its `name`, its `path` relative to the connection, its `kind`, `'file'` or `'folder'`, the `size` of a file, its `etag` and when it was last modified. A server that does not give one of them leaves it `undefined`.

A listing asks for further properties by the name you read each under. Nextcloud keeps a file under an id that stays when the file is renamed or moved:

```ts
// src/services/invoice-listing.service.ts
import { WebDavClient, WebDavEntry } from 'zibri';

export async function findInvoiceIds(folder: WebDavClient): Promise<Map<string, string | undefined>> {
    const entries: WebDavEntry<'fileId'>[] = await folder.findEntries('Invoices/2026', {
        fileId: { namespace: 'http://owncloud.org/ns', name: 'fileid' }
    });
    return new Map(entries.map(entry => [entry.name, entry.properties.fileId]));
}
```

A further property is read as its text, and is `undefined` where the server does not give it, or holds elements rather than text. Its name may not be one of those every entry is read from, such as `getetag`.

`findEntries` fails with a `WebDavNotFoundError` for a folder that does not exist, and with an `InternalError` for a path that is a file. A listing is one answer, without pages, of at most 32 MB, some ten thousand entries.

## Creating folders
`createFolder` creates a folder, with the folders above it that do not exist. A folder that exists is left as it is, and a file where the folder would be fails with a `WebDavConflictError`. A folder whose parent exists takes one request, and each folder above that is missing two more.

A put into a folder that does not exist fails with a `WebDavConflictError`. A file that usually goes into a folder that exists can be put first, and the folders created only for that error.

## Moving and deleting
`move` moves a file or a folder into a folder that exists. `overwrite` is required: with `true` the move replaces what is at the destination, with `false` it fails with a `WebDavPreconditionFailedError` where something is. A file written under a name of its own and moved into place is never seen half written:

```ts
// src/services/export-upload.service.ts
import { WebDavClient } from 'zibri';

export async function uploadExport(folder: WebDavClient, name: string, content: Buffer): Promise<void> {
    await folder.put(`Exports/.${name}.part`, content, { contentType: 'application/zip', overwrite: true });
    await folder.move(`Exports/.${name}.part`, `Exports/${name}`, { overwrite: true });
}
```

`delete` deletes a file, or a folder with everything in it. Both fail with a `WebDavNotFoundError` for a path that holds nothing.

## Handling a refused request
A request the server refuses throws an error of the status it answered with. Each is an `HttpClientError` with the request and the response, and names the `path` it is about:

| Error | Status | Thrown for |
|---|---|---|
| `WebDavNotFoundError` | `404` | A path that holds nothing. Of a `move`, its source |
| `WebDavPreconditionFailedError` | `412` | A put whose condition does not hold, a move without `overwrite` onto something |
| `WebDavConflictError` | `409` | A put, a folder or a move into a folder that does not exist, a folder where a file is |
| `WebDavForbiddenError` | `403` | A request the user may not make, such as a write to a folder shared with them to read |

Any other status, such as a `401` for a wrong password or a `507` for a full storage, throws the `HttpClientError` itself.

## Using Nextcloud
Log in with an app password rather than the password of the user. A user creates one under Settings, Security, Devices and sessions. It works with two factor authentication turned on, and is revoked on its own.

> [!WARNING]
> Nextcloud keeps a file you delete in the trash bin of the user, and what a put or a move replaces as an older version of the file or in the trash bin. Both still take up the storage of the user until Nextcloud expires them, by its `trashbin_retention_obligation` and `versions_retention_obligation`: by default after 30 days at the earliest, and later while the user has space left. Deleting files frees no space before that.

A file of several megabytes is sent in one put, as to any other server. What Nextcloud has beside WebDAV, the id a file keeps when it is moved, the shares and the trash bin, is reached through a [`NextcloudClient`](./nextcloud.md).

## Connecting to the server of a tenant
A tenant can give your application a folder of its own, such as its Nextcloud. Declare `TenantWebDavConnection` in your data source, and let the tenant add it through [the routes of the connections](#letting-tenants-manage-their-connections), or add it through its repository. Its password is [stored encrypted](../data/encryption-and-hashing.md#defining-encryptedhashed-properties), and left out wherever the row is serialized. Create the client of a connection read from the repository with `createForTenant`:

```ts
// src/services/tenant-folder.service.ts
import { TenantWebDavConnection, WebDavClient, WebDavEntry } from 'zibri';

export async function listTenantInvoices(connection: TenantWebDavConnection): Promise<WebDavEntry[]> {
    const folder: WebDavClient = WebDavClient.createForTenant(connection, { timeoutInMs: 30000 });
    return await folder.findEntries('Invoices');
}
```

Each connection has a `kind`, which the tenant chooses: `WEB_DAV` for any WebDAV server, or `NEXTCLOUD` for a Nextcloud, whose url is below `/remote.php/dav/`. Features that reach beyond WebDAV, such as [following a mirrored file somebody moved](./file-mirror.md#following-a-file-somebody-moved), work through a connection of the kind `NEXTCLOUD` alone, whose client `NextcloudClient.createForTenant` creates.

A connection of a tenant reaches public addresses over https only: a host leading to this machine, a private or link-local network, or an address translated into one is refused before the first request of a client, and so is each address a redirect leads to, before it is followed. `ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS` says what they may reach:

| Option | What it is |
|---|---|
| `allowedHosts` | The hosts a connection may reach, each with the hosts below it, such as `example.com`. Any public host by default |
| `allowPrivateNetworks` | Whether a connection may reach the networks the application runs in, and a server over plain http. Off by default |

> [!WARNING]
> With `allowPrivateNetworks`, a tenant can make your application connect to any host inside its network, such as a database or a metadata service. Turn it on only when every tenant is trusted as much as the network is.

## Letting tenants manage their connections
`TenantWebDavConnectionController` holds the routes a tenant lists, adds, changes and deletes its connections with. Extend it with a `@Controller` of your own, at the path you choose, and add it to the `controllers` of your application:

```ts
// src/controllers/web-dav-connections.controller.ts
import { Controller, TenantWebDavConnectionController } from 'zibri';

@Controller('/web-dav-connections')
export class WebDavConnectionsController extends TenantWebDavConnectionController {}
```

| Route | What it does |
|---|---|
| `GET /` | The connections of the tenant, by name: their `id`, `name`, `kind`, `url` and `username` |
| `POST /` | Adds a connection, `{ "name", "kind", "url", "username", "password" }`, once a request to its folder succeeds with it |
| `PATCH /:connectionId` | Changes the `name`, `kind`, `url`, `username` or `password` of a connection. A changed kind, url, username or password is tested first |
| `DELETE /:connectionId` | Deletes a connection nothing uses, and answers `204`. What was written through it stays on the server, such as the events in its calendars |

The password is taken, and never answered. Spread `ZIBRI_WEB_DAV_PERMISSIONS` into your tenant permissions, see [declaring permissions](../auth/roles-and-permissions.md#declaring-permissions):

```ts
// src/models/permissions.ts
import { DefinedPermissions, definePermissions, ZIBRI_PERMISSIONS, ZIBRI_WEB_DAV_PERMISSIONS } from 'zibri';

const PERMISSIONS = [...ZIBRI_PERMISSIONS, ...ZIBRI_WEB_DAV_PERMISSIONS] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
```

| Permission | Lets a member |
|---|---|
| `web-dav-connections.read` | List the connections of the tenant, such as to pick the calendar of a project |
| `web-dav-connections.manage` | Add, change and delete them |

A connection is tested with a `PROPFIND` of its folder, at most 15 seconds long, before it is stored. A url that is no https url, a url of a Nextcloud that is not below `/remote.php/dav/`, a host that may not be reached, a username or password the server refuses, and a url where the server has no folder are each refused with a `400` that says which. A name another connection of the tenant has is refused with a `409`.

## Keeping a connection that is in use
A connection a feature uses, such as the calendar of a project, is not deleted: `DELETE /:connectionId` is refused with a `409`, whose paragraphs name each use. The [projects plugin](../plugins/projects-plugin.md#writing-due-dates-into-a-calendar) keeps a connection while a working calendar names it, and a [backup transport of the tenant](../data/backup.md#letting-a-tenant-back-up-to-its-webdav-server) while it is kept through it.

Events written through a connection keep no connection, and neither do files mirrored through it. Deleting it removes their links, the [mirrored files](./file-mirror.md#deleting-a-connection) and the files queued to mirror in the same transaction, and the events and files stay on the server: a connection whose server is gone for good can be deleted all the same.

A feature of your own keeps the connections it uses with a `TenantWebDavConnectionUsageFinderInterface`, provided with `DiVariants.WEB_DAV_CONNECTION_USAGE_FINDER`:

```ts
// src/services/report-export-usage-finder.service.ts
import { $ts, inject, Injectable, Repository, repositoryTokenFor, TenantWebDavConnection, TenantWebDavConnectionUsageFinderInterface, TranslatedString } from 'zibri';

import { Report } from '../models';

@Injectable()
export class ReportExportUsageFinder implements TenantWebDavConnectionUsageFinderInterface {
    async findUsages(connection: TenantWebDavConnection): Promise<TranslatedString[]> {
        const reports: Repository<Report> = inject(repositoryTokenFor(Report));
        const count: number = await reports.count({ where: { exportConnectionId: connection.id } });
        return count ? [$ts`Reports are exported into it: ${String(count)}.`] : [];
    }
}
```

```ts
// src/providers.ts
import { defineProvider, DiVariants, InjectionToken, TenantWebDavConnectionUsageFinderInterface } from 'zibri';

import { ReportExportUsageFinder } from './services/report-export-usage-finder.service';

defineProvider({
    token: new InjectionToken<TenantWebDavConnectionUsageFinderInterface>('report-export-usage-finder'),
    useClass: ReportExportUsageFinder,
    variants: [DiVariants.WEB_DAV_CONNECTION_USAGE_FINDER]
})
```

Rows of your own that only point at a connection, and can go with it, are removed by a `TenantWebDavConnectionUsageCleanerInterface` provided with `DiVariants.WEB_DAV_CONNECTION_USAGE_CLEANER`. Its `removeUsages` gets the connection and the transaction it is deleted in, and writes through that transaction: when the deletion fails, nothing is removed.

A connection deleted through its repository is deleted whatever uses it, and its rows stay.

## Building on the client
A class extending `WebDavClient` sends requests of its own to the same server, such as to an api of the server beside WebDAV, without logging in or checking hosts again. `resolveRequestOptions` resolves the options every request is sent with: the credentials, the timeout and attempts, and the check of every redirect of a tenant's connection, whose host it checks first. `resolveUrl` resolves the url of a path, `baseUrl` is the url of the folder, and `resolveError` the typed error of a refusal:

```ts
// src/services/cloud-status.client.ts
import { WebDavClient, WebDavRequestOptions } from 'zibri';

export class CloudStatusClient extends WebDavClient {
    async findStatus(): Promise<unknown> {
        const options: WebDavRequestOptions = await this.resolveRequestOptions();
        try {
            return (await this.httpClient.get(`${this.baseUrl.origin}/status.php`, options)).rawBody;
        }
        catch (error) {
            throw WebDavClient.resolveError('', error);
        }
    }
}
```

`request` of the HTTP client sends the methods of WebDAV as a `WebDavMethod`, such as `WebDavMethod.REPORT` for a query of a calendar, and `resolveEntries` reads the entries of a multistatus answer of one, such as of a `SEARCH`. `createForTenant` of a class of your own creates it with what `resolveTenantNetwork` resolves, which checks the hosts of a tenant's connection. [`NextcloudClient`](./nextcloud.md) is such a class.

## Requirements
| Package | Used for |
|---|---|
| `saxes` | Reading the listings of a folder. You install it |

Your data source declares this entity:

| Entity | Needed when |
|---|---|
| `TenantWebDavConnection` | Tenants [connect to servers of their own](#connecting-to-the-server-of-a-tenant), or a controller extends `TenantWebDavConnectionController` |

## See also
- [Projects plugin](../plugins/projects-plugin.md#writing-due-dates-into-a-calendar) — the calendars of projects, reached through the connections of a tenant
- [Calendar sync](./calendar-sync.md) — the events written through a connection
- [Mirroring files into a folder](./file-mirror.md) — the files written through a connection
- [Nextcloud](./nextcloud.md) — what Nextcloud has beside WebDAV: the id of a file, and share links
- [HTTP client](./http-client.md) — the timeout, retries and redirects every request goes through
- [XML](./xml.md) — reading and writing XML documents
- [Encryption and hashing](../data/encryption-and-hashing.md) — the key the password of a tenant's connection is encrypted with
- [Backup](../data/backup.md#storing-backups-on-a-webdav-server) — backups in a folder of a WebDAV server, and the same checks of hosts for the storage of a tenant
