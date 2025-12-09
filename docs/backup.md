# Backup
The backup system in Zibri consists of multiple parts:

### One or more backup resources
These define WHAT should be backed up and need to be marked with the `@BackupResource` decorator.

A decorated resource needs to implement `BackupResourceInterface` to define how data should be extracted from the resource (eg. by running a sql dump) and read back in.

### One or more backup transports defined for each resource
These define how extracted data from the resource is saved and how to retrive it when restoring a backup.

For more detail on those, especially if you are interested in creating your own transport, see [backup transports](./generated/interfaces/backup_transports_backup-transport.interface.BackupTransportInterface.html).

### The backup service
The backup service is responsible for creating and restoring backups based on the configured resources and transports.

## Example
In the following, we have a postgres data source that we want to backup:

```ts
// src/data-sources/db/db.data-source.ts
import { DataSource, Backup, FsBackupTransport, PostgresDataSource, PostgresOptions, BaseEntity, BackupEntity, BackupResourceEntity } from 'zibri';

@DataSource()
@Backup({
    transports: [
        new FsBackupTransport(
            'fs-backup-transport',
            './backups'
        )
    ]
})
class DbDataSource extends PostgresDataSource {
    rootPw: string = 'password';
    rootUsername: string = 'postgres';
    options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [
        BackupEntity,
        BackupResourceEntity
        //...
    ];
}
```

Notice that we don't need to implement `BackupResourceInterface` here, as `PostgresDataSource` already does that for us. What we did need to do was add two new entities and the root credentials. But you will get speaking error messages telling you exactly what is missing. 

The `FsBackupTransport` simply writes the backup data for this resource to the local file system, so it should only be used for illustration/testing purposes.

Now we can use the backup service to create a new backup:

```ts
import { BackupServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';
// ...
const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
await backupService.createBackup();
// ...
```

Which you can later restore using:

```ts
import { BackupServiceInterface, inject, ZIBRI_DI_TOKENS, repositoryTokenFor, BackupEntity } from 'zibri';
// ...
const backupRepository = inject(repositoryTokenFor(BackupEntity));
const backup: BackupEntity = await backupRepository.findById('42', { relations: ['resources'] });
await backupService.restore(backup);
// ...
```