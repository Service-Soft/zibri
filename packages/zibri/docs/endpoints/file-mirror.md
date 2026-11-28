---
keywords: [mirror, nextcloud, webdav, shared folder, invoices folder, upload, etag, if-match, conflict, overwrite, share link, public link, revoke, oc:fileid]
---

# Mirroring files into a folder
The file mirror writes files of your application into a folder of a WebDAV server, such as the pdf of each invoice into the folder of its customer on the Nextcloud of a [tenant](../glossary.md#tenant). People find the documents in the folder they already work and share from. The mirror writes and never deletes. A file somebody changed in the folder is left as it is, and the conflict recorded until somebody overwrites the file or stops mirroring it. Through a connection to a Nextcloud, a file somebody moved is found again where it is, and a folder is shared by a link that can be revoked.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `FileMirrorServiceInterface`, `FileMirrorService` | interface, class | Queues a file to mirror with `mirrorFile`, finds the mirrored files of a row with `findMirroredFiles` and those in conflict with `findConflicts`, resolves a conflict with `resolveConflict`, and shares a folder with `resolveShareLink` and `revokeShareLink`. Replaceable through `ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE` |
| `ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE` | DI token | Injects `FileMirrorServiceInterface` |
| `FileToMirror` | type | A file to mirror: the `connectionId`, the `path`, its `content` and `contentType`, and its `source` |
| `FileMirrorSource` | type | The row a file is of: its `type`, such as `invoice`, and its `id` |
| `MirroredFile` | entity | A mirrored file: its `path`, where it is now as `currentPath`, the `etag` and `contentHash` written last, `mirroredAt`, and its `conflict` |
| `MirroredFileConflict` | enum | Why a file was not written: `CHANGED` or `MISSING` |
| `MirroredFileConflictResolution` | enum | How a conflict is resolved: `OVERWRITE` or `STOP_MIRRORING` |
| `FileMirrorController` | class | The routes a tenant [resolves conflicts and shares folders](#letting-tenants-resolve-conflicts-and-share-folders) with, which your controller extends |
| `ZIBRI_FILE_MIRROR_PERMISSIONS`, `ZibriFileMirrorPermissions` | constant, constant | `file-mirror.read` and `file-mirror.manage`, to spread into your tenant permissions, and the same by name |
| `FileMirrorRequest` | entity | A file queued to mirror, with its content, until it is written. The newest version of a file in conflict is kept until the conflict is resolved |
| `FileMirrorCronJob` | cron job | Writes the queued files, and again after a failed attempt. Registered for you |
| `FileMirrorShareLink`, `FileMirrorShareLinkOptions` | entity, type | A link a folder or a file is shared by, and what one is asked for with |
| `MirroredFileConflictResolutionInput`, `FileMirrorShareLinkInput` | class, class | What the routes resolving a conflict and asking for a share link take |
| `ZIBRI_FILE_MIRROR_LIMITS` | constant | The most conflicts a page holds, and the longest path and password of a share link the routes take |
| `FileMirrorUsageCleaner` | class | Removes the rows of a connection that is deleted. Registered for you as `ZIBRI_DI_TOKENS.FILE_MIRROR_USAGE_CLEANER` |

## Setting up the mirror
Declare `MirroredFile`, `FileMirrorRequest` and `TenantWebDavConnection` in your data source, and `FileMirrorShareLink` to share folders by link. A tenant adds the folder it mirrors into as a [connection](./web-dav.md#letting-tenants-manage-their-connections) of the kind `WEB_DAV` for any WebDAV server, or `NEXTCLOUD` for a Nextcloud. For a Nextcloud, its url is `https://cloud.example.com/remote.php/dav/`, and the files of Ada are below `files/ada/`.

Declare `FileMirrorRequest` in the data source of the rows whose transactions queue files, such as the data source of `Invoice`.

## Mirroring a file
`mirrorFile` queues a file in the transaction you pass it. Once the transaction is committed, `FileMirrorCronJob` writes the file into its folder, on whichever instance picks it up, and creates the folders it is in where they are missing. A transaction rolled back takes the file with it, and nothing is written:

```ts
// src/services/report-mirror.service.ts
import { FileMirrorServiceInterface, inject, RepositoryTransaction, ZIBRI_DI_TOKENS } from 'zibri';

import { Report } from '../models';

export async function mirrorReport(report: Report, connectionId: string, pdf: Buffer, transaction: RepositoryTransaction): Promise<void> {
    const mirror: FileMirrorServiceInterface = inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE);
    await mirror.mirrorFile({
        connectionId,
        path: `files/ada/Reports/${report.title}.pdf`, // a folder of your own
        content: pdf,
        contentType: 'application/pdf',
        source: { type: 'report', id: report.id }
    }, transaction);
}
```

Call it in the tenant the file belongs to, whose connection `connectionId` names. Pass `undefined` as the transaction to queue the file at once. The path is relative to the url of the connection, its segments separated by `/`. A connection the tenant does not have fails with a `NotFoundError`, and a path with an empty segment, a `.` or a `..` with an `InternalError`, both at the call. A file holds at most 50 MB.

Each path is one file, which the newest call writes. Mirroring the same content again writes nothing, and a new content replaces the file under `If-Match` of the ETag written last, see [handling a file somebody changed](#handling-a-file-somebody-changed). An attempt that fails, such as while the server is down, is tried again after a minute, then after two, four and on, 14 times in all over some six days. A file that spent its attempts is kept as a `FileMirrorRequest` with the error it failed with, until a later version of the same path is written.

`findMirroredFiles` finds what was mirrored of a row, a `MirroredFile` per connection and path.

## Mirroring an invoice once it is issued
The invoicing plugin hands every invoice a write issues to each [posting](../plugins/invoicing-plugin.md#booking-issued-invoices), in the transaction of the write. A posting of yours mirrors its pdf into the folder of the customer:

```ts
// src/services/invoice-mirror.posting.ts
import { FileMirrorServiceInterface, inject, Injectable, Invoice, InvoicePdfServiceInterface, InvoicePostingInterface, PdfDocument, Repository, repositoryTokenFor, RepositoryTransaction, TenantWebDavConnection, WebDavConnectionKind, ZIBRI_DI_TOKENS, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

@Injectable()
export class InvoiceMirrorPosting implements InvoicePostingInterface {
    async postIssuedInvoices(invoices: Invoice[], transaction: RepositoryTransaction): Promise<void> {
        const pdfService: InvoicePdfServiceInterface<Invoice> = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PDF_SERVICE);
        const mirror: FileMirrorServiceInterface = inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE);
        const connections: Repository<TenantWebDavConnection> = inject(repositoryTokenFor(TenantWebDavConnection));
        for (const invoice of invoices) {
            await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(invoice.tenantId, async () => {
                const nextcloud: TenantWebDavConnection | undefined = await connections.findOne({ where: { kind: WebDavConnectionKind.NEXTCLOUD }, required: false });
                if (nextcloud == undefined) {
                    return;
                }
                const document: PdfDocument = await pdfService.generateInvoicePdf(invoice, 'de', 'Europe/Berlin', undefined, undefined);
                document.end();
                const customer: string = `${invoice.customerAddressData.firstName} ${invoice.customerAddressData.lastName}`;
                await mirror.mirrorFile({
                    connectionId: nextcloud.id,
                    path: `files/accounting/Customers/${customer}/Invoices/${invoice.number}.pdf`, // the folders of your own
                    content: Buffer.concat(await document.toArray()),
                    contentType: 'application/pdf',
                    source: { type: 'invoice', id: invoice.id }
                }, transaction);
            });
        }
    }
}
```

```ts
// src/providers.ts
import { defineProvider, InjectionToken, INVOICE_POSTING_DI_VARIANT, InvoicePostingInterface } from 'zibri';

import { InvoiceMirrorPosting } from './services/invoice-mirror.posting';

defineProvider({
    token: new InjectionToken<InvoicePostingInterface>('invoice-mirror-posting'),
    useClass: InvoiceMirrorPosting,
    variants: [INVOICE_POSTING_DI_VARIANT]
})
```

What a posting throws refuses the write, so a pdf that cannot be rendered keeps the invoice from being issued. The file is written once the invoice is.

## Handling a file somebody changed
A file is created under `If-None-Match: *`, and written again under `If-Match` of the ETag written last. A file somebody changed in the folder has another ETag, and is left as it is. Its `MirroredFile` keeps the version written last and records the conflict, `CHANGED`, with `conflictAt`, and a warning is logged:

| `conflict` | The file |
|---|---|
| `CHANGED` | Was changed in the folder since it was mirrored, or another file was where it is mirrored to first |
| `MISSING` | Is gone from where it was mirrored to, and was not found again |
| `null` | Holds what was mirrored last |

`findConflicts` finds a page of the mirrored files of the tenant with a conflict, the latest first, such as to show them to whoever works in the folder. The next version mirrored tries again, and clears the conflict once it is written. A file in the folder that holds exactly what is mirrored is taken as written, whatever its ETag. Until then, the newest version mirrored of the file is kept as a `FileMirrorRequest`, see [resolving a conflict](#resolving-a-conflict).

The mirror deletes nothing, and writes no second copy beside a file somebody changed.

## Resolving a conflict
`resolveConflict` resolves the conflict of a mirrored file in one of two ways, `MirroredFileConflictResolution.OVERWRITE` or `STOP_MIRRORING`:

```ts
// src/services/invoice-conflict.service.ts
import { FileMirrorServiceInterface, inject, MirroredFileConflictResolution, ZIBRI_DI_TOKENS } from 'zibri';

export async function overwriteInvoiceFile(mirroredFileId: string): Promise<void> {
    const mirror: FileMirrorServiceInterface = inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE);
    await mirror.resolveConflict(mirroredFileId, MirroredFileConflictResolution.OVERWRITE);
}
```

| Resolution | What happens |
|---|---|
| `OVERWRITE` | The newest version mirrored of the file replaces what is in the folder, without a condition, and the conflict is cleared. Through a connection of the kind `NEXTCLOUD`, it is written where the id of the file says it is now. A file that is `MISSING` is put back where it was mirrored to, with the folders it is in |
| `STOP_MIRRORING` | The `MirroredFile` and the versions queued of it are deleted, and the folder stays as it is. A later version mirrored to the same path is a new file: it is created only where nothing is, and is `CHANGED` otherwise |

Call it in the tenant of the file. A file without a conflict is refused with a `400`, and so is an `OVERWRITE` once no version of the file is kept, such as when it was deleted by hand: mirror the file again. A server that refuses the file or cannot be reached fails with the `HttpClientError` of its answer, and leaves the conflict as it was.

> [!WARNING]
> `OVERWRITE` replaces what somebody wrote into the file in the folder. Whether it is kept is up to the server: Nextcloud keeps it as an older version of the file.

## Following a file somebody moved
A file somebody moved, renamed or deleted in the folder is gone from where it was mirrored to. Through a connection of the kind `WEB_DAV`, the next version records the conflict `MISSING`, and is not written where the file was.

Through a connection of the kind `NEXTCLOUD`, the file is found again by the id Nextcloud keeps it under, see [finding a file after it is moved](./nextcloud.md#finding-a-file-after-it-is-moved). The next version is written where the file is now, under the same condition, and `currentPath` says where that is. A file moved out of the folder of the connection, or into the trash bin, is `MISSING`.

## Sharing a folder by link
`resolveShareLink` answers a link Nextcloud shares a folder or a file by, to read, such as the folder of a customer to send them:

```ts
// src/services/customer-folder.service.ts
import { FileMirrorServiceInterface, FileMirrorShareLink, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function shareCustomerFolder(connectionId: string, customer: string): Promise<string> {
    const mirror: FileMirrorServiceInterface = inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE);
    const link: FileMirrorShareLink = await mirror.resolveShareLink({
        connectionId,
        path: `files/accounting/Customers/${customer}`,
        password: undefined,
        expiresOn: '2027-01-31'
    });
    return link.url;
}
```

The link is a `FileMirrorShareLink`, one per connection and path. Asking for the same path again answers the same link while Nextcloud has its share, and creates a new one once somebody deleted it in Nextcloud or it expired. `password` and `expiresOn` are required, `undefined` for none, and apply to a link the call creates. The path of a mirrored file finds the file where somebody moved it.

A connection of the kind `WEB_DAV` and a path with an empty segment, a `.` or a `..` are refused with a `400`, a path that holds nothing with a `WebDavNotFoundError`, and a password or an expiry Nextcloud refuses with the `HttpClientError` of its answer.

> [!WARNING]
> Anyone who has the link reads what the folder holds, every file mirrored into it later included. Give it a password and an expiry where the folder holds more than the customer may read.

## Revoking a share link
`revokeShareLink` revokes the link of a path, such as once the customer has what they needed:

```ts
// src/services/customer-folder-revocation.service.ts
import { FileMirrorServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function revokeCustomerFolder(connectionId: string, customer: string): Promise<void> {
    const mirror: FileMirrorServiceInterface = inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE);
    await mirror.revokeShareLink(connectionId, `files/accounting/Customers/${customer}`);
}
```

It deletes the share in Nextcloud, then the `FileMirrorShareLink`, so the link opens nothing. A share somebody deleted in Nextcloud already counts as deleted, and a path without a link is left as it is. A Nextcloud that refuses or cannot be reached fails with the `HttpClientError` of its answer, and the link stays, to revoke again. The next link asked for the path is a new one, with another url.

## Letting tenants resolve conflicts and share folders
`FileMirrorController` holds the routes a tenant lists and resolves its conflicts with, and shares and revokes links of folders. Extend it with a `@Controller` of your own, at the path you choose, and add it to the `controllers` of your application:

```ts
// src/controllers/tenant-file-mirror.controller.ts
import { Controller, FileMirrorController } from 'zibri';

@Controller('/file-mirror')
export class TenantFileMirrorController extends FileMirrorController {}
```

| Route | What it does |
|---|---|
| `GET /conflicts?page=1&limit=20` | A page of the mirrored files of the tenant in conflict, the latest first, as a `PaginationResult` of `MirroredFile`. A page holds at most 100 |
| `POST /conflicts/:mirroredFileId/resolution` | [Resolves a conflict](#resolving-a-conflict), `{ "resolution": "OVERWRITE" }` or `{ "resolution": "STOP_MIRRORING" }`, and answers `204` |
| `POST /share-links` | Answers the [link of a path](#sharing-a-folder-by-link), `{ "connectionId", "path", "password", "expiresOn" }`, created where there is none. `password` and `expiresOn` may be left out |
| `DELETE /share-links?connectionId=...&path=...` | [Revokes the link](#revoking-a-share-link) of a path, and answers `204` |

Spread `ZIBRI_FILE_MIRROR_PERMISSIONS` into your tenant permissions, see [declaring permissions](../auth/roles-and-permissions.md#declaring-permissions):

```ts
// src/models/permissions.ts
import { DefinedPermissions, definePermissions, ZIBRI_FILE_MIRROR_PERMISSIONS, ZIBRI_PERMISSIONS } from 'zibri';

const PERMISSIONS = [...ZIBRI_PERMISSIONS, ...ZIBRI_FILE_MIRROR_PERMISSIONS] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
```

| Permission | Lets a member |
|---|---|
| `file-mirror.read` | List the conflicts of the tenant |
| `file-mirror.manage` | Resolve them, ask for the share link of a path and revoke one |

A file without a conflict, a resolution, path or expiry that is none, and a connection that is not to a Nextcloud are refused with a `400`, a mirrored file or a connection the tenant does not have, and a path the server has nothing at, with a `404`. What the server refuses is a `400` that names its status, and a server that cannot be reached a `503`. `ZIBRI_FILE_MIRROR_LIMITS` holds the most conflicts a page holds and the longest path and password the routes take.

## Deleting a connection
A connection that is deleted through the [routes of the connections](./web-dav.md#keeping-a-connection-that-is-in-use) takes its mirrored files, its queued files and its share links with it, in the same transaction. The files and the shares stay on the server.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `MirroredFile`, `FileMirrorRequest`, `TenantWebDavConnection` | Files are mirrored, or a controller extends `FileMirrorController` |
| `FileMirrorShareLink` | `resolveShareLink` or `revokeShareLink` is called, or a controller extends `FileMirrorController` |

## See also
- [WebDAV](./web-dav.md) — the connections of tenants, and the client files are written with
- [Nextcloud](./nextcloud.md) — the client a file is found again and a folder shared with
- [Invoicing plugin](../plugins/invoicing-plugin.md#booking-issued-invoices) — the postings an issued invoice is handed to
- [Background work](../background-work/background-work.md) — the queues the files are written from
