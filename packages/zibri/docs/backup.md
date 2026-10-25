# Backup
A backup copies the data of a resource, such as a data source, to one or more transports: a folder, an S3 bucket or an SFTP server. You take backups with the backup service, and restore your application from one later.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Backup` | decorator | Marks a class as a backup resource, defining what should be backed up |
| `BackupResourceInterface` | interface | Contract for extracting and restoring a resource's data |
| `BackupTransport` | decorator | Marks a class as a backup transport, listed in `backupTransports` of the application options |
| `PostgresBackupScope` | type | What a backup of a Postgres data source covers: `'schema'` or `'entity-tables'`. Required with `@Backup` |
| `BaseFsBackupTransport` | class | Backup transport that writes/reads backup data to/from the local file system |
| `BaseS3BackupTransport` | class | Backup transport that stores backups in a bucket of an S3 compatible object storage |
| `S3BackupTransportOptions` | interface | Where and how `BaseS3BackupTransport` stores backups |
| `BaseSftpBackupTransport` | class | Backup transport that stores backups in a folder on a server reached over SFTP |
| `SftpBackupTransportOptions` | interface | Where and how `BaseSftpBackupTransport` stores backups |
| `SftpAuthentication` | type | How `BaseSftpBackupTransport` logs in: a password, or a private key |
| `BackupServiceInterface` | interface | Service for creating and restoring backups |
| `BackupEntity` | class | Entity representing a created backup |
| `BackupResourceEntity` | class | Entity representing a resource's data within a backup |
| `ZIBRI_DI_TOKENS.BACKUP_SERVICE` | DI token | Injects `BackupServiceInterface` |
| `BACKUP_FORMAT_VERSION` | constant | The shape backups are written in by this build |
| `READABLE_BACKUP_FORMAT_VERSIONS` | constant | The shapes this build restores from |
| `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER` | DI token | Where a backup is staged on its way to and from a transport |
| `ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS` | DI token | How long the application waits for a running backup or restore when it stops. Defaults to 0 |

## The parts of the backup system
### One or more backup resources
A backup resource is what gets backed up. Mark it with the `@Backup` decorator.

A resource implements `BackupResourceInterface`, which says how its data is extracted, such as by a SQL dump, and how it is read back in.

### One or more backup transports
A backup transport stores the extracted data, and fetches it again for a restore. It is a class decorated with `@BackupTransport`, listed in `ZibriApplicationOptions.backupTransports`.

To write a transport of your own, see [backup transports](./generated/interfaces/backup_transports_backup-transport.interface.BackupTransportInterface.html).

### The backup service
The backup service creates and restores backups of the resources, through their transports.

## Backing up a data source
This Postgres data source is backed up:

```ts
// src/data-sources/db/db.data-source.ts
import { Backup, BackupEntity, BackupResourceEntity, BackupTransport, BaseEntity, BaseFsBackupTransport, DataSource, FsPath, FsUtilities, Newable, OmitStrict, PostgresBackupScope, PostgresDataSource, PostgresOptions, RepositoryClass, SchemaManagement } from 'zibri';

@BackupTransport()
class DiskBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'fs-backup-transport';
    protected override readonly backupBasePath: FsPath = FsUtilities.getPath('./backups');
}

@DataSource()
@Backup({ transports: [DiskBackupTransport], encrypt: true })
class DbDataSource extends PostgresDataSource {
    options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: true
    };
    schemaManagement: SchemaManagement = 'synchronize';
    backupScope: PostgresBackupScope = 'schema';
    entities: Newable<BaseEntity>[] = [
        BackupEntity,
        BackupResourceEntity
        //...
    ];
    repositories: RepositoryClass[] = [];
}
```

`PostgresDataSource` implements `BackupResourceInterface` itself. Its entities include `BackupEntity` and `BackupResourceEntity`, which record the backups.

A `PostgresDataSource` takes and restores a backup with the Postgres client tools `pg_dump`, `pg_restore` and `psql`, which are installed beside the application, at least as new as the server.

To back up a resource to every registered transport, set `transports: 'all'` in the decorator.

A backup covers what its resource owns, and a restore replaces exactly that. On a Postgres data source, `backupScope` says what that is. A data source marked with `@Backup` has to set it, see [why some options have no default](./faq.md#why-do-some-options-have-no-default):

| `backupScope` | A backup covers | Use it when |
|---|---|---|
| `'schema'` | The schema the data source works in: every table and other object in it, such as the views, types and functions your migrations create. | The schema belongs to this application alone. |
| `'entity-tables'` | The tables of the data source's entities. Everything else in the schema is neither backed up nor touched by a restore. | Anything else keeps tables in the same schema, such as another application or reporting. |

Either way, a backup carries each object's owner, its grants and its comments, and other schemas of the same database are neither backed up nor touched by a restore. With `'entity-tables'`, a restore fails and changes nothing when anything outside those tables depends on one of them, such as a view or a foreign key of another table. Remove it before the restore and create it again afterwards.

A restore gives every object back to the role that owned it when the backup was taken. A role the backup names as an owner or in a grant has to exist on the server you restore to. Otherwise the restore fails and changes nothing.

The credentials the resource already runs with are enough to take and restore a backup. To run backups as another role, set `rootUsername` and `rootPw`. That role has to be a member of every role that owns an object the backup covers.

`BaseFsBackupTransport` writes the backups to `backupBasePath`, a folder on this instance's own disk.

> [!WARNING]
> A backup on the instance's own disk is lost with that disk. Use `BaseFsBackupTransport` for testing, and another transport in production.

A `ValKeyDataSource` marked with `@Backup` sets `backupMode` instead, which says how its keys are read:

| `backupMode` | A backup | Use it when |
|---|---|---|
| `'snapshot'` | Reads every key at one moment. A transaction committed while it is taken is in it whole or not at all. The server answers nothing else until every key is read. | The store is small enough to pause for, such as sessions or a cache. |
| `'walk'` | Reads the keys a batch at a time, while the server goes on answering. A transaction committed meanwhile can be in it with some of its rows and without others. | The store is too large to pause the server for. |

Either way, a restore builds the ids, indexes and uniques of every entity again from the rows it restored.

## Encrypting backups
`encrypt` says whether a resource's data is encrypted before it leaves the application. With `true`, every backup is encrypted with a key of its own, and that key is stored with the backup, encrypted with the encryption service's `masterEncrypt` (see [the master key](./encryption-and-hashing.md#setting-the-master-key)). Neither this instance's disk nor any transport holds the data unencrypted.

A restore needs the master key the backup was taken under. When you replace the master key, keep the old one in `oldMasterKeys` for as long as you keep backups taken under it. A backup whose master key is not listed is refused before anything is fetched, and the error names the key.

Every backup records the keys a restore of it needs: `masterKeys` and `dataKeyIds`. A backup that holds the data source the data keys are stored in brings them back itself, and needs the master keys they were encrypted under, encrypted or not. One that does not needs its data keys to still exist. [`resolveRetiredKeyUsage()`](./encryption-and-hashing.md#telling-when-a-rotation-is-done) counts each backup towards the keys it needs.

An encrypted backup that was changed where it is stored is refused before any of it is applied, even when the record beside it was changed to match.

## Storing backups in an S3 compatible bucket
`BaseS3BackupTransport` stores backups in a bucket of any service that speaks the S3 protocol, such as AWS S3, MinIO, Cloudflare R2, Backblaze B2, Hetzner, IONOS or Wasabi:

```ts
// src/backup/s3.backup-transport.ts
import { BackupTransport, BaseS3BackupTransport, S3BackupTransportOptions } from 'zibri';

import { secrets } from './secrets';

@BackupTransport()
export class S3BackupTransport extends BaseS3BackupTransport {
    override readonly name: string = 's3-backup-transport';
    protected override readonly options: S3BackupTransportOptions = {
        endpoint: 'https://s3.eu-central-1.amazonaws.com',
        bucket: 'my-app-backups',
        region: 'eu-central-1',
        credentials: { accessKeyId: secrets.s3AccessKeyId, secretAccessKey: secrets.s3SecretAccessKey },
        serverSideEncryption: 'bucket-default',
        prefix: 'production',
        addressingStyle: 'virtual-hosted'
    };
}
```

For credentials that expire, such as those of a role your workload assumes, pass a function as `credentials`. The transport calls it before every request and sends the `sessionToken` it returns. Return the same credentials for as long as they are valid:

```ts
// src/backup/workload-s3.backup-transport.ts
import { BackupTransport, BaseS3BackupTransport, S3BackupTransportOptions } from 'zibri';

import { resolveWorkloadCredentials } from './workload-credentials';

@BackupTransport()
export class WorkloadS3BackupTransport extends BaseS3BackupTransport {
    override readonly name: string = 'workload-s3-backup-transport';
    protected override readonly options: S3BackupTransportOptions = {
        endpoint: 'https://s3.eu-central-1.amazonaws.com',
        bucket: 'my-app-backups',
        region: 'eu-central-1',
        credentials: resolveWorkloadCredentials,
        serverSideEncryption: { algorithm: 'aws:kms', keyId: 'alias/my-app-backups' },
        addressingStyle: 'virtual-hosted'
    };
}
```

A credential provider of the AWS SDK, such as `fromNodeProviderChain()` of `@aws-sdk/credential-providers`, has that shape and keeps its credentials until they expire, so you can pass it as it is.

`serverSideEncryption` says how the service encrypts the backups it stores:

| `serverSideEncryption` | Every backup is stored |
|---|---|
| `'bucket-default'` | As the default encryption of the bucket says. |
| `{ algorithm: 'AES256' }` | Encrypted with keys the service manages. |
| `{ algorithm: 'aws:kms', keyId? }` | Encrypted with a key of the service's key management service: `keyId`, or the service's default key without one. |

This is independent of [`encrypt`](#encrypting-backups), which encrypts a backup before it leaves your application.

Every upload carries the digest of what it sends, so a bucket with object lock and a default retention period takes backups and keeps each of them for that period.

The bucket has to exist. Each resource is stored as the object `<prefix>/<backup name>/<resource name>`, and the record of the backup as `<prefix>/<backup name>/metadata.json` beside it.

`addressingStyle` says where the bucket is named in a request: `virtual-hosted` puts it into the host name (`https://my-app-backups.s3.eu-central-1.amazonaws.com`), `path` into the path (`https://s3.eu-central-1.amazonaws.com/my-app-backups`). Use the one your service documents. `region` is the region of the bucket; a service without regions names the one it expects, usually `us-east-1` or `auto`.

A backup is uploaded in parts of `partSize`, `16mb` by default. A backup is at most 10,000 parts, so the default allows backups of up to 156gb. For larger ones, raise `partSize`, up to `5gb`. Each part is held in memory while it is uploaded.

A backup that fails while it is uploaded is aborted, which removes the parts uploaded so far. When the abort itself fails, the transport logs a warning naming the upload, and its parts stay stored until you abort it or a lifecycle rule of the bucket removes it.

## Storing backups on an SFTP server
`BaseSftpBackupTransport` stores backups in a folder on any server you can reach over SFTP, such as a storage box, a NAS or a machine of your own. It needs the `ssh2` package, see [requirements](#requirements):

```bash
npm i ssh2
```

```ts
// src/backup/sftp.backup-transport.ts
import { BackupTransport, BaseSftpBackupTransport, SftpBackupTransportOptions } from 'zibri';

import { secrets } from './secrets';

@BackupTransport()
export class SftpBackupTransport extends BaseSftpBackupTransport {
    override readonly name: string = 'sftp-backup-transport';
    protected override readonly options: SftpBackupTransportOptions = {
        host: 'backups.example.com',
        username: 'my-app',
        authentication: { privateKey: secrets.sftpPrivateKey },
        hostKeyFingerprint: 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
        path: '/backups/production'
    };
}
```

Each resource is stored as the file `<path>/<backup name>/<resource name>`, and the record of the backup as `<path>/<backup name>/metadata.json` beside it. The folder is created when it does not exist.

`authentication` is either `{ password }` or `{ privateKey, passphrase? }`, with the key in OpenSSH format as it is written in its file.

`hostKeyFingerprint` is the fingerprint of the key the server identifies itself with, and a server presenting any other key is refused. Your provider usually publishes it; otherwise, read it from a machine you trust:

```bash
ssh-keyscan -t ed25519 backups.example.com | ssh-keygen -lf -
```

When the server presents a different key, the error names the key it presented, so you can compare the two.

## Creating and restoring backups
`createBackup` takes a backup of every resource:

```ts
// src/services/backup.service.ts
import { BackupServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function createBackup(): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    await backupService.createBackup();
}
```

`restore` restores one:

```ts
// src/services/backup.service.ts
import { BackupEntity, BackupServiceInterface, inject, Repository, repositoryTokenFor, ZIBRI_DI_TOKENS } from 'zibri';

export async function restoreBackup(): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
    const backup: BackupEntity = await backupRepository.findById('42', { relations: ['resources'] });
    await backupService.restore(backup);
}
```

`delete` removes a backup from every transport that holds it, and from the database:

```ts
// src/services/backup.service.ts
import { BackupEntity, BackupServiceInterface, inject, Repository, repositoryTokenFor, ZIBRI_DI_TOKENS } from 'zibri';

export async function deleteBackup(): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
    const backup: BackupEntity = await backupRepository.findById('42', { relations: ['resources'] });
    await backupService.delete(backup);
}
```

A backup whose resources name a transport the application does not register is refused, and stays as it is.

## Backups the database does not know about yet
When the application starts, it records every backup its transports hold that the database does not know about yet, such as after a restore of the database. A transport that cannot be reached then is skipped with a warning naming it, and the application starts. The next sync that reaches it records what only that transport holds.

To sync at any other time, call `syncBackupEntities()`. It fails when a transport cannot be reached.

## What a restore checks first

Creating a backup records the size and the checksum of each resource. It marks the resource complete
once every transport has taken all of it. A restore fetches the stored data and checks it against that
record. When the two differ, the restore fails before it applies any of it, so an archive that was
truncated or altered where it is kept changes nothing.

The record is stored beside the data on every transport, as well as in the database, so a restore of
that database can check it too. A resource without that record, or not marked complete, is refused: its
backup never finished.

## A restore of several resources

A restore fetches and checks the data of every resource before it applies any of them. It then takes a
snapshot of what each resource holds right now, and applies the resources one after another.

When one of them fails to apply, the restore puts every resource it already touched back from its
snapshot, the failing one included, and fails with that resource's error. When a resource cannot be put
back either, the error names it and the file its snapshot is kept in, in `BACKUP_TEMP_FOLDER`. The daily
job removes that file like any other leftover, 12 hours after it was written.

When the process is killed during a restore, the next start puts back every resource the restore had
started applying, from their snapshots, before anything else, and logs which ones. A resource that
cannot be put back is logged with the file its snapshot is kept in, and tried again at every start
until it is; the daily job keeps that file. The snapshots are on this instance's disk, so an instance
started on a fresh disk has nothing to put back.

## A backup of another release

A data source brings what it restores in line with the release restoring it: it runs every
[migration](./data-source.md#handling-migrations) the backup has not recorded and makes the indexes and uniques
match what the entities declare, before the restore is done. A backup an older release took comes back
in the schema of the current one.

A backup holding a migration of a newer release is refused, and the error names the migration. Restore
it with a build of that version or a newer one.

## Restoring with one instance

Run a restore while one instance of your application is running: stop the others before you restore,
and start them again once it is done.

## When the application stops

When the application stops while a backup or restore is running, it waits for it for
`ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS`, 0 by default, and then stops it:

- A backup stops and is deleted, from every transport and from the database. `createBackup` fails
  with an error saying so.
- A restore stops before its next resource and puts back every resource it already applied, the same
  way as when one of them fails to apply. `restore` fails with an error saying so.

Stopping takes up to 30 seconds more. Choose the wait so that both fit into the time your orchestrator
gives the process before it kills it:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS, useValue: Ms.MINUTE * 5 });
```

## Where a backup passes through

A backup passes through this instance's own disk. It is written there on its way out, and fetched
there on its way back. Leave room for the largest backup being taken at a time, and for twice the
largest being restored: a restore holds the archives of all its resources and a snapshot of each at
once. `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER` says where, and defaults to `.zibri/backups` beside the
application. Each file is removed as soon as the backup or restore it belongs to is done. A daily job
clears anything a killed process left behind, except what the next start puts a killed restore back
from.

A restore reads each transport once. While a backup is taken, every transport reads the file as it is
written, so a slow transport holds back neither the other transports nor the resource producing the
data.

## The shape a backup is written in

A backup records two versions:

| Field | What it is |
|---|---|
| `zibriVersion` | The build that took the backup |
| `formatVersion` | The shape the backup is written in. A restore reads it |

A backup written in a shape this build does not read is refused by name, before any of it is applied.
`READABLE_BACKUP_FORMAT_VERSIONS` lists the shapes this build reads, and `BACKUP_FORMAT_VERSION` is
the one it writes. `BACKUP_FORMAT_VERSION` changes when the shape of a backup changes, independent of
the release.

The shape covers the record stored beside the data, the fields a restore reads from it, and how
encrypted data is sealed. What a resource's own `createBackupData` produces belongs to the resource: a
Postgres dump is read by Postgres.

A transport stores the record and hands it back unopened, so a transport of your own works with every
shape.

## Requirements
| Package | Used for |
|---|---|
| `ssh2` | Reaching an SFTP server, with `BaseSftpBackupTransport`. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `BackupEntity`, `BackupResourceEntity` | A backup resource is registered |

## See also
- [Data sources](./data-source.md) — `PostgresDataSource` and other data sources that back up automatically
- [Encryption and hashing](./encryption-and-hashing.md#setting-the-master-key) — the master key encrypted backups are restored with
