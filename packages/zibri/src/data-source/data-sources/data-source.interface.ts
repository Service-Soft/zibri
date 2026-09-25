import { BackupResourceInterface } from '../../backup/backup-resource.interface';
import { ChangeSetRepository } from '../../change-sets/change-set-repository';
import { ChangeSetEntity } from '../../change-sets/models/change-set-entity.model';
import { SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../change-sets/soft-delete-repository';
import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadataInput, PropertyMetadata, RelationMetadata } from '../../entity/decorators/property.decorator';
import { FilePropertyMetadata } from '../../entity/models/file-property-metadata.model';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../versioning/sem-ver.utilities';
import { Migration } from '../migration/migration.model';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * The isolation level of any data source calls made inside a transaction.
 */
export enum IsolationLevel {
    READ_UNCOMMITTED = 'READ UNCOMMITTED',
    READ_COMMITTED = 'READ COMMITTED',
    REPEATABLE_READ = 'REPEATABLE READ',
    SERIALIZABLE = 'SERIALIZABLE'
}

/**
 * The options a transaction is started with.
 */
export type StartTransactionOptions = {
    /**
     * The isolation level of any data source calls made inside the transaction.
     */
    isolationLevel?: IsolationLevel,
    /**
     * How long this transaction may sit idle before it is rolled back, in milliseconds.
     *
     * A transaction holds something from the moment it starts until it commits or rolls back: a
     * connection out of the pool, and a grant on every row it writes. A caller that reaches neither
     * - the happy path written without a catch, an early return above the commit - holds those for
     * the life of the process. The pool is a fixed size, so enough of them and no query anywhere can
     * be served again, and a grant that is never handed back stops every replica from writing that
     * row rather than only this one.
     *
     * Idle is the measure rather than age, so a transaction that keeps working keeps its full
     * allowance however long it runs. Worth raising for a transaction that waits on something slow
     * between two of its writes, and worth setting to 0 for one that may sit idle for as long as it
     * likes. Ten seconds when it is not given, which is an order of magnitude over the longest gap
     * the save hooks produce.
     */
    idleTimeoutInMs?: number
};

/**
 * The inferred repository type for the given entity.
 */
export type RepositoryTypeForEntity<T extends BaseEntity> = T extends SoftDeleteEntity
    ? SoftDeleteRepository<T>
    : T extends ChangeSetEntity
        ? ChangeSetRepository<T>
        : Repository<T>;

/**
 * The lock key held while a data source sets its schema up.
 *
 * One key for the whole data source on purpose: schema setup is exactly the case where instances
 * must not overlap at all. Everything else should pick a narrower key.
 */
export const SCHEMA_LOCK_KEY: string = 'zibri.schema';

/**
 * Definition for a data source.
 */
export interface DataSourceInterface extends BackupResourceInterface {
    /**
     * The entities of this data source.
     */
    readonly entities: Newable<BaseEntity>[],

    /**
     * All migrations that belong to this data source.
     */
    readonly migrations: Newable<Migration>[],

    /**
     * Initializes the data source.
     */
    init: () => Promise<void>,

    // The named lock a data source used to expose here is now protected, reachable only by schema
    // setup - see the `schemaLock` declaration on the base data sources. Everything else that needs
    // exclusion across instances takes a lease, which is one shared mechanism rather than one per
    // store. See evaluation/10-leases-and-claims.md.

    /**
     * Shuts down the data source.
     * Should be called from the data source service AfterAppShutdown hook.
     */
    shutDown: () => void | Promise<void>,

    /**
     * Gets a repository to manage the provided entity class in the data source.
     * @param cls - The entity class to get the repository for.
     * @returns A repository for the provided entity class.
     * @throws When the data source has not been initialized yet or the provided entity does not belong to this data source.
     */
    getRepository: <T extends BaseEntity>(cls: Newable<T>) => RepositoryTypeForEntity<T>,

    /**
     * Starts a new transaction.
     * @param options - The options of the transaction, like its isolation level.
     * @returns A new transaction that can be passed to any repository methods.
     */
    startTransaction: (options?: StartTransactionOptions) => Transaction | Promise<Transaction>,

    /**
     * Runs migrations for the data source.
     */
    runMigrations: () => Promise<void>,

    /**
     * Takes the schema back to the given version, reverting everything applied above it.
     *
     * Never happens on its own. Booting refuses to run against a database newer than the app instead
     * of reverting it, because an instance arriving late would otherwise take the schema away from
     * the ones already serving on it. This is the deliberate way back, and it is destructive: run it
     * with the newer instances stopped.
     */
    revertMigrationsAfter: (targetVersion: SemVerVersion) => Promise<void>,

    /**
     * Adds a new property to the given entity.
     *
     * Mostly needed in the context of migrations.
     */
    addPropertyToEntity: <T extends BaseEntity>(
        entity: Newable<T>,
        key: keyof T,
        transaction: Transaction
    ) => Promise<void>,

    /**
     * Changes the given oldProperty to the newProperty on the given entity.
     */
    changePropertyOfEntity: <T extends BaseEntity>(
        entity: Newable<T>,
        oldProperty: keyof T | string & {},
        newProperty: PropertyMetadataInput & {
            /**
             * The name of the new column.
             *
             * A name the entity no longer carries as well, which is what a migration going back
             * needs: the `down` of a rename puts the old name back, and the old name is precisely
             * the one the class has stopped declaring.
             */
            name?: keyof T | string & {},
            /**
             * The type of the new column.
             */
            type: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity> | FilePropertyMetadata>['type']
        },
        transaction: Transaction
    ) => Promise<void>
}

/**
 * Checks whether or not the given value is a data source.
 * @param value - The value to check.
 * @returns True if all keys of the DataSourceInterface are present, false otherwise.
 */
export function isDataSource(value: unknown): value is DataSourceInterface {
    if (typeof value !== 'object') {
        return false;
    }
    if (value == undefined) {
        return false;
    }

    const keys: (keyof DataSourceInterface)[] = [
        'addPropertyToEntity',
        'changePropertyOfEntity',
        'createBackupData',
        'entities',
        'getRepository',
        'init',
        'migrations',
        'restoreBackup',
        'runMigrations',
        'shutDown',
        'startTransaction'
    ];

    return !keys.find(key => !(key in value));
}