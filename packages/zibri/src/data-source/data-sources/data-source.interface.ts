import { BackupResourceInterface } from '../../backup/backup-resource.interface';
import { ChangeSetRepository } from '../../change-sets/change-set-repository';
import { ChangeSetEntity } from '../../change-sets/models/change-set-entity.model';
import { SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../change-sets/soft-delete-repository';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../versioning/sem-ver.utilities';
import { Migration } from '../migration/migration.model';
import { AddPropertyToEntityInput } from '../models/add-property-to-entity-input.model';
import { ChangePropertyOfEntityInput } from '../models/change-property-of-entity-input.model';
import { CreateEntityInput } from '../models/create-entity-input.model';
import { MergeEntityInput } from '../models/merge-entity-input.model';
import { MigrationPropertyMetadata } from '../models/migration-property-metadata.model';
import { RemovePropertyFromEntityInput } from '../models/remove-property-from-entity-input.model';
import { RenameEntityInput } from '../models/rename-entity-input.model';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * The isolation level of any data source calls made inside a transaction.
 */
export enum IsolationLevel {
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
     * How long setting the schema up and running one migration may take, in milliseconds. 0, the
     * default, for no limit.
     *
     * Takes the place of the data source's own statement timeout while the schema is set up and while
     * a migration runs, so that a migration rewriting a large table is not cut off on deploy. A
     * migration can name a `timeoutInMs` of its own instead.
     */
    readonly migrationTimeoutInMs?: number,

    /**
     * Initializes the data source.
     *
     * Runs the migrations, and then makes the indexes and uniques the data source keeps match what
     * its entities declare: it creates every declared one that is missing, over the entities already
     * stored, and removes every one no entity declares anymore. Fails when stored entities break a
     * declared unique, naming the values they share.
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
     * Adds a property to every stored entity, empty in the ones that already exist.
     */
    addPropertyToEntity: <T extends BaseEntity>(input: AddPropertyToEntityInput<T>) => Promise<void>,

    /**
     * Changes how a property is stored - its name, its type, or both - keeping or converting what
     * each stored entity holds.
     */
    changePropertyOfEntity: <T extends BaseEntity, C extends MigrationPropertyMetadata, M extends MigrationPropertyMetadata>(
        input: ChangePropertyOfEntityInput<T, C, M>
    ) => Promise<void>,

    /**
     * Removes a property, and what it holds, from every stored entity.
     */
    removePropertyFromEntity: <T extends BaseEntity>(input: RemovePropertyFromEntityInput<T>) => Promise<void>,

    /**
     * Moves every stored entity from the table name it is stored under to the one the entity declares,
     * along with its indexes and uniques.
     * @throws When something is stored under the declared table name already, or when the entity is
     * part of a many to many relation.
     */
    renameEntity: <T extends BaseEntity>(input: RenameEntityInput<T>) => Promise<void>,

    /**
     * Moves every entity stored under another table name to the entity, next to the ones it stores,
     * along with their many to many relations.
     *
     * An entity holding what a stored one holds under a unique the entity declares, its id included,
     * is left out. Nothing is stored under the other table name afterwards.
     */
    mergeEntity: <T extends BaseEntity>(input: MergeEntityInput<T>) => Promise<void>,

    /**
     * Creates what an entity is stored in.
     *
     * A migration that manages the schema creates every entity it introduces with this.
     */
    createEntity: <T extends BaseEntity>(input: CreateEntityInput<T>) => Promise<void>
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
        'createEntity',
        'removePropertyFromEntity',
        'renameEntity',
        'mergeEntity',
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