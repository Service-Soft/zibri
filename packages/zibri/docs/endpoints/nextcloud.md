---
keywords: [nextcloud, ocs, share api, public link, share link, revoke, oc:fileid, file id, dav search, rfc 5323, owncloud, trash bin, trashbin, share with user, share with group, permissions]
---

# Nextcloud
Nextcloud is a self-hosted cloud for files, calendars and contacts, which it serves over [WebDAV](./web-dav.md). `NextcloudClient` is a `WebDavClient` that also reaches what Nextcloud has beside WebDAV: the id a file keeps when somebody renames or moves it, a search for a file by that id, the share api, which shares a file or a folder by a link or with users and groups, changes and deletes the share again, and the trash bin, which keeps what is deleted. The [file mirror](./file-mirror.md) finds moved files, and shares folders and revokes their links, through it, and the [Nextcloud backup transport](../data/backup.md#storing-backups-on-nextcloud) keeps its folder read-only and its trash bin empty.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `NextcloudClient` | class | A `WebDavClient` of a Nextcloud that finds a file by its id with `findEntryByFileId`, writes a file with its checksum with `putWithChecksum` and tells it with `holdsChecksum`, creates a share with `createShare`, finds shares with `findShare` and `findShares`, changes one with `updateShare`, deletes one with `deleteShare`, and finds and deletes what the trash bin holds with `findTrashBinEntries` and `deleteTrashBinEntry` |
| `NewNextcloudShare` | type | A share to create: a link of a `path` to read, with its `password` and `expiresOn`, or a share of a `path` with a `'user'` or a `'group'`, `shareWith`, and its `permissions` |
| `NewNextcloudLinkShare` | type | A share by link to create: its `path`, `password` and `expiresOn` |
| `NewNextcloudRecipientShare` | type | A share with a `'user'` or a `'group'` to create: its `path`, `shareWith` and `permissions` |
| `NextcloudShareChange` | type | A change of a share: its `permissions` |
| `NextcloudTrashBinEntry` | type | A file or a folder in the trash bin: its `id` there, the `user`, its `originalPath`, `kind`, `size` and `deletedAt` |
| `NextcloudShare` | type | A share as Nextcloud answers it: its `id`, `type`, `permissions`, `url`, `shareWith` and `expiresOn` |
| `NextcloudShareType` | type | Who a share is for: `'user'`, `'group'`, `'link'` or `'other'` |
| `WebDavConnectionKind` | enum | What server a connection of a [tenant](../glossary.md#tenant) reaches: `WEB_DAV` or `NEXTCLOUD` |

## Connecting to a Nextcloud
`NextcloudClient` takes the same options as a `WebDavClient`. Its url is below `/remote.php/dav/` of the server: the WebDAV root, `https://cloud.example.com/remote.php/dav/`, which reaches the files of a user as `files/<user>/` and the calendars as `calendars/<user>/`, or a folder below it, such as the files of Ada at `https://cloud.example.com/remote.php/dav/files/ada/`. A Nextcloud installed in a folder of its server, such as `/nextcloud/`, is reached below it. Any other url throws an `InternalError` as the client is created:

```ts
// src/services/accounting-cloud.service.ts
import { NextcloudClient } from 'zibri';

export function createAccountingCloud(appPassword: string): NextcloudClient {
    return new NextcloudClient({
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

Log in with an app password, see [using Nextcloud](./web-dav.md#using-nextcloud). A tenant says that its connection is to a Nextcloud with the kind `NEXTCLOUD`, and the routes of the connections refuse one whose url is not below `/remote.php/dav/`. Create the client of such a connection with `NextcloudClient.createForTenant`, which checks its hosts as `WebDavClient.createForTenant` does, see [connecting to the server of a tenant](./web-dav.md#connecting-to-the-server-of-a-tenant).

## Finding a file after it is moved
Nextcloud keeps a file under an id that stays when somebody renames or moves it. A listing names it as the further property `NextcloudClient.FILE_ID_PROPERTY`, and `findEntryByFileId` finds the file by it, wherever it is in the files of its user:

```ts
// src/services/contract-finder.service.ts
import { NextcloudClient, WebDavEntry } from 'zibri';

export async function findContractId(cloud: NextcloudClient, path: string): Promise<string | undefined> {
    const entry: WebDavEntry<'fileId'> | undefined = await cloud.findEntry(path, { fileId: NextcloudClient.FILE_ID_PROPERTY });
    return entry?.properties.fileId;
}

export async function findContractPath(cloud: NextcloudClient, fileId: string, formerPath: string): Promise<string | undefined> {
    const found: WebDavEntry<'fileId'> | undefined = await cloud.findEntryByFileId(fileId, formerPath);
    return found?.path;
}
```

Keep the id with what you know of the file. The search is a `SEARCH` of WebDAV (RFC 5323), which Nextcloud answers for the files of a user. Its second argument is a path the file was at, which names the user whose files are searched. A file moved out of the folder of the connection, or into the trash bin, is not found, and the answer is `undefined`. A path that is not among the files of a user, such as one of a calendar, throws an `InternalError`.

## Telling a change by its checksum
Nextcloud names the same ETag for a change made in the second of the write before, so an `If-Match` lets it through. `putWithChecksum` writes a file with the SHA-256 of what it holds, which Nextcloud keeps with the file. A later write names its own checksum, or none, which leaves the file without one. `NextcloudClient.CHECKSUMS_PROPERTY` reads it back, and `holdsChecksum` tells whether a file still holds what you wrote:

```ts
// src/services/contract-upload.service.ts
import { createHash } from 'node:crypto';

import { NextcloudClient, WebDavEntry } from 'zibri';

export async function uploadContract(cloud: NextcloudClient, path: string, content: Buffer): Promise<string> {
    const sha256: string = createHash('sha256').update(content).digest('hex');
    await cloud.putWithChecksum(path, content, { contentType: 'application/pdf', overwrite: true }, sha256);
    return sha256;
}

export async function isUnchanged(cloud: NextcloudClient, path: string, sha256: string): Promise<boolean> {
    const entry: WebDavEntry<'checksums'> | undefined = await cloud.findEntry(path, { checksums: NextcloudClient.CHECKSUMS_PROPERTY });
    return NextcloudClient.holdsChecksum(entry?.properties.checksums, sha256);
}
```

The [file mirror](./file-mirror.md#handling-a-file-somebody-changed) writes every file this way.

## Sharing a file or a folder by link
`createShare` shares a file or a folder by a link anyone who has it reads, and changes nothing:

```ts
// src/services/customer-share.service.ts
import { NextcloudClient, NextcloudShare } from 'zibri';

export async function shareOffer(cloud: NextcloudClient, customer: string): Promise<string | undefined> {
    const share: NextcloudShare = await cloud.createShare({
        type: 'link',
        path: `Customers/${customer}/Offers`,
        password: 'Analytical-Engine-1843', // the password the customer gets
        expiresOn: '2027-01-31'
    });
    return share.url;
}
```

The path is relative to the url of the connection, and among the files of the user of the connection. `password` and `expiresOn` are required, `undefined` for none. A link expires at the end of the day of `expiresOn`. Nextcloud refuses a password its policy refuses, a link without one where its settings ask for a password, and a day past the latest its settings allow, each with the `HttpClientError` of its answer. A path that holds nothing fails with a `WebDavNotFoundError`, and an `expiresOn` that is no day written as `2027-01-31` with an `InternalError`.

`findShare` finds a share by its `id`, and answers `undefined` for one somebody deleted in Nextcloud, or that expired. Each call of `createShare` creates another share. To answer the same link for the same folder every time, keep its id, as `resolveShareLink` of the [file mirror](./file-mirror.md#sharing-a-folder-by-link) does.

`deleteShare` deletes a share by its `id`, and the link opens nothing from then on. A share Nextcloud does not have, such as one somebody deleted already, counts as deleted. A share the user of the connection may not delete fails with a `WebDavForbiddenError`.

## Sharing a folder with users and groups
`createShare` with the type `'user'` or `'group'` shares a file or a folder with a user or a group of the same Nextcloud, who find it among their own files and sync it to their devices. `permissions` is required, as Nextcloud's sum of 1 to read, 2 to change, 4 to create, 8 to delete and 16 to share on:

```ts
// src/services/reports-share.service.ts
import { NextcloudClient, NextcloudShare } from 'zibri';

export async function shareReports(cloud: NextcloudClient): Promise<NextcloudShare[]> {
    await cloud.createShare({ type: 'group', path: 'Reports', shareWith: 'accounting', permissions: 1 });
    const shares: NextcloudShare[] = await cloud.findShares('Reports');
    return await Promise.all(shares
        .filter(share => share.type === 'user' && share.permissions !== 1)
        .map(async share => await cloud.updateShare(share.id, { permissions: 1 })));
}
```

Nextcloud shares a path with a user or a group once, and refuses a second share with the `HttpClientError` of its answer, as it does a user or a group it does not have. `findShares` finds every share of a file or a folder, those a user it was shared with created as well, and none of the files and folders in it. A path that holds nothing fails with a `WebDavNotFoundError`. `updateShare` changes what a share permits and answers with the share, and fails with a `WebDavNotFoundError` for a share Nextcloud does not have.

## Deleting from the trash bin
Nextcloud keeps what is deleted in the trash bin of its user, where it takes up the storage of the user until Nextcloud expires it. `findTrashBinEntries` finds what the trash bin holds that was deleted from within a folder, the folder itself included, and `deleteTrashBinEntry` deletes one for good:

```ts
// src/services/export-cleanup.service.ts
import { NextcloudClient, NextcloudTrashBinEntry } from 'zibri';

export async function deleteExportsForGood(cloud: NextcloudClient): Promise<void> {
    await cloud.delete('Exports/2026');
    const trashed: NextcloudTrashBinEntry[] = await cloud.findTrashBinEntries('Exports');
    await Promise.all(trashed
        .filter(entry => entry.originalPath === 'Exports/2026')
        .map(async entry => await cloud.deleteTrashBinEntry(entry)));
}
```

An entry names where it was as `originalPath`, relative to the url of the connection, and when it was deleted as `deletedAt`. A folder deleted with what it held is one entry. The folder of `findTrashBinEntries` is among the files of the user whose trash bin is read, and a Nextcloud without its trash bin answers with none. An entry the trash bin does not hold, such as one Nextcloud expired, counts as deleted.

## Building on the client
A class extending `NextcloudClient` sends requests of its own to the OCS api of the same server, such as for the users and groups of the provisioning api, with what a [class building on a WebDAV client](./web-dav.md#building-on-the-client) has. `resolveOcsUrl` resolves a path below `/ocs/v2.php/`, the OCS api whose answers carry their status in the HTTP status too, and `resolveOcsHeaders` the headers its requests are sent with, the credentials among them.

## Requirements
| Package | Used for |
|---|---|
| `saxes` | Reading the listings and searches of a folder. You install it |

## See also
- [WebDAV](./web-dav.md) — the client this one builds on, and the connections of tenants
- [Mirroring files into a folder](./file-mirror.md) — files of your application written into a folder, found again and shared
- [Backup](../data/backup.md#storing-backups-on-nextcloud) — backups in a folder of a Nextcloud, read-only for everyone but your application
- [HTTP client](./http-client.md) — the timeout, retries and redirects every request goes through
