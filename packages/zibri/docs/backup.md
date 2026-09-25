# Backup
The backup system in Zibri consists of multiple parts.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Backup` | decorator | Marks a class as a backup resource, defining what should be backed up |
| `BackupResourceInterface` | interface | Contract for extracting and restoring a resource's data |
| `BaseFsBackupTransport` | class | Backup transport that writes/reads backup data to/from the local file system |
| `BaseS3BackupTransport` | class | Backup transport that stores backups in a bucket of an S3 compatible object storage |
| `S3BackupTransportOptions` | interface | Where and how `BaseS3BackupTransport` stores backups |
| `BackupServiceInterface` | interface | Service for creating and restoring backups |
| `BackupEntity` | class | Entity representing a created backup |
| `BackupResourceEntity` | class | Entity representing a resource's data within a backup |
| `ZIBRI_DI_TOKENS.BACKUP_SERVICE` | DI token | Injects `BackupServiceInterface` |
| `BACKUP_FORMAT_VERSION` | constant | The shape backups are written in by this build |
| `READABLE_BACKUP_FORMAT_VERSIONS` | constant | The shapes this build restores from |
| `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER` | DI token | Where a backup is staged on its way to and from a transport |

## Usage
### The parts of the backup system
#### One or more backup resources
These define WHAT should be backed up and need to be marked with the `@Backup` decorator.

A decorated resource needs to implement `BackupResourceInterface` to define how data should be extracted from the resource (eg. by running a sql dump) and read back in.

#### One or more backup transports
These define how extracted data from the resource is saved and how to retrive it when restoring a backup. They are classes decorated with `@BackupTransport` and need to be provided on the `ZibriApplicationOptions.backupTransports` array.

For more detail on those, especially if you are interested in creating your own transport, see [backup transports](./generated/interfaces/backup_transports_backup-transport.interface.BackupTransportInterface.html).

#### The backup service
The backup service is responsible for creating and restoring backups based on the configured resources and transports.

### Example
In the following, we have a postgres data source that we want to backup:

```ts
// src/data-sources/db/db.data-source.ts
import { DataSource, Backup, BackupServiceInterface, BackupTransport, BaseFsBackupTransport, FsPath, FsUtilities, inject, Newable, OmitStrict, PostgresDataSource, PostgresOptions, Repository, repositoryTokenFor, SchemaManagement, BaseEntity, BackupEntity, BackupResourceEntity, ZIBRI_DI_TOKENS } from 'zibri';

@BackupTransport()
class TestBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'fs-backup-transport';
    protected override readonly backupBasePath: FsPath = FsUtilities.getPath('./backups');
}

@DataSource()
@Backup({ transports: [TestBackupTransport] }) // Alternative for all registered transports: { transports: 'all' }
class DbDataSource extends PostgresDataSource {
    options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db'
    };
    schemaManagement: SchemaManagement = 'synchronize';
    entities: Newable<BaseEntity>[] = [
        BackupEntity,
        BackupResourceEntity
        //...
    ];
}
```

Notice that we don't need to implement `BackupResourceInterface` here, as `PostgresDataSource` already does that for us. What we did need to do was add two new entities. A resource checks at startup that it can actually take and restore a backup, so anything else it still needs is reported by name while the application boots rather than the first time a backup is attempted.

If you want a resource to be backed up to all registered transports, you can simply define `transports: 'all'` in the decorator.

A backup covers what its resource owns and a restore replaces exactly that, so the credentials the resource already runs with are usually enough to take one. If you need to back up more than that, you can set `rootUsername` and `rootPw` to run backups as a role that reaches further.

The `FsBackupTransport` simply writes the backup data for this resource to the local file system, so it should only be used for illustration/testing purposes.

### Storing backups in an S3 compatible bucket
`BaseS3BackupTransport` stores backups in a bucket of any service that speaks the S3 protocol — AWS S3, MinIO, Cloudflare R2, Backblaze B2, Hetzner, IONOS, Wasabi and others:

```ts
// src/backup/s3.backup-transport.ts
import { BaseS3BackupTransport, S3BackupTransportOptions } from 'zibri';

import { secrets } from './secrets';

@BackupTransport()
export class S3BackupTransport extends BaseS3BackupTransport {
    override readonly name: string = 's3-backup-transport';
    protected override readonly options: S3BackupTransportOptions = {
        endpoint: 'https://s3.eu-central-1.amazonaws.com',
        bucket: 'my-app-backups',
        region: 'eu-central-1',
        accessKeyId: secrets.s3AccessKeyId,
        secretAccessKey: secrets.s3SecretAccessKey,
        prefix: 'production',
        addressingStyle: 'virtual-hosted'
    };
}
```

The bucket has to exist. Each resource is stored as the object `<prefix>/<backup name>/<resource name>`, and the record of the backup as `<prefix>/<backup name>/metadata.json` beside it.

`addressingStyle` says where the bucket is named in a request: `virtual-hosted` puts it into the host name (`https://my-app-backups.s3.eu-central-1.amazonaws.com`), `path` into the path (`https://s3.eu-central-1.amazonaws.com/my-app-backups`). Use the one your service documents. `region` is the region of the bucket; a service without regions names the one it expects, usually `us-east-1` or `auto`.

A backup is uploaded in parts of `partSize`, `16mb` by default. A backup is at most 10,000 parts, so the default allows backups of up to 156gb. For larger ones, raise `partSize`, up to `5gb`. Each part is held in memory while it is uploaded.

A backup that fails while it is uploaded is aborted, which removes the parts uploaded so far. When the abort itself fails, the transport logs a warning naming the upload, and its parts stay stored until you abort it or a lifecycle rule of the bucket removes it.

### Creating and restoring backups
Now we can use the backup service to create a new backup:

```ts
export async function createBackup(): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    await backupService.createBackup();
}
```

Which you can later restore using:

```ts
export async function restoreBackup(): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
    const backup: BackupEntity = await backupRepository.findById('42', { relations: ['resources'] });
    await backupService.restore(backup);
}
```

`delete` removes a backup from every transport that holds it, and from the database:

```ts
export async function deleteBackup(): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
    const backup: BackupEntity = await backupRepository.findById('42', { relations: ['resources'] });
    await backupService.delete(backup);
}
```

A backup whose resources name a transport the application does not register is refused, and stays as it is.

### What a restore checks first

Creating a backup records how many bytes each resource turned out to be and what they sum to, and
marks the resource complete once every transport has taken the whole thing. A restore fetches the
stored data, checks it against that record, and refuses before applying any of it when the two differ —
so an archive that was truncated or altered where it is kept fails the restore rather than half
succeeding.

That record is written beside the data as well as into the database, because the database is often the
thing being restored. A resource that records nothing is refused too: anything that finished recorded
what it wrote, so a resource without that record describes a backup that started and stopped.

### Where a backup passes through

A backup is written to this instance's own disk on its way out and fetched to it on the way back, so
plan for room for the largest archive being written or restored at a time. `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER`
says where, and defaults to `.zibri/backups` beside the application. Each file is removed as soon as
the backup or restore it belongs to is done, and a daily job clears anything a killed process left
behind.

Two things follow from it. Every transport is read exactly once per restore, whatever the check and the
restore need between them — which for a transport that charges for what it sends is the difference
between one transfer and two. And on the way out, transports follow the file while it is still being
written, so each of them gets the whole archive without any of them pacing another, and without pacing
whatever is producing the data: a database dump runs at the speed of the disk and closes its snapshot
as soon as it is done, rather than holding it open for as long as the slowest upload takes.

### The shape a backup is written in

A backup carries two versions, and they answer different questions.

`zibriVersion` is which build took it — provenance, for when you are reading a bug report about an
archive somebody else produced.

`formatVersion` is the shape it is written in, and it is the one a restore acts on: an archive written
in a shape this build does not know is refused by name, before any of it is applied. That matters most
on the way back — one instance restoring what a newer one wrote, or a rollback — because a shape read
as though it were a different one lines up whatever fields happen to line up, and what a restore does
with them lands on a database.

The two are deliberately separate. A backup outlives the releases either side of it, so tying whether
one can be read to the framework's own version would make every archive unreadable the next time the
framework breaks something that has nothing to do with backups. `BACKUP_FORMAT_VERSION` changes when
the shape of a backup changes and at no other time, which is usually never.

What the shape covers is what the framework writes: the record stored beside the data, and which fields
a restore reads out of it. It says nothing about what a resource's own `createBackupData` produces — a
Postgres dump is read by Postgres, and which versions of it can is Postgres's contract rather than this
one. It also says nothing about the layout a transport stores under, which belongs to the transport:
one that changes where it puts things keeps reading what it already wrote, and the framework never
needs to know either way.

That split is why a transport never opens the record. It receives the document to store and hands it
back unopened, so a transport of your own goes on working across a change of shape without being
touched — it stores bytes and a document, and what a document means stays here.

## See also
- [Data sources](./data-source.md) — `PostgresDataSource` and other data sources that back up automatically
