---
keywords: [backups, restore, dump, disaster recovery, deduplication, gc, scrub, incremental backup, logical decoding, replication slot, downtime, blocking, locks, memory, point in time recovery, pitr, physical backup, pgbackrest]
---

# Backup
A backup copies the data of a resource, such as a data source, to one or more transports: a folder, an S3 bucket or an SFTP server. You take backups with the backup service, and restore your application from one later.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Backup` | decorator | Marks a class as a backup resource, defining what should be backed up |
| `BackupResourceMetadataInput` | type | What `@Backup` takes: the `transports` to back the resource up to, whether to `encrypt` it, and its `name` |
| `BackupResourceInterface` | interface | Contract for extracting and restoring a resource's data |
| `isBackupResource` | function | Checks whether a value implements `BackupResourceInterface` |
| `BackupDataOptions` | type | What a backup does with the data `createBackupData` hands over: `chunked` when it cuts the data into chunks, which a resource leaves its own compression off for, and the `stagingFolder` a resource may sort in on the way |
| `BackupTransport` | decorator | Marks a class as a backup transport, listed in `backupTransports` of the application options |
| `FsBackupTransport` | class | Keeps the backups in a folder of this instance's own disk |
| `S3BackupTransport` | class | Stores the backups in a bucket of an S3 compatible object storage |
| `SftpBackupTransport` | class | Stores the backups in a folder on a server reached over SFTP |
| `BackupTransportInterface`, `isBackupTransport` | type, function | What a transport implements, of the versions it names: `BackupTransportInterface<'v2'>` [opens sessions](#writing-a-transport-of-your-own). Without a version it is a transport of `v1`, which is deprecated. And the check whether a value supports a version |
| `PostgresBackupScope` | type | What a backup of a Postgres data source covers: `'schema'` or `'entity-tables'`. Required with `@Backup` |
| `ValKeyBackupMode` | type | How a backup of a Valkey data source is taken, its `backupMode`: `'snapshot'` or `'walk'`. Required with `@Backup` |
| `ValKeyRestoreMode` | type | How a restore of a Valkey data source writes the backup, its `restoreMode`: `'staged'` or `'direct'`. Set it with `@Backup` |
| `S3BackupTransportOptions` | interface | Where and how `S3BackupTransport` stores backups |
| `S3Credentials` | type | What requests to the bucket are signed with: an access key and its secret |
| `S3ServerSideEncryption` | type | How the storage encrypts the backups it holds: `'bucket-default'`, `AES256` or `aws:kms` |
| `SftpBackupTransportOptions` | interface | Where and how `SftpBackupTransport` stores backups |
| `SftpAuthentication` | type | How `SftpBackupTransport` logs in: a password, or a private key |
| `BackupTransportVersion`, `BackupTransportVersionMembers` | type, type | The versions of `BackupTransportInterface`, `'v1'` and `'v2'`, and what each has a transport implement |
| `BackupTransportSupporting` | type | A transport supporting a version, or one of several, such as what `backupTransports` takes |
| `BackupTransportSessionInterface` | interface | A session of a transport: `put`, `get`, `findKeys`, `findNames`, `delete` and `close` |
| `BackupKeyNotFoundError` | error | What `get` of a session fails with for a key that holds nothing |
| `BackupKeyAccessDeniedError` | error | What `get` of a session fails with for a key the transport may not read |
| `resolveBackupKeySegments` | function | The segments of a key, refusing one that could lead a file outside the transport's folder |
| `BaseBackupTransport` | class | The base of the shipped transports: a `name` and `openSession` make a transport of both versions, used as `v2` |
| `BaseFsBackupTransport`, `BaseS3BackupTransport`, `BaseSftpBackupTransport` | class, class, class | Deprecated. The shipped transports configured through properties, named at boot. Use `FsBackupTransport`, `S3BackupTransport` and `SftpBackupTransport` instead |
| `BackupServiceInterface` | interface | Service for creating and restoring backups |
| `BackupCreateData` | type | What `queueBackup` takes |
| `BackupService` | class | Default implementation of `BackupServiceInterface`. Replaceable through ZIBRI_DI_TOKENS.BACKUP_SERVICE |
| `BackupEntity` | class | Entity representing a created backup |
| `BackupStatus` | enum | `RUNNING`, `COMPLETED` or `FAILED`: where a backup stands |
| `BackupResourceEntity` | class | Entity representing a resource's data within a backup, with the attempts spent storing it |
| `BackupChunkEntity` | entity | The [chunks](#storing-unchanged-data-once) each transport holds, so that a backup does not have to list them on the transport |
| `BackupChunkingOptions` | type | How the data of a resource is cut into chunks and compressed: `minChunkBytes`, `averageChunkBytes`, `maxChunkBytes` and `compressionLevel` |
| `ZIBRI_DI_TOKENS.BACKUP_CHUNKING_OPTIONS` | DI token | The `BackupChunkingOptions`. Defaults to chunks of 256 KiB to 4 MiB, about 1 MiB on average, compressed at level 3 |
| `BackupGarbageCollectionCronJob` | cron job | [Deletes what the transports hold](#freeing-the-space-of-deleted-backups) that no backup needs, once a day. Registered for you |
| `BackupScrubOptions` | type | [How the stored chunks are checked](#checking-the-stored-chunks): `cycleInDays` |
| `ZIBRI_DI_TOKENS.BACKUP_SCRUB_OPTIONS` | DI token | The `BackupScrubOptions`. Defaults to none, which reads no chunk back |
| `BackupFailedError` | error | What `waitForBackup` fails with when a resource of the backup spent its attempts. Names the resource and what it failed with |
| `BackupStoppedError` | error | What `waitForBackup` fails with when the application shuts down while waiting |
| `RestoreStoppedError` | error | What a restore fails with when the application shuts down during it |
| `RestoreNotUndoneError`, `NotUndoneResource` | error, type | What a failed restore fails with when a resource could not be put back, and where what it held is kept: `snapshotPaths` |
| `RestoreOptions` | type | How `restore` restores a backup: the `resources` to restore, whether it keeps copies to `putBack`, whether it deletes what each resource holds first (`deleteFirst`), and whether it skips the check of this instance's disk (`skipSpaceCheck`) |
| `NotEnoughRestoreSpaceError`, `NotEnoughRestoreSpaceReason`, `RestoreSpace`, `RestoreSpaceOfResource` | error, type, type, type | What a restore is refused with when this instance's disk is too small for it, or ends with when the disk ran out before it changed anything: what each resource takes, what is free, and every way to go on |
| `UnreadableBackupError` | error | What a restore fails with for a backup written in a format this build does not read |
| `IncompleteBackupError` | error | What a restore fails with for a resource that was never finished being written |
| `CorruptBackupError` | error | What a restore fails with for stored data that is not what the backup recorded |
| `BackupTransportNotFoundError` | error | What startup fails with for a backup resource no transport takes |
| `InitBackupServiceError` | error | What startup fails with when the backup service cannot start |
| `RunQueuedBackupsCronJob` | cron job | Stores the resources of queued backups that are due on this instance. Registered for you |
| `ZIBRI_DI_TOKENS.BACKUP_MAX_ATTEMPTS` | DI token | How many times a resource is tried before its backup fails. Defaults to 3 |
| `ZIBRI_DI_TOKENS.BACKUP_MAX_CONCURRENT_RESOURCES` | DI token | How many resources one instance stores at once. Defaults to 1 |
| `ZIBRI_DI_TOKENS.BACKUP_RETRY_DELAY_IN_MS` | DI token | How long the first retry of a resource waits, doubling for each one after it. Defaults to one minute |
| `ZIBRI_DI_TOKENS.WAIT_REPORT_INTERVAL_IN_MS` | DI token | How often `waitForBackup` warns where a backup it still waits for stands. Defaults to 30 seconds |
| `ZIBRI_DI_TOKENS.BACKUP_SERVICE` | DI token | Injects `BackupServiceInterface` |
| `BackupRetention` | type | Which completed backups are kept: `daily`, `weekly`, `monthly` and the other rules, counted in a `timeZone`, and how often a backup reading only what changed reads in full, `fullRead` |
| `BackupPeriod` | type | A period a retention counts in: `'hourly'`, `'daily'`, `'weekly'`, `'monthly'`, `'quarterly'` or `'yearly'` |
| `IncrementalBackupResourceInterface`, `isIncrementalBackupResource` | interface, function | What a resource [reading only what changed](#reading-only-what-changed) implements beside `BackupResourceInterface`, and the check whether a value does |
| `TenantBackupTransport`, `TenantBackupTransportCreateData` | entity, type | Storage a [tenant](../glossary.md#tenant) [keeps its backups on](#letting-a-tenant-back-up-to-its-own-storage), of a kind the application lists, and what adds one |
| `TenantBackupTransportKindInterface`, `AnyTenantBackupTransportKind`, `TenantTransportNetwork` | interface, type, type | A [kind of storage](#offering-tenants-a-kind-of-storage-of-your-own) tenants may keep their backups on, any of them, and what every host it reaches is checked by |
| `S3TenantBackupTransportKind`, `SftpTenantBackupTransportKind` | class, class | A bucket of an S3 compatible storage, and an SFTP server, as kinds tenants may configure |
| `TenantS3TransportSettings`, `TenantS3TransportSecret`, `TenantSftpTransportSettings`, `TenantSftpTransportSecret` | class, class, class, class | Where a tenant's bucket or SFTP server is, and the secret it logs in with |
| `TenantBackupTransportOptions` | type | What tenants may configure as transports: `kinds`, `allowedHosts` and `allowPrivateNetworks` |
| `ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS` | DI token | The `TenantBackupTransportOptions`. Defaults to S3 and SFTP at public addresses |
| `TenantBackupSettings`, `TenantBackupRetention` | entity, class | The retention a tenant keeps its backups by, as it is stored |
| `TenantExportFormat` | type | How [an export](#exporting-a-tenant) of a tenant writes its rows: `'json-lines'` or `'csv'` |
| `IncrementalBackupData` | type | What `createIncrementalBackupData` hands a backup: the `data`, whether it is `full`, and the `cursor` the next backup reads on from |
| `ZIBRI_DI_TOKENS.BACKUP_RETENTION` | DI token | The `BackupRetention` applied each time a backup completes. Defaults to none, which keeps every backup |
| `BACKUP_FORMAT_VERSION` | constant | The shape backups are written in by this build |
| `READABLE_BACKUP_FORMAT_VERSIONS` | constant | The shapes this build restores from |
| `BACKUP_REPOSITORY_FOLDER` | constant | The folder at the top of a transport the chunks and records of backups are kept under, `.zibri-repository`. No backup may have it as its name |
| `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER` | DI token | Where a backup is staged on its way to and from a transport |
| `ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS` | DI token | How long the application waits for a running backup or restore when it stops. Defaults to 0 |
| `ZIBRI_DI_TOKENS.BACKUP_STOPPING_TIMEOUT_IN_MS` | DI token | How long stopping a running backup or restore may take after that. Defaults to 30 seconds |

## The parts of the backup system
### One or more backup resources
A backup resource is what gets backed up. Mark it with the `@Backup` decorator.

A resource implements `BackupResourceInterface`, which says how its data is extracted, such as by a SQL dump, and how it is read back in. `restoreBackup` gets the data, and a function that reads it again from its start, for a restore that reads it more than once.

### One or more backup transports
A backup transport stores the extracted data, and fetches it again for a restore. It is a class decorated with `@BackupTransport`, listed in `ZibriApplicationOptions.backupTransports`.

A transport opens sessions that store data under keys, and knows nothing of backups. Everything a backup stores is kept under `.zibri-repository/`: the [chunks](#storing-unchanged-data-once) of its resources under `chunks/`, a list of them per resource and the record of the backup under `backups/<backup id>/`. Backups of format 1 are kept under `<backup name>/`. To write a transport of your own, see [writing a transport of your own](#writing-a-transport-of-your-own).

### The backup service
The backup service creates and restores backups of the resources, through their transports.

## Backing up a data source
This Postgres data source is backed up:

```ts
// src/data-sources/db/db.data-source.ts
import { Backup, BackupEntity, BackupResourceEntity, BackupTransport, BaseEntity, DataSource, FsBackupTransport, FsUtilities, Newable, PostgresBackupScope, PostgresDataSource, PostgresOptions, PostgresPooler, RepositoryClass, SchemaManagement } from 'zibri';

@BackupTransport()
class DiskBackupTransport extends FsBackupTransport {
    constructor() {
        super('fs-backup-transport', FsUtilities.getPath('./backups'));
    }
}

@DataSource()
@Backup({ transports: [DiskBackupTransport], encrypt: true })
class DbDataSource extends PostgresDataSource {
    options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: true
    };
    schemaManagement: SchemaManagement = 'synchronize';
    pooler: PostgresPooler = 'none';
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

A `PostgresDataSource` that reads its data for a backup, or for the copy a restore keeps, for longer than `ZIBRI_DI_TOKENS.WAIT_REPORT_INTERVAL_IN_MS`, 30 seconds by default, warns at every interval where the read stands: the step it is at, whether it waits for the backup to read on, and each busy connection to the database with its process id, application name, state, what it waits for and the first 200 characters of its query. A connection waiting for a lock names each connection holding it the same way. The query is the statement as that connection sent it, of any application connected to the database. Each string in it is logged as `'*****'`, and a number written into it is logged as it is.

A backup cut into [chunks](#storing-unchanged-data-once) takes the dump uncompressed, and compresses each chunk instead, so that tables that did not change are stored once. Its staging file is [compressed](#where-a-backup-passes-through). A backup to a transport used as `v1` takes the dump compressed.

To back up a resource to every registered transport, set `transports: 'all'` in the decorator.

A backup covers what its resource owns, and a restore replaces exactly that. On a Postgres data source, `backupScope` says what that is. A data source marked with `@Backup` has to set it, see [why some options have no default](../faq.md#why-do-some-options-have-no-default):

| `backupScope` | A backup covers | Use it when |
|---|---|---|
| `'schema'` | The schema the data source works in: every table and other object in it, such as the views, types and functions your migrations create. | The schema belongs to this application alone. |
| `'entity-tables'` | The tables of the data source's entities. Everything else in the schema is neither backed up nor touched by a restore. | Anything else keeps tables in the same schema, such as another application or reporting. |

Either way, a backup carries each object's owner, its grants and its comments, and other schemas of the same database are neither backed up nor touched by a restore. With `'entity-tables'`, a restore fails and changes nothing when anything outside those tables depends on one of them, such as a view or a foreign key of another table. Remove it before the restore and create it again afterwards.

A restore gives every object back to the role that owned it when the backup was taken. A role the backup names as an owner or in a grant has to exist on the server you restore to. Otherwise the restore fails and changes nothing.

The credentials the resource already runs with are enough to take and restore a backup. To run backups as another role, set `rootUsername` and `rootPw`. That role has to be a member of every role that owns an object the backup covers.

`FsBackupTransport` writes the backups to the folder it is given, on this instance's own disk. Each file of a backup is on the disk before the backup goes on, so a machine going down leaves it whole or not there at all. A file is written into the `.partial` folder of that folder first and moved into place once it is complete. A file in `.partial` that was not written to for a day is left over from an interrupted backup, and the next backup deletes it.

> [!WARNING]
> A backup on the instance's own disk is lost with that disk. Use `FsBackupTransport` for testing, and another transport in production.

A `ValKeyDataSource` marked with `@Backup` sets `backupMode` instead, which says how its keys are read:

| `backupMode` | A backup | Use it when |
|---|---|---|
| `'snapshot'` | Copies every key at one moment, then reads the copies a batch at a time. A transaction committed while it is taken is in it whole or not at all, and so is a write past the data source. The server answers nothing else until every key is copied, and holds each copy until it is read. A backup fails when the server has less memory free than the copies need, within its `maxmemory` or else its machine's memory. | The store is small enough to pause for, such as sessions or a cache, and the server has room for a second copy of it, or your application writes to it through `connection`. |
| `'walk'` | Reads the keys a batch at a time, while the server goes on answering, each as it was when the backup began: a write through the data source copies the key it writes first, once, and the backup reads that copy. The server holds a copy of each key written while the backup runs. Of a set, such as the ids of a table, a write notes only the members it adds or removes. A set written whole is copied only when the copy fits into the memory the server has free, and otherwise the write goes on and the backup fails. A transaction committed meanwhile is in it whole or not at all. A write to the server past the data source, through `connection`, copies nothing, and the backup reads such a key as it is when it gets to it. A backup that read two rows holding the same unique value that way fails rather than being stored, since its restore would refuse it. | The store is too large to pause the server for, or to copy, and every write goes through the data source. |

It sets `restoreMode` too, which says how a restore writes the backup:

| `restoreMode` | A restore | Use it when |
|---|---|---|
| `'staged'` | Writes the backup beside what is stored, then swaps it in at one moment. No reader sees part of the backup, and a restore that fails before the swap changes nothing. The server holds the backup beside what it replaces until the swap, and answers nothing else while it swaps. | The server has the memory for a second copy of the store. |
| `'direct'` | Deletes what is stored and writes the backup in its place a batch at a time, while the server goes on answering. A reader meanwhile sees part of the backup, and a key written meanwhile can stay beside it. A restore that fails part way is put back from its snapshot, so it needs about twice the size of the data source, compressed, in `BACKUP_TEMP_FOLDER`. A restore of a tenant writes its rows so too, rather than in one transaction, which holds them all in the application until it commits. | The server has no memory to spare, the store is too large to pause the server for, or a tenant holds more rows than one transaction carries. |

Without `restoreMode`, the application warns at boot and restores `'staged'`. It is required from 4.0.

The Valkey server sets `maxmemory`, and `maxmemory-policy` to `noeviction`. A backup copies keys only when they fit into what `maxmemory` leaves free, and a `'staged'` restore that does not fit fails and changes nothing. Without `maxmemory`, a backup counts the memory of the server's machine, which in a container is the memory of the host rather than the container's limit. Under a policy that evicts, the server evicts rows to make room for writes, and keys a `'staged'` restore wrote before it swaps them in. The application warns at boot about either. Both are required from 4.0.

Either way, a restore builds the ids, indexes and uniques of every entity again from the rows it restored.

A backup reads the keys in the order of their names, so that keys that did not change are stored once. It sorts the names in the staging folder, encrypted, beside the data, holding about 4 MiB of them in memory and at most 64 files open at once, however many keys there are. A set of more than 1 000 members, such as the ids of a table, is read and restored 250 members at a time. A walk reads such a set from a copy of it alone, made at one moment, so the server needs room for a copy of the largest one, and a backup fails when it lacks it.

## Keeping rows across a restore

On every data source, a backup leaves out the rows of an entity declared `@Entity({ backedUp: false })`, and a restore keeps the rows it holds now. An entity declared `@Entity({ backedUp: 'keptForCurrentUsers' })` is backed up, and a restore of the application keeps its rows of every user that exists when the restore begins. The backup's rows come back for the users that did not exist then, such as on a fresh database. Such an entity holds the user in a `userId` property. An entity whose rows belong to the rows of such an entity declares `@Entity({ backedUp: { keptWith: () => FederatedIdentity, by: 'identityId' } })`: a restore keeps a row exactly when it keeps the row `by` names, and both are declared in the same data source.

| Entities | What a restore of the application does with them |
|---|---|
| `Lease`, `BackupEntity`, `BackupResourceEntity`, `BackupChunkEntity`, `EventSubscriberRegistration` | Keeps what the instances running hold: the grants, the backups they took and the subscribers of events they host |
| `JwtRefreshToken`, `JwtRevokedAccessToken`, `CookieAuthSession`, `CookieAuthRefreshSession` | Keeps the logins: one ended since the backup stays ended, and one started since goes on. After a restore onto a fresh database, users log in again |
| `LoginTicket`, `PasswordResetToken`, `EmailVerificationToken`, `TwoFactorCode`, `PasskeyChallenge`, `PasskeyRegistrationTicket`, `FederatedLoginAttempt`, `FederatedHandoverCode`, `FederatedConnectionCode`, `FederatedRegistrationTicket` | Keeps what is under way: a link or code used since the backup stays used |
| `PasswordFailureStreak`, `TwoFactorFailureStreak`, `RateLimitStateEntity` | Keeps the counts, so that a restore gives no one guessing or over a limit fresh attempts |
| `PasswordCredentials`, `ApiKey`, `Passkey`, `OtpCredentials`, `TwoFactorCodeCredentials`, `TwoFactorRecoveryCode`, `FederatedIdentity`, `LdapIdentity` | Keeps the credentials of every user that exists when it begins: a password changed since the backup stays the one the user logs in with, a key or [passkey](../glossary.md#passkey) revoked since stays revoked, and one created since keeps working. These are `'keptForCurrentUsers'` |
| `OAuthProviderTokens` | Keeps the tokens of the identities it keeps, as the provider issued them last. Kept with `FederatedIdentity` by `identityId` |

A restore of a tenant never writes them, since they are shared by every tenant.

Declare `backedUp: false` on an entity of your own whose rows belong to the running instances rather than to your data, `'keptForCurrentUsers'` on one holding the credentials of a user, and `{ keptWith, by }` on one whose rows belong to those. An entity kept with one its data source does not declare `'keptForCurrentUsers'` is restored as the backup holds it, and the application warns at boot. A user service of your own implements `streamUserIds` and `findStoredUserIds` of `UserServiceInterface` for the second, which are optional until 4.0. Without them, a restore writes the credentials of the backup and warns.

A user that a restore brings back, deleted since the backup, comes back with the credentials of the backup. A login started after the backup goes on as well, such as one of somebody who should not have it: after a breach, end every login with [`endEveryLogin`](../auth/auth.md#logging-everybody-out), see [incidents](../operations/incidents.md#restoring-data-from-a-backup).

## Encrypting backups
`encrypt` says whether a resource's data is encrypted before it leaves the application. With `true`, each chunk of it is encrypted with the repository key of the application. Each transport holds that key, encrypted with the encryption service's `masterEncrypt` (see [the master key](./encryption-and-hashing.md#setting-the-master-key)), and each backup records it encrypted the same way. A [backup of a tenant](#backing-up-a-tenant) is encrypted with a repository key of that tenant's own, which only its transports hold. Neither this instance's disk nor any transport holds the data unencrypted. A resource that goes to a transport on `BackupTransportInterface` is encrypted with a key of its own per backup instead.

A restore needs the master key the backup was taken under. When you replace the master key, keep the old one in `oldMasterKeys` for as long as you keep backups taken under it. A backup whose master key is not listed is refused before anything is fetched, and the error names the key. The next backup after a replacement encrypts the repository key on each transport with the new master key. Until it ran, a backup needs the old one listed as well.

Every backup records the keys a restore of it needs: `masterKeys` and `dataKeyIds`. A backup that holds the data source the data keys are stored in brings them back itself, and needs the master keys they were encrypted under, encrypted or not. One that does not needs its data keys to still exist.

A restore of the application keeps the data keys and signing keys stored when it began beside those of the backup, and the default key and strategy stay the default. Every instance running goes on encrypting and signing with the keys it read before the restore, and what it writes afterwards stays readable, such as after restoring onto a fresh database or after a key rotation since the backup. A signing key the backup names the same as one stored now gives way to the one stored now, so what was signed with the backup's key, such as a session, is refused. [`resolveRetiredKeyUsage()`](./encryption-and-hashing.md#telling-when-a-rotation-is-done) counts each backup towards the keys it needs.

An encrypted backup that was changed where it is stored is refused before any of it is applied, even when the record beside it was changed to match.

## Storing unchanged data once
A backup cuts the data of each resource into chunks of about 1 MiB, at boundaries its content decides, and compresses each one. A transport stores each chunk once. A backup stores the chunks no earlier backup stored, and a list of the chunks of each resource.

What deduplicates is data that stays the same between two backups: uploaded files, tables nobody writes to, and rows only ever added to, such as a log of events. A change anywhere in a chunk makes it new, so changes spread across a large table, such as a share of its rows updated, make most of its chunks new. Every backup still reads each resource whole.

`ZIBRI_DI_TOKENS.BACKUP_CHUNKING_OPTIONS` sets the sizes of the chunks and how hard they are compressed. Smaller chunks deduplicate more, and make more objects on the transport. Larger chunks make fewer requests, which counts on a store that charges for each, such as a colder S3 storage class. A change of the sizes makes the next backup store everything anew:

```ts
// src/providers.ts
import { BackupChunkingOptions, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

const chunking: BackupChunkingOptions = {
    minChunkBytes: 512 * 1024,
    averageChunkBytes: 2 * 1024 * 1024,
    maxChunkBytes: 8 * 1024 * 1024,
    compressionLevel: 3
};

defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_CHUNKING_OPTIONS, useValue: chunking });
```

Declare `BackupChunkEntity` beside `BackupEntity`. It records which chunks each transport holds. Without it, each resource a backup stores first lists every chunk its transports hold, and the application warns at boot.

Deleting a backup deletes its record and its lists of chunks. The [garbage collection](#freeing-the-space-of-deleted-backups) deletes the chunks no other backup names.

## Reading only what changed
A Postgres data source with `incrementalRead: true` reads only the rows that changed since the backup before, rather than dumping everything each time. The backup reads less of the database, and stores and sends what changed:

```ts
// src/data-sources/db/db.data-source.ts
import { Backup, BackupEntity, BackupResourceEntity, BackupTransport, BaseEntity, DataSource, FsBackupTransport, FsUtilities, Newable, PostgresBackupScope, PostgresDataSource, PostgresOptions, PostgresPooler, RepositoryClass, SchemaManagement } from 'zibri';

@BackupTransport()
class TasksBackupTransport extends FsBackupTransport {
    constructor() {
        super('tasks-backup-transport', FsUtilities.getPath('./backups'));
    }
}

@DataSource()
@Backup({ transports: [TasksBackupTransport], encrypt: true })
class TasksDataSource extends PostgresDataSource {
    options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: true
    };
    schemaManagement: SchemaManagement = 'migrations';
    pooler: PostgresPooler = 'none';
    backupScope: PostgresBackupScope = 'schema';
    override readonly incrementalRead: boolean = true;
    entities: Newable<BaseEntity>[] = [
        BackupEntity,
        BackupResourceEntity
        //...
    ];
    repositories: RepositoryClass[] = [];
}
```

A backup reading only what changed builds on the backup before it, and a restore applies the backup in full it builds on and every backup after it, up to the one restored, in one transaction. It holds every change made in the database, written through a repository or not, such as by a migration, a cascade or another client. The first backup of each week reads in full again, and so does the next backup after a restore, after a change of the schema, or when the server dropped the changes since the backup before. `fullRead` of the [retention](#deleting-old-backups) sets the period instead of a week.

A backup reading only what changed starts once every transaction that writes and was running when it began has ended. While one is still open, the application warns every 10 seconds, naming each such transaction with its process id, application name, state and query.

Each table is read through the changes, or in full in every backup when the changes cannot carry it: an unlogged table, a table without a primary key or a replica identity of its own, and a table with a column `GENERATED ALWAYS AS IDENTITY`. Sequences are read in full in every backup.

The server and the role backups run as need:

| Setting | What it is |
|---|---|
| `wal_level` | `logical`. Changing it restarts the server. On a managed database it is a parameter, such as `rds.logical_replication` on RDS |
| `max_slot_wal_keep_size` | Set. It bounds how much of the WAL the data source's replication slot holds back while no backup reads it |
| `max_replication_slots` | 2 free for the data source |
| The database | Encoded in `UTF8` |
| The role | Allowed to replicate (`ALTER ROLE … REPLICATION`, or `rds_replication` on RDS), owns the tables backed up, has `CREATE` on the database, and may set `session_replication_role`: `GRANT SET ON PARAMETER session_replication_role TO …` |

The data source checks them at boot, and Postgres 13 or later. A backup in full waits for the transactions running when it starts to end.

> [!WARNING]
> The data source keeps a replication slot on the server, which holds back the WAL from the backup before on. While no backup runs, the WAL grows up to `max_slot_wal_keep_size`, after which the next backup reads in full. With `incrementalRead` off, the next boot drops the slot.

A table read through the changes keeps a primary key or a replica identity: Postgres refuses updates and deletes of a table that loses it until the next backup in full.

A resource of your own reads only what changed by implementing `IncrementalBackupResourceInterface` beside `BackupResourceInterface`.

## Storing backups in an S3 compatible bucket
`S3BackupTransport` stores backups in a bucket of any service that speaks the S3 protocol, such as AWS S3, MinIO, Cloudflare R2, Backblaze B2, Hetzner, IONOS or Wasabi:

```ts
// src/backup/bucket.backup-transport.ts
import { BackupTransport, S3BackupTransport } from 'zibri';

import { secrets } from './secrets';

@BackupTransport()
export class BucketBackupTransport extends S3BackupTransport {
    constructor() {
        super('s3-backup-transport', {
            endpoint: 'https://s3.eu-central-1.amazonaws.com',
            bucket: 'my-app-backups',
            region: 'eu-central-1',
            credentials: { accessKeyId: secrets.s3AccessKeyId, secretAccessKey: secrets.s3SecretAccessKey },
            serverSideEncryption: 'bucket-default',
            prefix: 'production',
            addressingStyle: 'virtual-hosted'
        });
    }
}
```

For credentials that expire, such as those of a role your workload assumes, pass a function as `credentials`. The transport calls it before every request and sends the `sessionToken` it returns. Return the same credentials for as long as they are valid:

```ts
// src/backup/workload-s3.backup-transport.ts
import { BackupTransport, S3BackupTransport } from 'zibri';

import { resolveWorkloadCredentials } from './workload-credentials';

@BackupTransport()
export class WorkloadS3BackupTransport extends S3BackupTransport {
    constructor() {
        super('workload-s3-backup-transport', {
            endpoint: 'https://s3.eu-central-1.amazonaws.com',
            bucket: 'my-app-backups',
            region: 'eu-central-1',
            credentials: resolveWorkloadCredentials,
            serverSideEncryption: { algorithm: 'aws:kms', keyId: 'alias/my-app-backups' },
            addressingStyle: 'virtual-hosted'
        });
    }
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

A request the service answers with a server error or `429` is sent again, `attempts` times in all, 3 by default, when sending it again cannot change its outcome. A request that fails all of them fails the resource, which is [tried again](#creating-and-restoring-backups) as a whole. `timeoutInMs` is how long one request may take, five minutes by default.

A backup that fails while it is uploaded is aborted, which removes the parts uploaded so far. When the abort itself fails, the transport logs a warning naming the upload, and its parts stay stored until you abort it or a lifecycle rule of the bucket removes it.

## Storing backups on an SFTP server
`SftpBackupTransport` stores backups in a folder on any server you can reach over SFTP, such as a storage box, a NAS or a machine of your own. It needs the `ssh2` package, see [requirements](#requirements):

```bash
npm i ssh2
```

```ts
// src/backup/storage-box.backup-transport.ts
import { BackupTransport, SftpBackupTransport } from 'zibri';

import { secrets } from './secrets';

@BackupTransport()
export class StorageBoxBackupTransport extends SftpBackupTransport {
    constructor() {
        super('sftp-backup-transport', {
            host: 'backups.example.com',
            username: 'my-app',
            authentication: { privateKey: secrets.sftpPrivateKey },
            hostKeyFingerprint: 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
            path: '/backups/production'
        });
    }
}
```

Each resource is stored as the file `<path>/<backup name>/<resource name>`, and the record of the backup as `<path>/<backup name>/metadata.json` beside it. The folder is created when it does not exist. A file is written into the folder `<path>/.partial` first and moved into place once it is complete. A file in `.partial` that was not written to for a day is left over from an interrupted backup, and the next backup deletes it.

`authentication` is either `{ password }` or `{ privateKey, passphrase? }`, with the key in OpenSSH format as it is written in its file.

`hostKeyFingerprint` is the fingerprint of the key the server identifies itself with, and a server presenting any other key is refused. Your provider usually publishes it; otherwise, read it from a machine you trust:

```bash
ssh-keyscan -t ed25519 backups.example.com | ssh-keygen -lf -
```

When the server presents a different key, the error names the key it presented, so you can compare the two.

A transfer takes as long as it needs while the server keeps answering. When the server answers nothing for 60 seconds while the transport waits for an answer, the transport ends the connection, and the backup or restore fails with an error naming what it waited for. `requestTimeoutInMs` sets another limit, in milliseconds. Connecting, logging in and opening the SFTP session after it take 20 seconds at most each, and `connectTimeoutInMs` sets another limit for them. A server that closes the connection before the login completed fails the backup or restore at once, with an error naming the server.

## Writing a transport of your own
A transport implements `BackupTransportInterface<'v2'>`: a `name`, the `versions` it supports, `['v2']`, and `openSession`, which connects to wherever the data is kept. One session serves everything one resource of a backup or a restore does, and is closed after it.

| Method of a session | What it does |
|---|---|
| `put(key, data)` | Stores the data whole or not at all, replacing what the key held. No reader sees part of it, and a put that fails leaves the key as it was |
| `get(key, maxBytes)` | Hands back what the key holds. Fails with `BackupKeyNotFoundError` when it holds nothing and with `BackupKeyAccessDeniedError` when the transport may not read it, and refuses a key holding more than `maxBytes` |
| `findKeys(prefix)` | Hands back every key starting with the prefix, a page at a time, in any order. A put still running is not among them |
| `findNames(path)` | Hands back the next segment of every key below a path, such as `backups` and `chunks` below `.zibri-repository`, each once, a page at a time. `''` is the top. A transport keeping folders may name an empty one as well |
| `delete(keys)` | Deletes the keys. A key that holds nothing is no error |
| `close()` | Ends the session. A stream `get` handed back is read to its end first |

A key is segments separated by `/`, such as `.zibri-repository/chunks/3f/3f9a…`. A transport that keeps what its keys hold as files checks each key with `resolveBackupKeySegments`, which refuses one that could lead outside its folder.

A transport can build on a shipped one, such as one keeping the backups on a mounted network drive:

```ts
// src/backup/nas.backup-transport.ts
import { BackupTransport, BackupTransportInterface, BackupTransportSessionInterface, FsBackupTransport, FsUtilities } from 'zibri';

@BackupTransport()
export class NasBackupTransport implements BackupTransportInterface<'v2'> {
    readonly name: string = 'nas-backup-transport';
    readonly versions: readonly 'v2'[] = ['v2'];
    // where the drive is mounted
    private readonly drive: FsBackupTransport = new FsBackupTransport(this.name, FsUtilities.getPath('/mnt/nas/backups'));

    async openSession(): Promise<BackupTransportSessionInterface> {
        return await this.drive.openSession();
    }
}
```

A transport of `v1`, `BackupTransportInterface` without a version, stores and finds each backup itself, in format 1, and is named at boot. A transport supporting both versions is used as `v2`. A transport built on a shipped one that sets its `versions` to `['v1']` is used as `v1`, so the members of `v1` it overrides are called.

## Creating and restoring backups
`queueBackup` queues a backup of every resource and starts storing it on this instance. It answers with the backup, `RUNNING`. `waitForBackup` waits until it is `COMPLETED`:

```ts
// src/services/backup.service.ts
import { BackupEntity, BackupServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function createBackup(): Promise<BackupEntity> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    const backup: BackupEntity = await backupService.queueBackup();
    return await backupService.waitForBackup(backup);
}
```

While it waits, `waitForBackup` warns every `ZIBRI_DI_TOKENS.WAIT_REPORT_INTERVAL_IN_MS`, 30 seconds by default, where the backup stands: each resource stored or not, its failed attempts, when the next is due and what the last failed with.

A backup is named after the time it is taken. A `name` you give `queueBackup` instead is one segment of a path, since every transport stores the backup under it: it holds no slash, and is not empty, `.` or `..`.

Each resource is stored on its own, by whichever instance claims it. An instance stores
`ZIBRI_DI_TOKENS.BACKUP_MAX_CONCURRENT_RESOURCES` resources at once, 1 by default, and leaves the others to the
instances that have room, or stores them one after another. Each resource being stored holds a staging file as large as
its data compressed, so this also bounds the disk and memory a backup takes on one instance. One whose transport fails is tried again after `ZIBRI_DI_TOKENS.BACKUP_RETRY_DELAY_IN_MS`, one minute by default, twice as long after each further attempt. Once a resource spent `ZIBRI_DI_TOKENS.BACKUP_MAX_ATTEMPTS`, 3 by default, the backup is `FAILED`, the resource keeps what it failed with as its `error`, and `waitForBackup` fails with a `BackupFailedError` naming it. What a failed backup stored is removed from the transports. Its record stays, with the `error` of each resource, until you `delete` it.

A backup is taken on whichever instance claims each resource, so a resource of your own reads the same data on every instance, as a data source does.

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

A restore holds every resource it applies, across all instances. While a backup or another restore holds one of them, the restore is refused with a `409` naming it. So is a restore while one before it left a resource that the next start [puts back](#a-restore-of-several-resources). A backup waits up to a minute for a resource a restore or another backup holds. After that, its attempt fails and is tried again like any other.

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

A backup whose resources name a transport the application does not register is refused, and stays as it is. So is a backup another completed or running backup [builds on](#reading-only-what-changed), with a `409` naming those.

## Taking backups on a schedule
A [cron job](../background-work/cron.md) of your own queues a backup at the times you choose, on one instance at a time:

```ts
// src/cron/nightly-backup.cron-job.ts
import { BackupServiceInterface, CronExpression, CronJob, InitialCronConfig, inject, Injectable, ZIBRI_DI_TOKENS } from 'zibri';

@Injectable()
export class NightlyBackupCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'NightlyBackup',
        cron: CronExpression.daily().at(3, 'hours').build()
    };

    async onTick(): Promise<void> {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        await backupService.queueBackup();
    }
}
```

The backup is stored by whichever instance claims each resource, so the job ends once the backup is queued.

## Deleting old backups
`ZIBRI_DI_TOKENS.BACKUP_RETENTION` says which completed backups to keep. Each time a backup completes, every other completed backup is deleted, from the transports and from the database:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.BACKUP_RETENTION,
    useValue: { timeZone: 'Europe/Berlin', withinInMs: Ms.DAY * 2, daily: 7, weekly: 4, monthly: 12, yearly: 5 }
});
```

| Option | What it is |
|---|---|
| `timeZone` | The time zone hours, days, weeks, months, quarters and years are counted in. Required |
| `withinInMs` | Keeps every backup taken within this long before now |
| `last` | Keeps this many of the newest backups |
| `hourly`, `daily`, `weekly`, `monthly`, `quarterly`, `yearly` | Keeps the newest backup of each of this many hours, days, weeks, months, quarters or years, the newest first. A week starts on Monday, and a quarter is three months from January, April, July or October |
| `fullRead` | How often a resource [reading only what changed](#reading-only-what-changed) reads in full: the first of its backups in each such period, `'hourly'` to `'yearly'`. Once a week by default |

The rules are those of `borg prune`. They apply in the order of the table, and a backup one rule keeps counts for no later rule. With the example above, the newest backups of the last 7 days are kept, then the newest of each of the 4 weeks before those, and so on. While a rule finds fewer periods than it asks for, it keeps the oldest backup too. A retention names at least one rule.

A backup reading only what changed keeps every backup it builds on, back to the one in full, for as long as it is kept itself.

A failed backup holds no data, and its record stays until you `delete` it. A backup that cannot be deleted, such as one on a transport that cannot be reached, is logged and tried again when the next backup completes.

## Freeing the space of deleted backups
A [chunk](#storing-unchanged-data-once) stays on its transport while any backup names it. Once a day, the garbage collection deletes what the transports hold that no backup needs: the chunks only deleted backups named, and what backups that never finished stored. `BackupGarbageCollectionCronJob` runs it on one instance, registered for you when a resource goes to a transport used as `v2`. `collectGarbage` of the backup service runs it at once:

```ts
// src/services/backup.service.ts
import { BackupServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function freeBackupSpace(): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    await backupService.collectGarbage?.();
}
```

`collectGarbage` is optional on `BackupServiceInterface` until 4.0, for a backup service of your own. While garbage is collected, a resource waits a few seconds at a time to be stored, and a restore goes on. One instance collects at a time.

Every backup a transport holds needs to be recorded in the database. A transport holding one that is not, such as a backup of a release this one cannot read, keeps its garbage until that backup is synced or deleted, and `collectGarbage` fails naming it.

The garbage collection also checks what each transport holds. A chunk recorded as stored that the transport does not hold is forgotten, so that the next backup stores it again. A backup naming a chunk that is missing is logged as an error, naming the resource and the transport it cannot be restored from.

> [!WARNING]
> A chunk deleted on the transport by anything else, such as a lifecycle rule of a bucket, breaks every backup naming it, and every backup taken before the next garbage collection that reuses it. Keep `.zibri-repository/` out of such rules.

## Checking the stored chunks
`ZIBRI_DI_TOKENS.BACKUP_SCRUB_OPTIONS` makes the garbage collection read chunks back and check each against its id, which finds a chunk that changed where it is stored. `cycleInDays` says in how many days every chunk is read once, and each day reads that share of them. It is off by default, since a transport such as S3 charges for what is read back:

```ts
// src/providers.ts
import { BackupScrubOptions, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

const scrub: BackupScrubOptions = { cycleInDays: 30 };

defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_SCRUB_OPTIONS, useValue: scrub });
```

A chunk that changed is deleted, so that the next backup stores it again, and every backup naming it is logged as an error. A chunk that cannot be read, such as while its transport cannot be reached, or one a newer release wrote, is warned about and left as it is.

## Backups the database does not know about yet
When the application starts, it records every backup its transports hold that the database does not know about yet, such as after a restore of the database. A transport that cannot be reached then is skipped with a warning naming it, and the application starts. The next sync that reaches it records what only that transport holds.

To sync at any other time, call `syncBackupEntities()`. It fails when a transport cannot be reached.

A folder on a transport that the application may not read, such as the `lost+found` at the top of a disk, is skipped with a warning naming it, and the backups beside it are recorded.

The backups a tenant keeps on [its own transports](#letting-a-tenant-back-up-to-its-own-storage) are recorded as garbage is collected, once a day. When the application starts, one instance also reads every transport of a tenant no recorded backup names, such as each of them after the database was restored, without holding back the start. `syncTenantBackupEntities(tenantId)` records those of one tenant at once, such as to restore it right after the database was restored, and fails when a transport of the tenant cannot be reached. A record on a tenant's transport of another tenant's backup, or of one stored on transports that are not the tenant's, is skipped with a warning.

## What a restore checks first

Creating a backup records the size and the checksum of each resource. It marks the resource complete
once every transport has taken all of it. A restore fetches the stored data and checks it against that
record, and each chunk against the hash it is stored under. When they differ, the restore takes the
resource from the next transport that holds it. When no transport holds it as recorded, the restore fails
before it applies any of it, so data that was truncated or altered where it is kept changes nothing.

The record is stored beside the data on every transport, as well as in the database, so a restore of
that database can check it too. A resource without that record, or not marked complete, is refused: its
backup never finished.

## A restore of several resources

A restore fetches and checks the data of every resource before it applies any of them. It then takes a
snapshot of what each resource holds right now, and applies the resources one after another.

When one of them fails to apply, the restore puts every resource it already touched back from its
snapshot, the failing one included, and fails with that resource's error. When a resource cannot be put
back either, the error names it and the file its snapshot is kept in, in `BACKUP_TEMP_FOLDER`. The next
start puts it back, the way it puts back a killed restore. Until then, every restore on this instance is
refused with a `409` naming the journal of the restore that left it. To give up putting it back, delete
that journal.

When the process is killed during a restore, the next start puts back every resource the restore had
started applying, from their snapshots, before anything else, and logs which ones. A resource that
cannot be put back is logged with the file its snapshot is kept in, and tried again at every start
until it is; the daily job keeps that file. The snapshots are on this instance's disk, so an instance
started on a fresh disk has nothing to put back.

A resource marked with `encrypt: true` is encrypted on this instance's disk as well: what a restore
fetched of it, under a key only the restore holds, and its snapshot, under a key its journal holds
encrypted by the [master key](./encryption-and-hashing.md#setting-the-master-key). Putting a snapshot back
needs a master key the application still holds.

A snapshot is checked against what was written before it is put back. One that differs, such as one a
machine going down left short, is not put back, and the error names its file.

A restore of one resource whose restore changes everything or nothing by itself takes no snapshot, and
needs half the disk: the data it fetched, and no copy beside it. A Postgres data source restores so when
the backup records exactly the migrations of this build, and no backup after the one in full it
[builds on](#reading-only-what-changed) records a migration, since then nothing runs after the one
transaction its data goes in in. A Valkey data source with `restoreMode: 'staged'` restores so when the
backup records exactly the migrations of this build, since then nothing runs after its swap. A backup of a
[tenant](#backing-up-a-tenant) does, except on a Valkey data source with `restoreMode: 'direct'`. Otherwise a
restore needs about twice the size of its largest resource, compressed, in `BACKUP_TEMP_FOLDER`. When such a restore
fails after its data went in, such as on a unique the restored rows break, the backup's data stays in
place and the error says so.

## A backup of another release

A data source brings what it restores in line with the release restoring it: it runs every
[migration](./data-source.md#handling-migrations) the backup has not recorded and makes the indexes and uniques
match what the entities declare, before the restore is done. A backup an older release took comes back
in the schema of the current one.

A backup holding a migration of a newer release is refused, and the error names the migration. Restore
it with a build of that version or a newer one.

## Backing up a tenant
`queueBackup({ tenantId })` backs up the rows of one [tenant](./tenancy.md) in every data source marked with `@Backup` that holds rows of tenants, to [the tenant's own storage](#letting-a-tenant-back-up-to-its-own-storage), and `restore` of that backup puts back exactly those rows while every other tenant goes on working:

```ts
// src/services/tenant-backup.service.ts
import { BackupEntity, BackupServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function backUpTenant(tenantId: string): Promise<BackupEntity> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    return await backupService.waitForBackup(await backupService.queueBackup({ tenantId }));
}

export async function restoreTenant(backup: BackupEntity): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    await backupService.restore(backup);
}
```

A backup of a tenant holds its rows as they are stored, encrypted values and hashes included, and is stored and encrypted like any other backup. It reads each data source as of one moment: a row written while it is read is in it with every row it points at, or not at all. A restore of it replaces the tenant's rows in each data source in one transaction: the rows created since are deleted, and the rows of the backup come back with their ids, so encrypted values stay readable. On a Valkey data source with `restoreMode: 'direct'` it replaces them a batch at a time instead, as the restore of the application does, and a restore that fails part way is put back from its snapshot. Rows every tenant shares are never touched. The rows of an append-only or chained entity stay as they are, and the backup leaves them out. The restore is recorded in the tenant's [audit trail](./audit.md) as `backup.tenant.restored`, with the name of the backup.

A row that a row outside the backup points at, such as a customer an append-only invoice points at, stays in place, and the restore writes the values of the backup over it. When the backup does not hold it, because it was created since, the restore keeps it, together with every row it points at that was created since as well. A kept row is soft deleted when its entity [soft deletes](../glossary.md#soft-delete), see [soft deleting rows](./data-source.md#soft-deleting-rows). A value of a unique that a kept row holds, and that the backup gives to another row, gives way to a stand-in no other row holds:

| Type of the value | Stand-in |
|---|---|
| Text | The value with the moment of the restore appended, such as `ada@example.com_20261113T083418123Z` |
| Number | The next free number after it |
| Date | The next free millisecond after it |
| uuid | A new uuid |
| Any other, where the property is optional | No value |

The application logs a warning naming each kept row and the properties that gave way.

> [!NOTE]
> A restore fails and changes nothing when a kept row holds a value of a unique that the backup gives to another row, and none of the properties of that unique takes a stand-in, such as a required enum or a required relation.

A tenant restore holds the data sources it replaces rows in, as a restore of the application does. The [retention](#deleting-old-backups) counts the backups of each tenant on their own, apart from those of the application.

Whether a caller may back up or restore a tenant is a permission of your application, see [roles and permissions](../auth/roles-and-permissions.md).

## Letting a tenant back up to its own storage
A tenant can keep its backups on storage of its own, such as a bucket or an SFTP server. Declare `TenantBackupTransport` beside `BackupEntity`, and add the tenant's transport through the backup service:

```ts
// src/services/tenant-bucket.service.ts
import { BackupServiceInterface, inject, TenantBackupTransport, ZIBRI_DI_TOKENS } from 'zibri';

export async function addTenantBucket(tenantId: string, secretAccessKey: string): Promise<TenantBackupTransport | undefined> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    return await backupService.createTenantBackupTransport?.(tenantId, {
        name: 'Our bucket',
        kind: 's3',
        settings: { endpoint: 'https://s3.eu-central-1.amazonaws.com', bucket: 'acme-backups', region: 'eu-central-1', accessKeyId: 'AKIA…', addressingStyle: 'virtual-hosted' },
        secret: { secretAccessKey }
    });
}
```

A transport is of one of the kinds the application lists, with the settings and the secret of that kind, which are checked against the kind's models as a request body is. Of a bucket over https, `'s3'`, they are a `TenantS3TransportSettings` and the secret of the access key; of an SFTP server, `'sftp'`, a `TenantSftpTransportSettings` and the password or the private key. The secret is stored encrypted and bound to its row. Adding a transport writes and deletes a small object on it, so a wrong address, bucket or secret is refused with a `400` at once. `findTenantBackupTransports` lists a tenant's transports, and `deleteTenantBackupTransport` deletes one, refused with a `409` while a backup is stored on it.

A backup of a tenant goes to the tenant's own transports alone, and `queueBackup` refuses one for a tenant without any with a `400`. The garbage collection goes through the tenants' transports too.

A transport a tenant names reaches public addresses only: a host leading to this machine, a private or link-local network, or an address translated into one is refused, when it is added and again before every backup and restore. An IPv6 address carrying an IPv4 one, through NAT64 or 6to4, counts as the IPv4 address it carries. So is each address a bucket redirects to, before the redirect is followed. A bucket name holds letters, digits, `.`, `-` and `_` only. `ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS` says what tenants may configure:

| Option | What it is |
|---|---|
| `kinds` | The kinds a tenant may add, such as `new S3TenantBackupTransportKind()`. `S3TenantBackupTransportKind` and `SftpTenantBackupTransportKind` by default |
| `allowedHosts` | The hosts a transport may reach, each with the hosts below it, such as `amazonaws.com`. Any public host by default |
| `allowPrivateNetworks` | Whether a transport may reach the networks the application runs in, and a bucket over plain http. Off by default |

> [!WARNING]
> With `allowPrivateNetworks`, a tenant can make your application connect to any host inside its network, such as a database or a metadata service. Turn it on only when every tenant is trusted as much as the network is.

### Offering tenants a kind of storage of your own

A kind implements `TenantBackupTransportKindInterface`: its `name`, the classes its settings and secret are checked against, and `createTransport`, which builds the transport reaching the storage for each session, as a [transport of your own](#writing-a-transport-of-your-own) does. List it in `kinds`:

```ts
// src/backup/archive.tenant-backup-transport-kind.ts
import { BackupTransportSupporting, FsBackupTransport, FsUtilities, Newable, Property, TenantBackupTransportKindInterface, TenantTransportNetwork } from 'zibri';

export class ArchiveSettings {
    @Property.string()
    host!: string;

    @Property.string()
    folder!: string;
}

export class ArchiveSecret {
    @Property.string()
    token!: string;
}

export class ArchiveTenantBackupTransportKind implements TenantBackupTransportKindInterface<ArchiveSettings, ArchiveSecret> {
    readonly name: string = 'archive';
    readonly settingsModel: Newable<ArchiveSettings> = ArchiveSettings;
    readonly secretModel: Newable<ArchiveSecret> = ArchiveSecret;

    async createTransport(name: string, settings: ArchiveSettings, secret: ArchiveSecret, network: TenantTransportNetwork): Promise<BackupTransportSupporting<'v2'>> {
        // the host the transport connects to, at the address it answers
        const address: string = await network.resolveAddress(settings.host);
        return new FsBackupTransport(name, FsUtilities.getPath('/mnt', address, settings.folder));
    }
}
```

```ts
// src/providers.ts
import { defineProvider, S3TenantBackupTransportKind, ZIBRI_DI_TOKENS } from 'zibri';

import { ArchiveTenantBackupTransportKind } from './backup/archive.tenant-backup-transport-kind';

defineProvider({
    token: ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS,
    useValue: { kinds: [new S3TenantBackupTransportKind(), new ArchiveTenantBackupTransportKind()], allowedHosts: undefined, allowPrivateNetworks: false }
});
```

`validateSettings` refuses settings beyond what their models say, such as a bucket over plain http, with a `400`.

> [!WARNING]
> What the application lets tenants reach holds only of the hosts a kind resolves through `network.resolveAddress`. A kind connects to every host it reaches, a redirect included, at the address `resolveAddress` answers for it, and to no other.

`setTenantBackupRetention` sets which of a tenant's backups are kept, in place of `ZIBRI_DI_TOKENS.BACKUP_RETENTION`, stored in `TenantBackupSettings`, which you declare beside `BackupEntity`. Without one, the application's retention keeps them. A backup of a tenant leaves both entities out, so a restore keeps the transports and retention the tenant has now.

## Exporting a tenant
`exportTenant` writes the rows of a tenant as your application answers them, for the tenant to take away and read without your application: a tar archive of `manifest.json`, which names the tenant, when it was written and the data source and rows of each file, and a folder per data source holding a file per entity, such as `PostgresDataSource/project.jsonl`, in `'json-lines'` or `'csv'`:

```ts
// src/services/tenant-export.service.ts
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { BackupServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function exportTenant(tenantId: string): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    if (backupService.exportTenant == undefined) {
        return;
    }
    await pipeline(await backupService.exportTenant(tenantId, 'json-lines'), createWriteStream(`./exports/${tenantId}.tar`));
}
```

An export covers every data source of the application, marked with `@Backup` or not, each read as of one moment, as a backup of a tenant reads it. An entity in several data sources has a file in the folder of each. Encrypted values are decrypted, and hashed properties and properties that declare `exclude` are left out. Of a relation to many rows, an entity lists the ids of the related rows where it owns the join table. In CSV, an object or a list is a JSON cell, and text starting with `=`, `+`, `-`, `@`, a tab or a carriage return starts with a `'`, so that a spreadsheet opening the file does not run it as a formula. A number written as text, such as `-12.5`, is left as it is. JSON lines hold every value exactly as stored. An export is not encrypted.

## Restoring while other instances run

A restore runs on the instance that `restore` is called on, while the others keep running. Until it
is done, their requests wait or see part of the backup as this instance's own do, see
[restoring the application](#restoring-the-application). Once it is done, every instance answers from
what the backup holds: the caches and the roles in memory are invalidated, see
[caching](./caching.md#restoring-a-backup), the encryption keys stored before stay usable, and cron
jobs follow the restored schedule within seconds. The rows of an entity declared
`backedUp: false` stay as the instances running hold them, such as the subscribers of events they host.

A restore of the application on Postgres holds up every request to the tables it replaces, on every
instance, until it is done. For a large database, keep requests from piling up behind it, such as with
a maintenance page.

## When the application stops

When the application stops while a backup or restore is running, it waits for it for
`ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS`, 0 by default, and then stops it:

- A backup hands the resource it is storing back, without counting the attempt, and another instance
  stores it and what is left. `waitForBackup` on the stopping instance fails with an error saying so.
  An instance that is killed hands nothing back: another instance takes its resource over once its
  claim lapses, a minute later.
- A restore stops before its next resource and puts back every resource it already applied, the same
  way as when one of them fails to apply. `restore` fails with an error saying so.

Stopping takes up to `ZIBRI_DI_TOKENS.BACKUP_STOPPING_TIMEOUT_IN_MS` more, 30 seconds by default. Raise it
when putting back what a large restore applied takes longer. Choose both so that they fit into the time your
orchestrator gives the process before it kills it:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS, useValue: Ms.MINUTE * 5 });
```

## Weighing what backups and restores take
What a backup or a restore holds up while it runs, what it takes beside your data, and what it guarantees, for a backup of the application and for one of a [tenant](#backing-up-a-tenant). The disk of this instance is `BACKUP_TEMP_FOLDER`, see [where a backup passes through](#where-a-backup-passes-through). The memory of the application is with the default [chunk sizes](#storing-unchanged-data-once).

### Taking a backup of the application
| | Postgres | Valkey, `'snapshot'` | Valkey, `'walk'` |
|---|---|---|---|
| What waits | A change of the schema of a table it reads, such as a migration, until the backup is done, and the requests to that table queued behind the change. Reads and writes go on | Every request to the server, until every key is copied | Nothing |
| What it holds | Every table as of one moment | Every key as of one moment | Every key as it was when the backup began. A transaction committed meanwhile is in it whole or not at all |
| Memory of the server | Nothing more | A copy of every key, until it is read | A copy of each key written meanwhile, and of the largest set |
| Disk of the server | With `incrementalRead`, the WAL since the backup before, up to `max_slot_wal_keep_size` | Nothing more | Nothing more |
| Memory of the application | Tens of MiB per resource stored at once | Tens of MiB, and about 4 MiB of the names of the keys | Tens of MiB, and about 4 MiB of the names of the keys |
| Disk of this instance | The dump, compressed | The keys, compressed, and their names | The keys, compressed, and their names |
| When it does not fit | It takes no room on the server | It is refused before anything is copied | It fails, and writes go on |

### Restoring the application
| | Postgres | Valkey, `'staged'` | Valkey, `'direct'` |
|---|---|---|---|
| What waits | Every request reading or writing a table the restore replaces, until the restore is done. With a large database, that is hours | Every request to the server, while the backup is swapped in. The more keys, the longer | Nothing |
| What requests see meanwhile | What was stored, once the restore is done | What was stored, then the backup at one moment. A key written meanwhile is gone after the swap | Part of the backup. A key written meanwhile can stay beside it |
| Other instances | Keep running, and answer from the backup once the restore is done, see [restoring while other instances run](#restoring-while-other-instances-run) | The same | The same |
| Memory of the server | Nothing more | The store twice, until the swap | About the store once |
| Disk of the server | The tables it replaces twice, until it is done, and the WAL of writing them | Nothing more | Nothing more |
| Memory of the application | Tens of MiB | Tens of MiB | Tens of MiB |
| Disk of this instance | The backup, compressed, and a snapshot of what is stored, unless it restores [all or nothing](#a-restore-of-several-resources) | The backup, compressed, and a snapshot, unless it restores all or nothing | The backup, compressed, and a snapshot |
| When it fails part way | Every resource is put back from its snapshot. Without a snapshot, nothing changed, unless it failed after its data went in, which then stays in place | The same. Before the swap, nothing changed | Every resource is put back from its snapshot |

### Taking a backup of a tenant
| | Postgres | Valkey |
|---|---|---|
| What waits | A change of the schema of a table it reads, until the backup is done, and the requests to that table queued behind the change | Nothing |
| What it holds | The tenant's rows as of one moment: a row written meanwhile is in it with every row it points at, or not at all | The same |
| Memory of the server | Nothing more | A copy of each key written meanwhile |
| Memory of the application | Tens of MiB | Tens of MiB |
| Disk of this instance | The rows, compressed | The rows, compressed |

### Restoring a tenant
| | Postgres | Valkey, `'staged'` | Valkey, `'direct'` |
|---|---|---|---|
| What waits | Of other tenants, a write of a value of a unique the restored rows hold, and a change of a shared row they point at, until the restore is done | Every request to the server, while the tenant's rows are written. The more rows, the longer | Nothing |
| What requests see meanwhile | The tenant's rows as they were, until the restore is done | The tenant's rows as they were, then the backup at one moment | Part of the backup's rows |
| Other instances | Keep running, and answer from the backup once the restore is done | The same | The same |
| Memory of the application | Tens of MiB, and the rows that rows outside the backup point at | Every row of the tenant, until it is written | Tens of MiB |
| Disk of this instance | The backup, compressed | The backup, compressed | The backup, compressed, and a snapshot of the tenant's rows |
| When it fails part way | Nothing changed | Nothing changed | The tenant's rows are put back from their snapshot |

The rows of other tenants and the rows every tenant shares are never written.

### What every backup and restore guarantees
- A restore checks the data of every resource before it applies any of it, and refuses one that is not what the backup recorded, see [what a restore checks first](#what-a-restore-checks-first).
- A resource marked with `encrypt: true` is encrypted on every transport and on the disk of this instance, see [encrypting backups](#encrypting-backups).
- A restore that is killed, or that cannot put a resource back, is put back at the next start, see [a restore of several resources](#a-restore-of-several-resources).
- A backup or a restore holds the resources it covers, across all instances, see [creating and restoring backups](#creating-and-restoring-backups).
- A restore invalidates what the caches and the roles in memory hold of what it replaced, on every instance, once it is done or put back, see [caching](./caching.md#restoring-a-backup).
- A restore of the application keeps the logins and the credentials of the users that exist when it begins, see [keeping rows across a restore](#keeping-rows-across-a-restore).
- A restore brings the data in line with the release restoring it, see [a backup of another release](#a-backup-of-another-release).

A backup reads and writes the rows of your data. A restore of a large database takes as long as writing all of them again, and it restores the moment of a backup rather than any moment you choose. To recover from losing a database server within minutes, or to a moment of your choice, add the snapshots of your database provider, or a tool that copies the database's own files such as pgBackRest, beside these backups. Those restore the whole server, stopped, into the same version of the database, rather than the data of your application, or of one tenant, into one that runs.

## Sizing the server for backups and restores

Size the servers before the first restore is needed. A backup and a restore take room in three places:

| Where | Taking a backup | Restoring the application |
|---|---|---|
| The disk of this instance, the folder of `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER` | The resource being stored, compressed, or the largest of those stored at once with `BACKUP_MAX_CONCURRENT_RESOURCES` | Every resource restored, compressed, and a copy of what each holds now, which a failed restore puts back from. A resource restored alone that restores [all or nothing](#a-restore-of-several-resources) takes no copy |
| The disk of a Postgres server | With `incrementalRead`, the WAL since the backup before, up to `max_slot_wal_keep_size` | The tables it replaces twice, until the restore is done, and the WAL of writing them |
| The memory of a Valkey server | With `'snapshot'`, a copy of every key until it is read. With `'walk'`, a copy of each key written meanwhile | With `'staged'`, the store twice until the swap. With `'direct'`, about the store once |

Compressed, a Postgres dump takes about a third of its data, which is mostly text. What Valkey takes depends on its values, between a third and all of them. Each backup records what each resource took as `stagedSize` of `BackupResourceEntity`, which a restore of it takes about as well.

For an application with 100 GB in Postgres and 50 GB in Valkey on one machine, whose Valkey values compress to 40%:

| | Disk | Memory |
|---|---|---|
| Taking a backup | The databases, and about 36 GB staged | With `'snapshot'`, 50 GB more for Valkey while it copies |
| Restoring the application | The databases, 100 GB more for Postgres, and about 112 GB staged: 36 GB and 20 GB fetched, and as much again for the copies | With `'staged'`, 50 GB more for Valkey, 100 GB in all. With `'direct'`, nothing more |
| Restoring Postgres alone | The databases, 100 GB more for Postgres, and about 36 GB staged | Nothing more |

The machine needs about 350 GB of disk and 128 GB of memory for that, besides what the databases write of their own, such as the snapshots Valkey persists. A container whose `BACKUP_TEMP_FOLDER` is a `tmpfs` holds the staged files in memory: give it a volume on the disk instead, see [what the application writes](../operations/deployment.md#what-the-application-writes).

Once a backup is completed, the instance that completed it checks whether its disk could restore it, and logs a critical error when it could not, naming what a restore needs, what is free, and what to do. A restore checks the same before it fetches anything, and again before it takes the copies, and is refused with a `NotEnoughRestoreSpaceError` saying so, see [restoring with less room](#restoring-with-less-room). The disk and memory of the database servers are theirs to tell: a Postgres server that runs out of disk during a restore, or a Valkey server that runs out of memory staging one, fails the restore with what it needed and what to do, and nothing changes.

## Restoring with less room

A restore refused for room names what it needs and every way to go on. Each one restores with less room for something it gives up:

| Option of `restore` | Takes on this instance's disk | Gives up |
|---|---|---|
| `resources: ['DbDataSource']` | What the named resources take. A resource restored alone that restores all or nothing takes no copy | The resources are restored apart rather than all or nothing together: one restored stays restored when the next one fails |
| `putBack: false` | The backup alone, no copies | A restore that fails part way is not put back, and leaves what it applied as it is |
| `deleteFirst: true` | As without it | What the resources hold is deleted before the backup is applied, so the database server holds the backup alone. It is gone until a restore succeeds, unless `putBack` keeps its copy |
| `skipSpaceCheck: true` | As without it | A restore that runs out of space fails, and puts back what it applied |

Pointing `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER` at a larger disk, and restarting, gives up nothing. Without the options, a restore keeps a copy of what each resource holds, and puts it back when it fails.

```ts
// src/services/database-restore.service.ts
import { BackupEntity, BackupServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function restoreDatabaseAlone(backup: BackupEntity): Promise<void> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    await backupService.restore(backup, { resources: ['DbDataSource'] });
}
```

A restore of a tenant replaces the tenant's rows alone, and refuses `deleteFirst`.

## Where a backup passes through

A backup passes through this instance's own disk. It is written there on its way out, and fetched
there on its way back. How much room that takes is in [sizing the server](#sizing-the-server-for-backups-and-restores).
Every file there is compressed, so it takes what its data compresses to, such as a fraction of a
database dump, which is mostly text. A backup to a transport used as `v1` stages its
data as that transport stores it. `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER` says where, and defaults to `.zibri/backups` beside the
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

The shape covers the record stored beside the data, the fields a restore reads from it, the keys a
transport holds, and how data is cut into chunks, compressed and sealed. What a resource's own
`createBackupData` produces belongs to the resource: a Postgres dump is read by Postgres.

This build writes format 2 and restores formats 1 and 2. A backup of format 1 is found and restored
where it was stored.

An instance stores the resources of a backup only in the shape the backup was queued in. During a
rolling deploy, a backup a newer build queued in a shape an older instance does not write waits for an
instance of the newer build.

A transport of `v2` stores data under keys and never opens it, so a transport of your own works with every
shape.

## Requirements
| Package | Used for |
|---|---|
| `ssh2` | Reaching an SFTP server, with `SftpBackupTransport`. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `BackupEntity`, `BackupResourceEntity` | A backup resource is registered |
| `BackupChunkEntity` | A backup resource is registered. Without it, each backup lists the chunks its transports hold first |
| `TenantBackupTransport` | Tenants [keep backups on storage of their own](#letting-a-tenant-back-up-to-its-own-storage) |
| `TenantBackupSettings` | Tenants keep their backups by a retention of their own |
| `Lease` | `ZIBRI_DI_TOKENS.BACKUP_RETENTION` is set |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Data sources](./data-source.md) — `PostgresDataSource` and other data sources that back up automatically
- [Encryption and hashing](./encryption-and-hashing.md#setting-the-master-key) — the master key encrypted backups are restored with
