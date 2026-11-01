import { Readable } from 'node:stream';

import { AddPropertyToEntityInput, type AuthServiceInterface, BaseEntity, ChangePropertyOfEntityInput, DataSourceInitializationError, DataSourceInterface, DataSourceSubscription, EntityMetadataMissingError, GlobalRegistry, Inject, InternalError, JsonUtilities, type LoggerInterface, MergeEntityInput, Migration, MigrationPropertyMetadata, MigrationRevertTarget, Newable, ObjectUtilities, PubSubDataSourceInterface, RemoveEntityInput, RemovePropertyFromEntityInput, RemoveRelationFromEntityInput, RenameEntityInput, Repository, RepositoryClass, RepositoryTypeForEntity, RunInTransactionOptions, StartTransactionOptions, Transaction, TransactionUtilities, ZIBRI_DI_TOKENS } from 'zibri';
import { ConvertedValue, DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS, EntityMetadata, MetadataUtilities, MigratedEntityUtilities, OpenTransactions, PropertyMetadata, recordKeyReconciliation, RefusedValue, registerRepositoryProvidersFor, RepositoryForUtilities, ResolvedPropertyConversion, revertMigrationsAfter, runMigrations, runMigrationsAfterRestore, UNBOUNDED_FIND_ALL_LIMIT, ValueConversionUtilities } from 'zibri/internal';

import { InMemoryScope, inMemoryStoreFor, InMemoryStore, InMemoryStoreSnapshot, StoredRow } from './in-memory-store';
import { InMemoryTransaction } from './in-memory-transaction.model';
import { InMemoryRepositoryDriver } from './in-memory.repository-driver';
import { RoundTripCounter } from '../round-trip-counter.model';

/**
 * The fields to write and to remove for one row, or undefined when the row stays untouched.
 */
type UpdateStoredRowsResult = {
    /**
     * The fields to write, already json encoded.
     */
    values: StoredRow,
    /**
     * The fields to remove, if any.
     */
    remove?: string[]
};

/**
 * A data source that keeps everything in process, for tests that need storage, not a database.
 *
 * Most of the suite is not about the data source at all - it needs one because an application does
 * not start without one. This is for those: it implements the same {@link DataSourceInterface} the
 * shipped ones do, with real behavior behind it (filters, relations, unique declarations,
 * transactions, migrations, backups), and needs no container to run.
 *
 * It is a test fixture and not a deployment target. A suite that is *about* storage - migrations
 * against real ddl, connection pooling, isolation levels, anything where the answer depends on the
 * engine - belongs on a container-backed data source and stays there.
 *
 * ## Use
 * Subclass it the way the shipped data sources are subclassed, listing the entities:
 *
 * ```ts
 * ⁠@DataSource()
 * class TestDataSource extends InMemoryDataSource {
 *     entities: Newable<BaseEntity>[] = [MigrationEntity, Lease, ...];
 * }
 * ```
 *
 * ## Where the rows live, and how long
 * The store belongs to the *class*, not to the object. Re-initializing an application throws away
 * the di container and every data source in it, so an instance owning its rows would hand the next
 * application an empty database - and restarting a deployment does not empty one. Keying the store to
 * the class is what a container-backed data source gets for free, because nothing stopped the
 * container.
 *
 * The two lifetimes line up with that. A test that boots one server per class - which is what
 * building the class per server gives you, the way `createTestDataSource` does - starts empty every
 * time, because a class nothing has asked about yet has no store to inherit. A harness that reuses
 * one class across several servers calls `resetInMemoryStore` as it boots each one, at the point a
 * container-backed harness would start a new container. A re-init calls neither, so the rows
 * survive it.
 *
 * ## Differences to the shipped data sources
 * - **No isolation levels.** One passed to `startTransaction` is reported and ignored, the same way
 * the valkey data source reports it.
 * - **No schema.** Nothing declares columns up front, so a migration only rewrites the rows that are
 * already stored - which is what the valkey data source does with `addPropertyToEntity` and
 * `changePropertyOfEntity` too. A column type that postgres would reject is stored happily here.
 * - **No cross instance locking.** There is only ever one instance of this store, so schema setup
 * takes no lock: nothing else can be setting it up at the same time.
 * - **Messages reach the applications of this process only.** `PubSubDataSourceInterface` hands a
 * published message to every subscriber on the same store, which is every instance there is here.
 */
export abstract class InMemoryDataSource implements DataSourceInterface, PubSubDataSourceInterface {

    abstract readonly entities: Newable<BaseEntity>[];

    abstract readonly repositories: RepositoryClass[];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly migrations: Newable<Migration>[] = [];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly maxMessageBytes: number | undefined = undefined;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly maxRowsWithoutLimit: number = UNBOUNDED_FIND_ALL_LIMIT;

    /**
     * Where every call a repository makes on the store is recorded, if anywhere.
     */
    protected readonly roundTrips: RoundTripCounter | undefined = undefined;

    /**
     * How long a transaction may sit idle, in milliseconds, before it is rolled back. 0 for no limit.
     * A transaction that names its own `idleTimeoutInMs` when it starts takes that instead.
     */
    protected readonly transactionIdleTimeoutInMs: number = DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS;

    private get store(): InMemoryStore {
        return inMemoryStoreFor(this.constructor as Newable<DataSourceInterface>);
    }

    private initialized: boolean = false;

    private readonly openTransactions: OpenTransactions = new OpenTransactions();

    private readonly builtRepositories: Map<Newable<BaseEntity>, Repository<BaseEntity>> = new Map();

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        protected readonly authService: AuthServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async init(): Promise<void> {
        if (this.initialized) {
            throw new InternalError('The data source has already been initialized.');
        }

        for (const entityClass of this.entities) {
            this.validateEntity(entityClass);
        }
        registerRepositoryProvidersFor(this.constructor as Newable<DataSourceInterface>, this);

        // set before the migrations rather than after: they run through repositories, and
        // getRepository refuses to hand one out until the data source is up
        this.initialized = true;

        // a command works on the schema as it is: one about migrations is what changes it
        if (GlobalRegistry.getAppData('runsCommand')) {
            return;
        }
        // no lock around this, unlike the shipped data sources. Theirs stops two instances setting
        // the schema up at once, and there is only ever one instance on this store.
        await this.runMigrations();
        await this.reconcileKeys();
    }

    /**
     * Holds the stored rows to what the entities declare, and records a change as the shipped data
     * sources do.
     * @throws When stored rows break a unique or a check an entity declares.
     */
    private async reconcileKeys(): Promise<void> {
        // there is nothing to build, since every filter goes through the rows and every write is
        // checked against what the entity declares - but rows stored before a unique or a check was
        // declared never were, and a restart over them has to refuse to start as the shipped data
        // sources do.
        // A change is recorded as theirs is, so that an older version refuses to start after it
        let changed: boolean = false;
        for (const entity of this.entities) {
            const driver: InMemoryRepositoryDriver<BaseEntity> = new InMemoryRepositoryDriver(entity, this.store);
            driver.validateStoredRowsAreUnique();
            driver.validateStoredRowsFollowChecks();
            changed = driver.reconcileKeyLists() || changed;
        }
        if (changed) {
            await recordKeyReconciliation(this.constructor as Newable<DataSourceInterface>);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async shutDown(): Promise<void> {
        // a transaction nothing ended kept its idle timer, which fired once the application was gone
        await this.openTransactions.rollBackAll(this.constructor.name, this.logger);
        this.initialized = false;
        this.builtRepositories.clear();
        // the store is deliberately left alone: an application that is started again on the same
        // store is meant to find its rows, which is what a database does
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async publish(channel: string, message: string): Promise<void> {
        if (!this.initialized) {
            throw new DataSourceInitializationError();
        }
        // a call on the store like any other, which is what it is on the shipped data sources
        this.roundTrips?.record(`publish ${channel}`);
        this.store.publish(channel, message);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async subscribe(channel: string, onMessage: (message: string) => void): Promise<DataSourceSubscription> {
        const stop: () => void = this.store.subscribe(channel, onMessage);
        return {
            // eslint-disable-next-line typescript/require-await
            unsubscribe: async () => {
                stop();
            }
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getRepository<T extends BaseEntity>(cls: Newable<T>): RepositoryTypeForEntity<T> {
        if (!this.initialized) {
            throw new DataSourceInitializationError();
        }
        return RepositoryForUtilities.resolveEntityRepository(
            this,
            cls,
            this.builtRepositories,
            this.logger,
            this.authService,
            () => this.recordRoundTrips(new InMemoryRepositoryDriver(cls, this.store), cls.name)
        );
    }

    /**
     * Wraps a driver so that every call a repository makes on it is recorded, when calls are.
     *
     * A method runs against the driver itself rather than the wrapper, so the calls one method makes
     * internally are not recorded again: what is recorded is what the repository asked for.
     * @param driver - The driver of one entity.
     * @param entityName - The name of its entity, which each recorded call is named after.
     * @returns The driver, wrapped when calls are recorded.
     */
    private recordRoundTrips<D extends object>(driver: D, entityName: string): D {
        const roundTrips: RoundTripCounter | undefined = this.roundTrips;
        if (roundTrips == undefined) {
            return driver;
        }
        return new Proxy(driver, {
            get: (target, property, receiver) => {
                const value: unknown = Reflect.get(target, property, receiver);
                if (typeof value !== 'function') {
                    return value;
                }
                if (property === 'resolveDataSourceTime') {
                    // the store reads its clock in this process, the way postgres reads it inside the
                    // statement: no call of its own to the store
                    return (...args: unknown[]): unknown => Reflect.apply(value, target, args);
                }
                return (...args: unknown[]): unknown => {
                    roundTrips.record(`${entityName}.${String(property)}`);
                    return Reflect.apply(value, target, args);
                };
            }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    startTransaction(options?: StartTransactionOptions): Transaction {
        if (!this.initialized) {
            throw new DataSourceInitializationError();
        }
        if (options?.isolationLevel != undefined) {
            this.logger.warn(
                `The data source "${this.constructor.name}" does not support isolation levels,`
                + ` "${options.isolationLevel}" is ignored.`
            );
        }
        const transaction: InMemoryTransaction = new InMemoryTransaction(this.store, options?.idleTimeoutInMs ?? this.transactionIdleTimeoutInMs, this.logger);
        this.openTransactions.add(transaction);
        return transaction;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runInTransaction<R>(work: (transaction: Transaction) => Promise<R>, options: RunInTransactionOptions): Promise<R> {
        return await TransactionUtilities.runInTransaction(this, work, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runMigrations(): Promise<void> {
        await runMigrations(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revertMigrationsAfter(target: MigrationRevertTarget): Promise<void> {
        await revertMigrationsAfter(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger, target);
    }

    // eslint-disable-next-line typescript/require-await, jsdoc/require-jsdoc
    async addPropertyToEntity<T extends BaseEntity>(input: AddPropertyToEntityInput<T>): Promise<void> {
        const name: string = String(input.property.name);
        const metadata: PropertyMetadata = MigratedEntityUtilities.resolvePropertyMetadata(input.property);
        const value: unknown = 'default' in metadata && metadata.default !== undefined
            ? typeof metadata.default === 'function' ? (metadata.default as () => unknown)() : metadata.default
            // eslint-disable-next-line unicorn/no-null
            : null;

        this.updateStoredRows(MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities), input.transaction, row => {
            if (name in row) {
                return undefined;
            }
            return { values: { [name]: JsonUtilities.stringify(value) } };
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async removePropertyFromEntity<T extends BaseEntity>(input: RemovePropertyFromEntityInput<T>): Promise<void> {
        const entity: Newable<BaseEntity> = MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities);
        const metadata: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(entity)[String(input.propertyKey)];
        if (metadata && 'primary' in metadata && metadata.primary) {
            throw new InternalError('primary keys cannot be removed');
        }

        this.updateStoredRows(entity, input.transaction, () => ({
            values: {},
            remove: [String(input.propertyKey)]
        }));
    }

    // eslint-disable-next-line typescript/require-await, jsdoc/require-jsdoc
    async changePropertyOfEntity<T extends BaseEntity, C extends MigrationPropertyMetadata, M extends MigrationPropertyMetadata>(
        input: ChangePropertyOfEntityInput<T, C, M>
    ): Promise<void> {
        const conversion: ResolvedPropertyConversion = ValueConversionUtilities.resolveConversion(input);
        const renames: boolean = conversion.currentName !== conversion.changedName;

        // the same conversion the valkey data source makes, since both store each value as json
        const refused: RefusedValue[] = [];
        this.updateStoredRows(MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities), input.transaction, row => {
            const stored: string | undefined = row[conversion.currentName];
            // a field that is not there is a value that is null, which a change lists and converts alike
            const converted: ConvertedValue | RefusedValue = ValueConversionUtilities.resolveConvertedValue(
                // eslint-disable-next-line unicorn/no-null
                stored == undefined ? null : JsonUtilities.parse(stored),
                conversion
            );
            if ('refusal' in converted) {
                refused.push(converted);
                return undefined;
            }
            if (stored == undefined && converted.value === null) {
                return undefined;
            }
            return {
                values: { [conversion.changedName]: JsonUtilities.stringify(converted.value) },
                remove: renames ? [conversion.currentName] : undefined
            };
        });
        // after every row, so that the migration names all of them at once. What the rows above were
        // given stays in the transaction, which failing the migration rolls back
        ValueConversionUtilities.validateNothingRefused(conversion, refused);
    }

    // eslint-disable-next-line typescript/require-await, jsdoc/require-jsdoc
    async renameEntity<T extends BaseEntity>(input: RenameEntityInput<T>): Promise<void> {
        new InMemoryRepositoryDriver(
            MigratedEntityUtilities.resolveMovedEntityClass(input.entity, input.currentTableName, this.entities),
            this.store
        ).moveStoredRowsFrom(input.currentTableName, input.transaction);
    }

    // eslint-disable-next-line typescript/require-await, jsdoc/require-jsdoc
    async mergeEntity<T extends BaseEntity>(input: MergeEntityInput<T>): Promise<void> {
        new InMemoryRepositoryDriver(
            MigratedEntityUtilities.resolveMovedEntityClass(input.entity, input.currentTableName, this.entities),
            this.store
        ).mergeStoredRowsFrom(input.currentTableName, input.transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createEntity(): Promise<void> {
        // Creates nothing: in memory has no schema.
    }

    // eslint-disable-next-line typescript/require-await, jsdoc/require-jsdoc
    async removeRelationFromEntity<T extends BaseEntity>(input: RemoveRelationFromEntityInput<T>): Promise<void> {
        // both sides, since each row keeps the related ids of its own side
        new InMemoryRepositoryDriver(MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities), this.store)
            .removeJoins(String(input.relation.name), input.transaction);
        new InMemoryRepositoryDriver(MigratedEntityUtilities.resolveEntityClass(input.relation.target, this.entities), this.store)
            .removeJoins(input.relation.inverseSide, input.transaction);
    }

    // eslint-disable-next-line typescript/require-await, jsdoc/require-jsdoc
    async removeEntity<T extends BaseEntity>(input: RemoveEntityInput<T>): Promise<void> {
        new InMemoryRepositoryDriver(MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities), this.store)
            .removeStoredRows(input.transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateBackupConfiguration(): void {
        // an in memory backup only needs the store the data source already has
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    createBackupData(): Readable {
        return Readable.from([JSON.stringify(this.store.snapshot(this.resolveTablesNotBackedUp()))]);
    }

    /**
     * Resolves the tables of the entities whose rows a backup leaves out and a restore keeps.
     * @returns Their table names.
     */
    private resolveTablesNotBackedUp(): Set<string> {
        return new Set(this.entities
            .map(entity => MetadataUtilities.getEntityMetadata(entity))
            .filter(metadata => metadata?.backedUp === false)
            .flatMap(metadata => metadata == undefined ? [] : [metadata.tableName]));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async restoreBackup(backupData: Readable): Promise<void> {
        // decoded once rather than per chunk: the data arrives as bytes, and a character spanning two
        // chunks decoded one chunk at a time comes out as two replacement characters
        const chunks: Buffer[] = [];
        for await (const chunk of backupData) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        this.store.restore(JSON.parse(Buffer.concat(chunks).toString('utf8')) as InMemoryStoreSnapshot, this.resolveTablesNotBackedUp());
        // what the backup holds brought in line with this release, as the shipped data sources do
        await runMigrationsAfterRestore(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
        await this.reconcileKeys();
    }

    /**
     * Validates that the given entity can be stored in an in memory data source.
     * @param entityClass - The entity class to validate.
     * @throws When the entity has no or more than one primary key.
     */
    protected validateEntity(entityClass: Newable<BaseEntity>): void {
        const entityMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
        if (!entityMetadata) {
            throw new EntityMetadataMissingError(entityClass);
        }
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const primaryKeys: string[] = ObjectUtilities.entries(properties)
            .filter(([, p]) => 'primary' in p && p.primary)
            .map(([k]) => k);

        if (!primaryKeys.length) {
            throw new InternalError(`no primary key specified for entity "${entityClass.name}".`);
        }
        if (primaryKeys.length > 1) {
            throw new InternalError(`more than 1 primary key specified for entity "${entityClass.name}".`);
        }
    }

    /**
     * Reads every stored row of the given entity and applies the given update to it.
     * @param entity - The entity class which rows should be updated.
     * @param transaction - The transaction to run the operation in.
     * @param update - Produces the fields to write and remove, or undefined when the row stays untouched.
     * @throws When the transaction was started by another data source.
     */
    private updateStoredRows<T extends BaseEntity>(
        entity: Newable<T>,
        transaction: Transaction,
        update: (row: StoredRow) => UpdateStoredRowsResult | undefined
    ): void {
        if (!(transaction instanceof InMemoryTransaction)) {
            throw new InternalError('The provided transaction does not belong to an in memory data source.');
        }
        if (!transaction.isStartedOn(this.store)) {
            throw new InternalError('The provided transaction belongs to another in memory data source: this one did not start it.');
        }
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entity);
        if (!metadata) {
            throw new EntityMetadataMissingError(entity);
        }

        const scope: InMemoryScope = transaction;
        for (const id of scope.ids(metadata.tableName)) {
            const row: StoredRow | undefined = scope.readRow(metadata.tableName, id);
            if (row == undefined) {
                continue;
            }
            const result: UpdateStoredRowsResult | undefined = update(row);
            if (result == undefined) {
                continue;
            }

            const next: StoredRow = { ...row, ...result.values };
            for (const field of result.remove ?? []) {
                // eslint-disable-next-line typescript/no-dynamic-delete
                delete next[field];
            }
            scope.writeRow(metadata.tableName, id, next);
        }
    }
}