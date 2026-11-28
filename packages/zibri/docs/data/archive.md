---
keywords: [archiving, retention, retention period, gobd, § 147 ao, documents, receipts, bank statements, invoices, worm, records management, compliance]
---

# Archiving documents
An archived entity is a type of document, such as a receipt or a bank statement, whose rows and files are kept unchanged for a retention period. The repository refuses to change a row, and refuses to delete it or its files before its retention ends. The rows of each [tenant](../glossary.md#tenant) form a [hash chain](../glossary.md#hash-chain) that covers the SHA-256 of their files, so checking the archive tells a changed row, a removed row and a changed file. Files can be copied into further stores, which a read falls back to. Once the retention of a row ends, pruning deletes it with its files. Use it for documents a law asks you to keep, such as the receipts and invoices behind the books, which GoBD and § 147 AO want kept for years.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Archive` | decorator | Archives the rows of an entity for their retention, counted from the end of the year by default |
| `BaseArchivedEntity` | class | The base of an archived entity, holding `retainUntil` and `archivedFiles`, which the repository fills in when a row is created |
| `ArchiveServiceInterface`, `ZIBRI_DI_TOKENS.ARCHIVE_SERVICE` | interface, DI token | Checks the archive, finds and prunes the rows whose retention ended, and reads a file from the first copy that holds |
| `ArchiveService` | class | The default implementation. Replaceable through `ZIBRI_DI_TOKENS.ARCHIVE_SERVICE` |
| `ArchivePruneCronJob` | cron job | Prunes the archive once a day. Listed in `cronJobs` by you |
| `ArchiveRetentionError` | error | What deleting a row before its retention ended fails with, a `409` naming the row and its `retainUntil` |
| `ArchiveOptions`, `ArchiveRetention`, `ArchiveRetentionStart` | type, type, type | What `@Archive` takes: the `retention` in years, months and days, what it is counted `from`, the `dateProperty` and the `copies` |
| `ArchivedFile` | class | A file of an archived row as the row recorded it: the `id` of its `FileRecord`, its `sha256` and the ids of its `copies` |
| `ArchiveVerification`, `ArchivedChainVerification` | type, type | What checking the archive found, and what checking the chain of one tenant found |
| `ArchivedFileProblem`, `ArchivedFileProblemReason` | type, type | A file or copy that does not hold, and why: `'missing'`, `'changed'` or `'unreadable'` |
| `ArchiveVerificationOptions`, `ArchiveFindDueOptions` | type, type | Which entity and tenant `resolveVerification` checks, and how many rows of which tenants `findDue` finds |
| `ArchiveData` | type | What `resolveArchiveData` fills in on a row about to be created |
| `ChainGap` | entity | A row removed from inside its chain once its retention ended, which checking the chain steps over |

## Archiving a type of document
Declare the entity with `@Entity({ chained: true })` and `@Archive`, and extend `BaseArchivedEntity`:

```ts
// src/models/receipt.model.ts
import { Archive, BaseArchivedEntity, Entity, MimeType, OmitClass, Property } from 'zibri';

@Entity({ chained: true })
@Archive({ retention: { years: 8 }, dateProperty: 'issuedAt', copies: ['offsite'] })
export class Receipt extends BaseArchivedEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    title!: string;

    @Property.date()
    issuedAt!: Date;

    @Property.file({ store: 'documents', allowedMimeTypes: [MimeType.PDF, MimeType.PNG, MimeType.JPEG], maxSize: '10mb' })
    scan!: string;
}

export class ReceiptCreateDTO extends OmitClass(Receipt, ['id', 'tenantId', 'chainSequence', 'chainHash', 'retainUntil', 'archivedFiles']) {}
```

| Option | What it is |
|---|---|
| `retention` | How long each row is kept, in whole `years`, `months` and `days`, such as `{ years: 10 }`. Required |
| `from` | What the retention is counted from: `'endOfYear'`, the end of the calendar year the date falls in, or `'date'`, the date itself. `'endOfYear'` by default |
| `dateProperty` | The date property the retention is counted from, such as `issuedAt`. When the row is created by default |
| `copies` | The [file stores](./files.md#registering-a-file-store) each file of a row is copied into when the row is created, such as `['offsite']`. None by default |

An archived entity is a [chained entity](./tamper-evident-tables.md#chaining-the-rows-of-each-tenant) with the same rules: it declares no encrypted or hashed property, is kept in one data source and takes no time of the data source. Its files are [kept in a file store](./files.md#keeping-the-files-of-an-entity-in-a-file-store) like those of any entity, and its data source declares `ChainAnchor`, `ChainGap` and `FileRecord`.

A `CrudController` of the entity creates a row and its files from a multipart body, and serves each file at its download route:

```ts
// src/controllers/receipt.controller.ts
import { Controller, CrudController, PartialClass } from 'zibri';

import { Receipt, ReceiptCreateDTO } from '../models/receipt.model';

@Controller('/receipts')
export class ReceiptController extends CrudController(Receipt, ReceiptCreateDTO, PartialClass(ReceiptCreateDTO)) {}
```

## Counting the retention
When a row is created, the repository fills in `retainUntil`: the first moment its retention has ended and it may be deleted. By default, the retention counts from the end of the calendar year the row's date falls in, as § 147 AO counts it. A receipt issued in March 2026 and kept for 8 years has a `retainUntil` of the first moment of 2035, the end of 2034. With `from: 'date'`, it counts from the date itself, so the same receipt is kept until March 2034.

The year ends, and months and days are counted, on the calendar of the `defaultTimezone` of the [localize options](../templates/localization.md). With `Europe/Berlin`, a receipt issued at 23:30 UTC on New Year's Eve falls in the next year.

## Keeping a row longer or shorter
A row created with a `retainUntil` of its own keeps that one, longer or shorter than the retention of its type:

```ts
// src/services/contract-receipt.function.ts
import { Repository } from 'zibri';

import { Receipt } from '../models/receipt.model';

export async function archiveContractReceipt(receipts: Repository<Receipt>, scan: string): Promise<Receipt> {
    return await receipts.create({
        title: 'Maintenance contract',
        issuedAt: new Date('2026-03-01T00:00:00Z'),
        scan,
        // the end of the contract, and three years beyond
        retainUntil: new Date('2040-01-01T00:00:00Z')
    });
}
```

A `CrudController` takes one when its create DTO declares `retainUntil`. Once the row is created, its `retainUntil` is never changed.

## Changing and deleting archived rows
A row of an archived entity is only created. Every update, through the repository or a `CrudController`, is refused with a `409`. A delete of a row before its `retainUntil` is refused with an `ArchiveRetentionError`, a `409` naming the row and when it may be deleted:

```json
{
    "message": "The Receipt \"0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90\" is archived until 2035-01-01T00:00:00.000Z, and can be deleted from then on."
}
```

This holds for every data source and every way a repository writes a row. Once the retention of a row has ended, `deleteById` and `deleteAll` delete it, and its files and their copies with it. Its chain records the row as removed, which checking the chain steps over.

## Keeping copies of the files
With `copies`, each file of a row is copied into the stores it names when the row is created, in the transaction the row is written in. Each copy is a `FileRecord` of its own, and `archivedFiles` of the row names the ids of the copies of each file. A row whose file does not match its SHA-256 is not created.

`readFile` of the archive service reads a file from the first of the file and its copies whose bytes match their SHA-256:

```ts
// src/services/receipt-scan.function.ts
import { Readable } from 'node:stream';

import { ArchiveServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

import { Receipt } from '../models/receipt.model';

export async function readReceiptScan(receipt: Receipt): Promise<Readable> {
    const archive: ArchiveServiceInterface = inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE);
    return await archive.readFile(receipt, receipt.scan);
}
```

The bytes are read onto the disk of this instance and checked before the stream is handed over. The download route of a `CrudController` reads the files of an archived entity this way, so a file whose bytes changed in one store is served from a copy. A read that falls back logs a warning naming the file.

## Checking the archive
`resolveVerification` checks the chain of every tenant, and reads every file and copy the rows recorded:

```ts
// src/services/archive-check.function.ts
import { ArchiveServiceInterface, ArchiveVerification, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function checkArchive(): Promise<ArchiveVerification> {
    const archive: ArchiveServiceInterface = inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE);
    return await archive.resolveVerification();
}
```

`entityClass` checks one archived entity, and `tenantId` the chain and files of one tenant. The result is `intact` when every chain holds and every file does. `chains` holds what [checking each chain](./tamper-evident-tables.md#checking-a-chain) found, which tells a row that was changed, slipped in or removed past the repository. `fileProblems` names each file and copy that does not hold, with its row:

| `reason` | What is wrong |
|---|---|
| `'missing'` | Its `FileRecord` is gone |
| `'changed'` | Its bytes, or its `FileRecord`, do not match the SHA-256 the row recorded |
| `'unreadable'` | Its store does not hand the bytes over, such as for a key that holds nothing |

Checking reads the bytes of every file and every copy, a request or more per file to a bucket or an SFTP server.

> [!NOTE]
> As for any chain, removing the newest rows of a tenant, or every row of it, is told only by comparing `newestSequence` and `newestHash` with a copy kept outside the data source.

## Pruning the archive
`prune` of the archive service deletes every row whose retention ended, of every tenant, with its files and their copies, and resolves how many rows it deleted. `findDue` finds those rows, of the current tenant or with `acrossTenants` of every tenant, the longest ended first. To prune once a day, add `ArchivePruneCronJob` to the `cronJobs` of your application:

```ts
// src/index.ts
import { ArchivePruneCronJob, SemVerUtilities, ZibriApplication } from 'zibri';

import { version } from '../package.json';
import { providers } from './providers';

if (!SemVerUtilities.isSemVerVersion(version)) {
    throw new Error('The version of the package.json is not valid.');
}

const app: ZibriApplication = new ZibriApplication({
    name: 'Api',
    baseUrl: 'http://localhost:3000',
    controllers: [
        // ...
    ],
    websocketControllers: [
        // ...
    ],
    dataSources: [
        // ...
    ],
    cronJobs: [ArchivePruneCronJob],
    version,
    environment: 'development',
    defaultAuth: 'public',
    twoFactorAtLogin: 'never',
    providers
});
// ...
```

A row is pruned from anywhere in its chain. A row at the old end of its chain moves the start of the chain, as [pruning a chain](./tamper-evident-tables.md#pruning-old-rows) does, and any other row leaves a `ChainGap`, such as one kept for a shorter time than the row before it. `prune` of the repository of an archived entity is refused.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `ChainGap`, `ChainAnchor` | An entity is declared with `@Archive` |
| `FileRecord` | An archived entity keeps files in a file store |
| `SigningKey` | Every application |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Files](./files.md) — the file stores, and the files of an entity kept in one
- [Tamper-evident tables](./tamper-evident-tables.md) — chained entities, and checking a chain
- [Cron jobs](../background-work/cron.md) — registering a cron job such as `ArchivePruneCronJob`