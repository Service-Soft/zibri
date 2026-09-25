import { Readable } from 'node:stream';

import { type AuthServiceInterface, BaseEntity, ChangeSet, ChangeSetEntity, ChangeSetRepository, DataSourceInitializationError, DataSourceInterface, EntityMetadata, EntityMetadataMissingError, ExcludeStrict, FilePropertyMetadata, getDefaultBeforeReturnHook, getDefaultBeforeSaveHook, Inject, InternalError, isChangeSetEntityNewable, isSoftDeleteEntityNewable, type LoggerInterface, MetadataUtilities, Migration, Newable, ObjectUtilities, PropertyMetadata, PropertyMetadataInput, registerRepositoryProvidersFor, RelationMetadata, Repository, RepositoryDriverInterface, RepositoryTypeForEntity, revertMigrationsAfter, runMigrations, SemVerVersion, SoftDeleteEntity, SoftDeleteRepository, StartTransactionOptions, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

import { InMemoryScope, inMemoryStoreFor, InMemoryStore, InMemoryStoreSnapshot, StoredRow } from './in-memory-store';
import { InMemoryTransaction } from './in-memory-transaction.model';
import { InMemoryRepositoryDriver } from './in-memory.repository-driver';

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
 * A data source that keeps everything in process, for tests that need storage rather than a database.
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
 * container-backed harness would start a new container. A re-init deliberately calls neither, which
 * is the whole of how the rows survive it.
 *
 * ## Differences to the shipped data sources
 * - **No isolation levels.** One passed to `startTransaction` is reported and ignored, the same way
 * the valkey data source reports it.
 * - **No schema.** Nothing declares columns up front, so a migration only rewrites the rows that are
 * already stored - which is what the valkey data source does with `addPropertyToEntity` and
 * `changePropertyOfEntity` too. A column type that postgres would reject is stored happily here.
 * - **No cross instance locking.** There is only ever one instance of this store, so schema setup
 * takes no lock: nothing else can be setting it up at the same time.
 * - **It cannot carry messages between instances.** `PubSubDataSourceInterface` is deliberately not
 * implemented, matching the postgres data source - a suite about websocket fan out needs valkey.
 */
export abstract class InMemoryDataSource implements DataSourceInterface {

    abstract readonly entities: Newable<BaseEntity>[];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly migrations: Newable<Migration>[] = [];

    private get store(): InMemoryStore {
        return inMemoryStoreFor(this.constructor as Newable<DataSourceInterface>);
    }

    private initialized: boolean = false;

    private readonly repositories: Map<Newable<BaseEntity>, Repository<BaseEntity>> = new Map();

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

        // no lock around this, unlike the shipped data sources. Theirs stops two instances setting
        // the schema up at once, and there is only ever one instance on this store.
        await this.runMigrations();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    shutDown(): void {
        this.initialized = false;
        this.repositories.clear();
        // the store is deliberately left alone: an application that is started again on the same
        // store is meant to find its rows, which is what a database does
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getRepository<T extends BaseEntity>(cls: Newable<T>): RepositoryTypeForEntity<T> {
        if (!this.initialized) {
            throw new DataSourceInitializationError();
        }
        if (!this.entities.includes(cls)) {
            throw new InternalError([
                `The entity "${cls.name}" is not in this database.`,
                'Did you forget to include it in the entities array?'
            ]);
        }

        // eslint-disable-next-line stylistic/max-len
        const existingRepository: RepositoryTypeForEntity<T> | undefined = this.repositories.get(cls) as RepositoryTypeForEntity<T> | undefined;
        if (existingRepository) {
            return existingRepository;
        }

        const driver: InMemoryRepositoryDriver<T> = new InMemoryRepositoryDriver(cls, this.store);

        if (isSoftDeleteEntityNewable(cls)) {
            const res: RepositoryTypeForEntity<T> = new SoftDeleteRepository(
                cls,
                driver as unknown as RepositoryDriverInterface<SoftDeleteEntity>,
                this.logger,
                this,
                getDefaultBeforeSaveHook(),
                getDefaultBeforeReturnHook(),
                this.authService,
                this.getRepository(ChangeSet)
            ) as RepositoryTypeForEntity<T>;
            this.repositories.set(cls, res as Repository<BaseEntity>);
            return res;
        }
        if (isChangeSetEntityNewable(cls)) {
            const res: RepositoryTypeForEntity<T> = new ChangeSetRepository(
                cls,
                driver as unknown as RepositoryDriverInterface<ChangeSetEntity>,
                this.logger,
                this,
                getDefaultBeforeSaveHook(),
                getDefaultBeforeReturnHook(),
                this.authService,
                this.getRepository(ChangeSet)
            ) as RepositoryTypeForEntity<T>;
            this.repositories.set(cls, res as Repository<BaseEntity>);
            return res;
        }

        const res: RepositoryTypeForEntity<T> = new Repository<T>(
            cls,
            driver,
            this.logger,
            this,
            getDefaultBeforeSaveHook(),
            getDefaultBeforeReturnHook()
        ) as RepositoryTypeForEntity<T>;
        this.repositories.set(cls, res as Repository<BaseEntity>);
        return res;
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
        // idleTimeoutInMs is ignored rather than unimplemented - see InMemoryTransaction
        return new InMemoryTransaction(this.store);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runMigrations(): Promise<void> {
        await runMigrations(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revertMigrationsAfter(targetVersion: SemVerVersion): Promise<void> {
        await revertMigrationsAfter(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger, targetVersion);
    }

    // eslint-disable-next-line typescript/require-await, jsdoc/require-jsdoc
    async addPropertyToEntity<T extends BaseEntity>(entity: Newable<T>, key: keyof T, transaction: Transaction): Promise<void> {
        const metadata: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(entity)[String(key)];
        if (metadata == undefined) {
            throw new InternalError(`The property "${entity.name}.${String(key)}" does not exist.`);
        }
        const value: unknown = 'default' in metadata && metadata.default !== undefined
            ? typeof metadata.default === 'function' ? (metadata.default as () => unknown)() : metadata.default
            // eslint-disable-next-line unicorn/no-null
            : null;

        this.updateStoredRows(entity, transaction, row => {
            if (String(key) in row) {
                return undefined;
            }
            return { values: { [String(key)]: JSON.stringify(value) } };
        });
    }

    // eslint-disable-next-line typescript/require-await, jsdoc/require-jsdoc
    async changePropertyOfEntity<T extends BaseEntity>(
        entity: Newable<T>,
        oldProperty: keyof T | string & {},
        newProperty: PropertyMetadataInput & {
            /**
             * The name of the new column.
             */
            name?: keyof T | string & {},
            /**
             * The type of the new column.
             */
            type: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity> | FilePropertyMetadata>['type']
        },
        transaction: Transaction
    ): Promise<void> {
        const oldKey: string = String(oldProperty);
        const newKey: string = String(newProperty.name ?? oldProperty);
        if (oldKey === newKey) {
            return;
        }

        this.updateStoredRows(entity, transaction, row => {
            const value: string | undefined = row[oldKey];
            if (value == undefined) {
                return undefined;
            }
            return { values: { [newKey]: value }, remove: [oldKey] };
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateBackupConfiguration(): void {
        // an in memory backup only needs the store the data source already has
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    createBackupData(): Readable {
        return Readable.from([JSON.stringify(this.store.snapshot())]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async restoreBackup(backupData: Readable): Promise<void> {
        const chunks: string[] = [];
        for await (const chunk of backupData) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
        }
        this.store.restore(JSON.parse(chunks.join('')) as InMemoryStoreSnapshot);
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
     * @throws When the transaction was started by a different kind of data source.
     */
    private updateStoredRows<T extends BaseEntity>(
        entity: Newable<T>,
        transaction: Transaction,
        update: (row: StoredRow) => UpdateStoredRowsResult | undefined
    ): void {
        if (!(transaction instanceof InMemoryTransaction)) {
            throw new InternalError('The provided transaction does not belong to an in memory data source.');
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