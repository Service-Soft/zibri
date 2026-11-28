---
keywords: [files, file storage, documents, attachments, uploads, blob storage, object storage, s3, sftp, sha-256, checksum, deduplication]
---

# Files
A file store keeps the bytes of files, in a folder, a bucket of an S3 compatible storage or on an SFTP server. The file service stores a file in a store by name, records what it is in a row of `FileRecord`, and checks its bytes against their SHA-256 on every read. A [tenant](../glossary.md#tenant) can keep its files in a store of its own.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `FileStore` | decorator | Marks a class as a file store, listed in `fileStores` of the application options |
| `FsFileStore` | class | Keeps the bytes in a folder of this instance's own disk |
| `S3FileStore` | class | Keeps the bytes in a bucket of an S3 compatible object storage |
| `SftpFileStore` | class | Keeps the bytes in a folder on a server reached over SFTP |
| `FileServiceInterface`, `FileService` | interface, class | Stores, reads and deletes files: `store`, `copy` into another store, `read`, `readStream`, `findFile`, `findFiles`, `delete`, and `deleteRemovedFiles` for the files a repository takes off its rows. Replaceable through `ZIBRI_DI_TOKENS.FILE_SERVICE` |
| `FileRecord`, `FileRecordCreateData` | entity, type | A stored file: its `name`, `mimeType`, `size`, `sha256`, the `storeName` and `key` its bytes are kept under, `createdAt` and `createdBy`. And what creates one |
| `FileReference` | class | What a response answers for a [file of an entity kept in a store](#keeping-the-files-of-an-entity-in-a-file-store): its `name`, `mimeType`, `size` and the `url` of its download |
| `StoreFileData` | type | What `store` takes: the `store`, the `name` and `mimeType` of the file, its `data` as a `Buffer` or a stream, and `createdBy` |
| `FileHashMismatchError` | error | What a read fails with for bytes that do not match the SHA-256 they were stored with, naming the file |
| `FileCleanupCronJob` | cron job | Deletes the bytes no row references, a day after they were written. Registered for you |
| `FileStoreInterface`, `isFileStore` | interface, function | What a [file store of your own](#writing-a-file-store-of-your-own) implements, and the check whether a value does |
| `FileStoreEntry` | type | What `findEntry` of a store answers of a key: its `size` and `modifiedAt` |
| `FileStoreKeyNotFoundError` | error | What `get` of a store fails with for a key that holds nothing |
| `S3StorageOptions` | interface | Where a bucket is, how its requests are signed, and how objects are stored in it. What `S3FileStore` and `S3BackupTransport` take |
| `SftpStorageOptions` | interface | Where an SFTP server is, how to log in, and the folder on it. What `SftpFileStore` and `SftpBackupTransport` take |
| `TenantFileStore`, `TenantFileStoreCreateData` | entity, type | A store a tenant [keeps its files in](#letting-a-tenant-keep-its-files-in-its-own-storage), of a kind the application lists, and what adds one |
| `TenantFileStoreKindInterface`, `AnyTenantFileStoreKind` | interface, type | A kind of storage tenants may keep their files in, and any of them |
| `S3TenantFileStoreKind`, `SftpTenantFileStoreKind` | class, class | A bucket of an S3 compatible storage, and an SFTP server, as kinds tenants may configure |
| `TenantFileStoreOptions` | type | What tenants may configure as file stores: `kinds`, `allowedHosts` and `allowPrivateNetworks` |
| `ZIBRI_DI_TOKENS.FILE_TENANT_STORE_OPTIONS` | DI token | The `TenantFileStoreOptions`. Defaults to S3 and SFTP at public addresses |
| `ZIBRI_DI_TOKENS.FILE_STAGING_FOLDER` | DI token | Where a file stored from a stream is written while it is hashed. Defaults to `.zibri/files` in the application's root |
| `ZipUtilities`, `ZipEntry` | class, type | `pack` writes a zip archive of files as they come, each deflated, without holding one in memory, with zip64 past 4 GiB or 65,535 files. A file of it: its `name` in the archive, `modifiedAt` and `content` |

## Registering a file store
A file store is a class decorated with `@FileStore()`, listed in `fileStores` of the application options. Its name is what the files kept in it record, so it stays the same:

```ts
// src/files/document.file-store.ts
import { FileStore, FsFileStore, FsUtilities } from 'zibri';

@FileStore()
export class DocumentFileStore extends FsFileStore {
    constructor() {
        // the folder the files are kept in
        super('documents', FsUtilities.getPath('/var/lib/app/documents'));
    }
}
```

Declare `FileRecord` in your data source. `FsFileStore` writes each file into the `.partial` folder of its folder first, and moves it into place once it is on the disk.

> [!WARNING]
> Files on the instance's own disk are lost with that disk, and other instances do not see them. Use `FsFileStore` for a single instance or for testing, and a bucket or a server otherwise.

## Storing and reading a file
`store` keeps a file in the store of the name it is given, as a row of the current tenant:

```ts
// src/services/invoice-file.service.ts
import { FileRecord, FileServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function storeInvoicePdf(pdf: Buffer): Promise<FileRecord> {
    const fileService: FileServiceInterface = inject(ZIBRI_DI_TOKENS.FILE_SERVICE);
    return await fileService.store({ store: 'documents', name: 'invoice-2026-11.pdf', mimeType: 'application/pdf', data: pdf });
}

export async function readInvoicePdf(id: string): Promise<Buffer> {
    const fileService: FileServiceInterface = inject(ZIBRI_DI_TOKENS.FILE_SERVICE);
    return await fileService.read(id);
}
```

`data` is a `Buffer` or a stream. A stream is written to `ZIBRI_DI_TOKENS.FILE_STAGING_FOLDER` while it is hashed and goes to the store from there, so a large file is never held in memory whole. `createdBy` is the user of the current request, unless you name another.

`read` hands back the bytes once they match the SHA-256 they were stored with, and fails with a `FileHashMismatchError` naming the file otherwise. `readStream` hands them back as a stream, which fails at its end with the same error. Bytes larger than the file was are refused while they arrive. `findFile` finds the row, and `delete` deletes the file. `copy` stores a copy of a file in another store, as a file of its own, once its bytes match their SHA-256. A file of another tenant is not found, by any of them.

## Storing a file in a transaction
`store` and `delete` take the transaction the row is written in:

```ts
// src/services/task-attachment.service.ts
import { FileRecord, FileServiceInterface, inject, Repository, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

import { DbDataSource } from '../data-sources/db/db.data-source';
import { Task } from '../models/task.model';

export async function createTaskWithAttachment(dataSource: DbDataSource, taskRepository: Repository<Task>, scan: Buffer): Promise<FileRecord> {
    const fileService: FileServiceInterface = inject(ZIBRI_DI_TOKENS.FILE_SERVICE);
    return await dataSource.runInTransaction(async (transaction: Transaction) => {
        await taskRepository.create({ title: 'Check the delivery note', status: 'new' }, { transaction });
        return await fileService.store({ store: 'documents', name: 'delivery-note.png', mimeType: 'image/png', data: scan }, transaction);
    }, { maxAttempts: 3 });
}
```

The bytes are written before the row. Those of a transaction that is rolled back are deleted by `FileCleanupCronJob`, a day after they were written. A delete in a transaction deletes the bytes once it is committed.

## Keeping the same content once
Every call of `store` is a row of its own. Files of the same content in the same store and tenant share their bytes, which are kept once, under a key made of their SHA-256.

Deleting a file deletes its bytes once no other row references them. Bytes written less than a day ago stay until `FileCleanupCronJob` finds them, since a file of the same content stored meanwhile may be about to reference them. The job runs daily, and deletes the bytes in every store that no row references and that were not written for a day, such as those of a deleted tenant.

## Keeping the files of an entity in a file store
A file property of an entity that names a `store` keeps its file in that file store. Its column holds the id of the file's `FileRecord`, and an array of such files holds a list of ids:

```ts
// src/models/expense.model.ts
import { BaseTenantEntity, Entity, MimeType, OmitClass, PartialClass, Property } from 'zibri';

@Entity()
export class Expense extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.file({ store: 'documents', allowedMimeTypes: [MimeType.PDF, MimeType.PNG, MimeType.JPEG], maxSize: '10mb', required: false })
    receipt?: string | null;

    @Property.array({ items: { type: 'file', store: 'documents', allowedMimeTypes: 'all' }, totalMaxSize: '50mb' })
    attachments!: string[];
}

export class ExpenseCreateDTO extends OmitClass(Expense, ['id', 'tenantId']) {}

export class ExpenseUpdateDTO extends PartialClass(ExpenseCreateDTO) {}
```

| Option | What it is |
|---|---|
| `store` | The name of the file store the file is kept in, such as `'documents'`, or a DI token providing the name. Without one, the column holds the bytes of the file as a `Buffer` |
| `allowedMimeTypes` | The mime types a file may have, or `'all'` for any. Required |
| `maxSize` | The largest file taken. 5 megabytes by default |
| `required` | Whether the property needs a file. On by default |

`totalMaxSize` of an array is the most all its files take together, 50 megabytes by default.

A `store` given as a DI token lets an application decide the store of an entity it does not declare itself, such as one of a plugin:

```ts
// src/models/contract.model.ts
import { BaseTenantEntity, Entity, InjectionToken, MimeType, Property } from 'zibri';

export const CONTRACT_FILE_STORE: InjectionToken<string> = new InjectionToken<string>('app.contract_file_store');

@Entity()
export class Contract extends BaseTenantEntity() {
    @Property.file({ store: CONTRACT_FILE_STORE, allowedMimeTypes: [MimeType.PDF] })
    document!: string;
}
```

Provide the name with the other providers of your application, as `defineProvider({ token: CONTRACT_FILE_STORE, useValue: 'documents' })`. The name is read once the providers exist, and checked when the application starts like a name given as it is: a store that is not registered stops the start, naming the token.

A row read through the repository holds the ids. In your own code, write the `id` of the `FileRecord` that `store` of the file service answers. A response answers a `FileReference` in place of each id: the `name`, `mimeType` and `size` of the file, and the `url` its bytes are downloaded from. It is written with each response and never stored, and never holds the bytes:

```json
{
    "id": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90",
    "tenantId": "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
    "title": "Train to the customer",
    "receipt": {
        "name": "receipt.pdf",
        "mimeType": "application/pdf",
        "size": 48213,
        "url": "https://api.example.com/expenses/0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90/files/receipt?x-tenant-id=6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f"
    },
    "attachments": []
}
```

The `url` points to the [download route](#uploading-and-downloading-the-files-of-an-entity) of the `CrudController` serving the entity, the first one in `controllers`, below the `baseUrl` of the application and with the tenant of the request. For a request naming no tenant, it is the tenant the route did its work in with [`runAs`](./tenancy.md#the-tenant-of-a-request). It is `null` for an entity no `CrudController` serves, whose files a route of your own reads with `readStream`. A file whose row is gone is answered as `null`. `zibri-contract` has the `FileReference` type for a frontend.

A file kept in a store is a property of the entity, or the items of one of its arrays, where its row and its download route name it. One inside an object is refused when the application starts, and so is a store that is neither registered nor one tenants may configure.

## Deleting the files of a row
The repository of an entity owns the files of its rows. A write that takes a file off a row deletes it through `deleteRemovedFiles` of the file service, once the write is committed:

| Write | Its files |
|---|---|
| `updateById`, `updateAll` or another update naming a file property | The files it replaces or removes are deleted. A file it leaves alone is kept |
| `deleteById` or `deleteAll` | Every file of the rows it deletes is deleted |
| A row removed along with another, through a relation that cascades removes | Every file of the row is deleted |
| The soft delete of a row of a [soft delete entity](./data-source.md#soft-deleting-rows), and its restore | Kept, so a restore brings them back |
| `hardDelete: true` | Every file of the rows it removes is deleted |

This holds for every data source and every way a repository writes a row. A write that is rolled back keeps the files, and the bytes of a deleted file go as [deleting a file](#keeping-the-same-content-once) deletes them. A file whose delete fails after the commit is logged, and its `FileRecord` stays.

## Uploading and downloading the files of an entity
A `CrudController` of an entity that keeps files in a file store takes the bodies of `POST` and `PATCH` as multipart, and serves each file at a route of its own:

```ts
// src/controllers/expense.controller.ts
import { Controller, CrudController } from 'zibri';

import { Expense, ExpenseCreateDTO, ExpenseUpdateDTO } from '../models/expense.model';

@Controller('/expenses')
export class ExpenseController extends CrudController(Expense, ExpenseCreateDTO, ExpenseUpdateDTO) {}
```

A file is a part of the body, and every other property a field, read as [a file upload](../endpoints/creating-endpoints.md#handling-file-uploads) reads it. The files of an array are its field repeated:

```bash
curl https://api.example.com/expenses \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -F 'title=Train to the customer' \
    -F 'receipt=@receipt.pdf;type=application/pdf' \
    -F 'attachments=@scan.png' \
    -F 'attachments=@note.txt'
```

A `PATCH` changes each file property by what it carries:

| The body carries | What happens to the file |
|---|---|
| A file | Replaces the file. For an array, the files sent replace all of its files |
| An empty field, such as `-F 'receipt='` | Removes the file, or every file of an array |
| Nothing of the property | Keeps the file |

An array is replaced as a whole: to add a file to it, send the files it keeps along with the new one.

The files are stored through the file service in the transaction the row is written in, so a write that is refused or fails keeps none of them. The repository deletes a file replaced or removed, and every file of a deleted row, see [deleting the files of a row](#deleting-the-files-of-a-row). The uploads are deleted once they are stored.

`GET /expenses/:id/files/receipt` downloads the file, and `GET /expenses/:id/files/attachments.0` the first file of the array, with its mime type and as a download under its name. The route has the access rules of `findById`, the `@Auth` decorators of the controller and those of `findById`, and reads the row through it, so a caller refused the row is refused its files. A file whose bytes changed in the store ends its download part way, as [`readStream`](#storing-and-reading-a-file) does.

> [!NOTE]
> `POST` and `PATCH` of such a controller take a multipart body alone, and answer a JSON body with `415`. Their bodies hold no file the entity keeps in its column, which the application refuses when it starts. A [chained](./tamper-evident-tables.md#chaining-the-rows-of-each-tenant) entity writes its row and its files in a transaction of its data source, so its data source declares `FileRecord`.

## Keeping files in an S3 compatible bucket
`S3FileStore` keeps the bytes in a bucket of any service that speaks the S3 protocol, such as AWS S3, MinIO, Cloudflare R2 or Hetzner. It takes the same options as [`S3BackupTransport`](./backup.md#storing-backups-in-an-s3-compatible-bucket):

```ts
// src/files/bucket.file-store.ts
import { FileStore, S3FileStore } from 'zibri';

import { secrets } from './secrets';

@FileStore()
export class BucketFileStore extends S3FileStore {
    constructor() {
        super('documents', {
            endpoint: 'https://s3.eu-central-1.amazonaws.com',
            bucket: 'my-app-documents',
            region: 'eu-central-1',
            credentials: { accessKeyId: secrets.s3AccessKeyId, secretAccessKey: secrets.s3SecretAccessKey },
            serverSideEncryption: 'bucket-default',
            prefix: 'production',
            addressingStyle: 'virtual-hosted'
        });
    }
}
```

Each file is an object under `prefix`. A file larger than `partSize` is uploaded in parts, which it holds one at a time in memory.

## Keeping files on an SFTP server
`SftpFileStore` keeps the bytes in a folder on a server reached over SFTP. It needs the `ssh2` package, see [requirements](#requirements), and takes the same options as [`SftpBackupTransport`](./backup.md#storing-backups-on-an-sftp-server):

```ts
// src/files/storage-box.file-store.ts
import { FileStore, SftpFileStore } from 'zibri';

import { secrets } from './secrets';

@FileStore()
export class StorageBoxFileStore extends SftpFileStore {
    constructor() {
        super('documents', {
            host: 'files.example.com',
            username: 'my-app',
            authentication: { privateKey: secrets.sftpPrivateKey },
            hostKeyFingerprint: 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
            path: '/documents/production'
        });
    }
}
```

Each call of the store connects on its own, and a stream it hands back holds its connection until it is read.

## Letting a tenant keep its files in its own storage
A tenant can keep its files in storage of its own, such as a bucket or an SFTP server. Declare `TenantFileStore` beside `FileRecord`, and add the tenant's store through the file service, named like the store it stands in for:

```ts
// src/services/tenant-documents.service.ts
import { FileServiceInterface, inject, TenantFileStore, ZIBRI_DI_TOKENS } from 'zibri';

export async function addTenantDocumentBucket(tenantId: string, secretAccessKey: string): Promise<TenantFileStore> {
    const fileService: FileServiceInterface = inject(ZIBRI_DI_TOKENS.FILE_SERVICE);
    return await fileService.createTenantFileStore(tenantId, {
        name: 'documents',
        kind: 's3',
        settings: { endpoint: 'https://s3.eu-central-1.amazonaws.com', bucket: 'acme-documents', region: 'eu-central-1', accessKeyId: 'AKIA…', addressingStyle: 'virtual-hosted' },
        secret: { secretAccessKey }
    });
}
```

From then on, the files the tenant stores in `documents` are kept in its bucket, and those of every other tenant in the application's store. Its files stored before stay where they are. A store is of one of the kinds the application lists, with the settings and the secret of that kind: of a bucket, `'s3'`, a `TenantS3TransportSettings` and the secret of the access key; of an SFTP server, `'sftp'`, a `TenantSftpTransportSettings` and the password or the private key. These are the settings a tenant [backs up to its own storage](./backup.md#letting-a-tenant-back-up-to-its-own-storage) with. The secret is stored encrypted and bound to its row. Adding a store writes and deletes a small file on it, so a wrong address, bucket or secret is refused with a `400` at once. `findTenantFileStores` lists a tenant's stores, and `deleteTenantFileStore` deletes one, refused with a `409` while files are kept in it.

A tenant's store reaches public addresses only, checked when it is added and again before every call, as a transport of a tenant is. `ZIBRI_DI_TOKENS.FILE_TENANT_STORE_OPTIONS` says what tenants may configure:

| Option | What it is |
|---|---|
| `kinds` | The kinds a tenant may add, such as `new S3TenantFileStoreKind()`. `S3TenantFileStoreKind` and `SftpTenantFileStoreKind` by default |
| `allowedHosts` | The hosts a store may reach, each with the hosts below it, such as `amazonaws.com`. Any public host by default |
| `allowPrivateNetworks` | Whether a store may reach the networks the application runs in, and a bucket over plain http. Off by default |

> [!WARNING]
> With `allowPrivateNetworks`, a tenant can make your application connect to any host inside its network, such as a database or a metadata service. Turn it on only when every tenant is trusted as much as the network is.

A kind of your own implements `TenantFileStoreKindInterface`: its `name`, the classes its settings and secret are checked against, and `createStore`, which builds the store reaching the storage for each call, connecting to each host at the address `network.resolveAddress` answers.

## Backing up a file store
The rows of `FileRecord` are backed up with their [data source](./backup.md#backing-up-a-data-source), and the bytes of the files with their store. Mark the store with `@Backup`, as a data source is marked:

```ts
// src/files/receipt.file-store.ts
import { Backup, BackupTransport, FileStore, FsBackupTransport, FsFileStore, FsUtilities } from 'zibri';

@BackupTransport()
class FilesBackupTransport extends FsBackupTransport {
    constructor() {
        super('files-backup-transport', FsUtilities.getPath('./backups'));
    }
}

@FileStore()
@Backup({ transports: [FilesBackupTransport], encrypt: true })
export class ReceiptFileStore extends FsFileStore {
    constructor() {
        // the folder the files are kept in
        super('receipts', FsUtilities.getPath('/var/lib/app/receipts'));
    }
}
```

A backup holds the bytes of every file a row of the store names, each content once, and is stored after the data source holding `FileRecord`, so that it holds the bytes of every row that data source's backup holds. A store without `@Backup` is not backed up, and the rows of its files are, with their data source.

A backup reads every file of the store, in the order the files were first stored. It stores the [chunks](./backup.md#storing-unchanged-data-once) no backup stored before, so a backup after another one adds the files stored since, and about one chunk more. Reading every file means a request or more per file to a bucket or an SFTP server on every backup, and the bytes of the store pass through [the disk of this instance](./backup.md#where-a-backup-passes-through) on their way.

A file whose bytes are missing, or not as large as its row says, is left out of the backup. One whose bytes do not match its SHA-256 is backed up as it is, and a restore refuses its bytes. The application logs an error naming each such file.

A restore puts the bytes of the backup back under their keys, each once it matches its SHA-256, and deletes no bytes: the bytes of a file stored since stay, and `FileCleanupCronJob` deletes those no row references. A restore restores the store and the data source together, and takes no copy of the store to put back when it fails, since it only adds what the store lacks. With `resources`, you restore one of them alone:

| Restored | What comes back |
|---|---|
| Both, without `resources` | The rows and the bytes of the backup |
| `resources: ['DbDataSource']` | The rows of the backup. A file whose bytes were deleted since stays without them |
| `resources: ['ReceiptFileStore']` | The bytes of the backup, and the rows stay as they are. A file stored since whose bytes are gone stays without them |

Once a restore of either is done, the application warns about the files of the store that have no bytes in it, naming how many there are, the first 20, and the store a restore of their bytes names, such as `restore(backup, { resources: ['ReceiptFileStore'] })`. A file deleted between the backup of its data source and that of its store has its row in the backup and not its bytes, and is warned about too.

A [backup of a tenant](./backup.md#backing-up-a-tenant) holds the bytes of the tenant's files in each store marked with `@Backup`, and a restore of it puts back those alone. The files a tenant keeps in [storage of its own](#letting-a-tenant-keep-its-files-in-its-own-storage) are not backed up: their rows are, and their bytes stay in the tenant's storage.

## Keeping documents for a retention period
The files of an [archived entity](./archive.md), such as the scan of a receipt, are kept unchanged with their row until its retention ends, and can be copied into further stores when the row is created. A read falls back to a copy when the bytes of the file do not match. See [archiving documents](./archive.md).

## Writing a file store of your own
A file store implements `FileStoreInterface`: a `name`, and the methods the file service keeps bytes with.

| Method | What it does |
|---|---|
| `put(key, data)` | Stores the bytes whole or not at all, replacing what the key held |
| `get(key, maxBytes)` | Hands back what the key holds as a stream. Fails with `FileStoreKeyNotFoundError` when it holds nothing, and refuses a key holding more than `maxBytes` |
| `findEntry(key)` | Hands back the `size` of what the key holds and when it was written, or `undefined` when it holds nothing |
| `findKeys(prefix)` | Hands back every key starting with the prefix, a page at a time, in any order. A put still running is not among them |
| `delete(keys)` | Deletes the keys. A key that holds nothing is no error |

A key is segments separated by `/`, such as `<tenant id>/3f/3f9a…`. The file service decides the keys, and finds the bytes no row references by `findKeys` and `findEntry`. A store can build on a shipped one, such as one keeping the files on a mounted network drive:

```ts
// src/files/nas.file-store.ts
import { Readable } from 'node:stream';

import { FileStore, FileStoreEntry, FileStoreInterface, FsFileStore, FsUtilities } from 'zibri';

@FileStore()
export class NasFileStore implements FileStoreInterface {
    readonly name: string = 'nas';
    // where the drive is mounted
    private readonly drive: FsFileStore = new FsFileStore(this.name, FsUtilities.getPath('/mnt/nas/documents'));

    async put(key: string, data: Readable): Promise<void> {
        await this.drive.put(key, data);
    }

    async get(key: string, maxBytes: number): Promise<Readable> {
        return await this.drive.get(key, maxBytes);
    }

    async findEntry(key: string): Promise<FileStoreEntry | undefined> {
        return await this.drive.findEntry(key);
    }

    findKeys(prefix: string): AsyncIterable<string[]> {
        return this.drive.findKeys(prefix);
    }

    async delete(keys: string[]): Promise<void> {
        await this.drive.delete(keys);
    }
}
```

## Requirements
| Package | Used for |
|---|---|
| `ssh2` | Reaching an SFTP server, with `SftpFileStore`. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `FileRecord` | A file store is registered, or `TenantFileStore` is declared |
| `TenantFileStore` | Tenants [keep their files in storage of their own](#letting-a-tenant-keep-its-files-in-its-own-storage) |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Backup](./backup.md) — the transports a backup is stored through, which reach a folder, a bucket or a server the same way, and restoring a backup
- [Archiving documents](./archive.md) — documents and their files kept unchanged for a retention period
- [Tenants](./tenancy.md) — the tenant a file belongs to
- [Using transactions](./data-source.md#using-transactions) — the transaction a file is stored in
- [Extending a controller](../endpoints/creating-endpoints.md#extending-a-controller) — the `CrudController` that writes and serves the files of an entity