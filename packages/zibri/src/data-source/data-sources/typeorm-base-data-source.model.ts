import { Readable } from 'node:stream';

import { EntityManager, EntitySchema, EntitySchemaColumnOptions, EntitySchemaIndexOptions, EntitySchemaRelationOptions, QueryRunner, Table, TableColumn, TableColumnOptions, DataSource as TODataSource, EntityMetadata as TOEntityMetadata, QueryFailedError as TOQueryFailedError, FindOptionsWhere as ToFindOptionsWhere } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';

import { DataSourceInitializationError } from './data-source-initialization.error';
import { DataSourceInterface, RepositoryTypeForEntity, SCHEMA_LOCK_KEY, StartTransactionOptions } from './data-source.interface';
import { RepositoryDriverInterface } from '../driver/repository-driver.interface';
import { TypeOrmRepositoryDriver } from '../driver/typeorm.repository-driver';
import { TypeOrmWhereFilterConverter } from './where-converter/typeorm-where-filter.converter';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { ChangeSetRepository } from '../../change-sets/change-set-repository';
import { ChangeSetEntity } from '../../change-sets/models/change-set-entity.model';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { isChangeSetEntityNewable } from '../../change-sets/models/is-change-set-entity.function';
import { isSoftDeleteEntityNewable } from '../../change-sets/models/is-soft-delete-entity.function';
import { SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../change-sets/soft-delete-repository';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { PropertyMetadata, PropertyMetadataInput, RelationMetadata } from '../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../entity/entity-metadata-missing.error';
import { FilePropertyMetadata } from '../../entity/models/file-property-metadata.model';
import { NumberFormat, NumberPropertyMetadataInput } from '../../entity/models/number-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { coversEveryRow, UniqueGroup } from '../../entity/models/unique-declaration.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { KeyGroups, keyGroupsOf } from '../../global/model-registry/key-descriptor';
import { type LoggerInterface } from '../../logging/logger.interface';
import { DeepPartial } from '../../types/deep-partial.type';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { TypeOrmUtilities } from '../../utilities/typeorm.utilities';
import { SemVerVersion } from '../../versioning/sem-ver.utilities';
import { registerRepositoryProvidersFor } from '../entity-ownership.function';
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../hooks/hooks.default';
import { indexName } from '../index-name.function';
import { MistypedJsonValue } from '../json-value-type-mismatch.error';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Migration } from '../migration/migration.model';
import { revertMigrationsAfter, runMigrations } from '../migration/run-migrations.function';
import { AtomicUpdate } from '../models/atomic-update.model';
import { ColumnType } from '../models/column-type.model';
import { DataSourceOptions } from '../models/data-source-options.model';
import { SchemaManagement } from '../models/schema-management.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';
import { TypeOrmTransaction } from '../transaction/typeorm-transaction.model';
import { uniqueConstraintName } from '../unique-constraint-name.function';
import { uniqueGroupFor } from '../unique-group-for.function';
import { keyWhereToSql } from '../where/key-where-to-sql.function';

// eslint-disable-next-line jsdoc/require-jsdoc
export type ToColumnMappableTypes = ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>['type'];

/**
 * One column change of an upsert, already resolved from a property to a column name.
 */
export type UpsertUpdate = {
    /**
     * The column to change.
     */
    column: string,
    /**
     * The amount to add to whatever is stored.
     */
    increment: number
}
| {
    /**
     * The column to change.
     */
    column: string,
    /**
     * The value to write, replacing whatever is stored.
     */
    value: unknown
};

/**
 * What an upsert resolves its conflict against.
 *
 * Two shapes because a key covering every row and a key covering some of them are different objects
 * in the schema: the first is a constraint and can be named, the second is an index and cannot -
 * a statement has to describe it instead, by the columns and the condition it was created with.
 */
export type UpsertConflictTarget = {
    /**
     * The name of the unique constraint identifying the row.
     */
    constraintName: string
} | {
    /**
     * The columns the partial unique index covers.
     */
    columns: string[],
    /**
     * The condition it was created with, written the same way the schema wrote it and without the
     * `WHERE` keyword. Anything else describes a different index, and no index means no conflict.
     */
    predicate: string
};

/**
 * The parts of an upsert, resolved as far as every dialect resolves them the same way.
 */
export type UpsertInput = {
    /**
     * The table to write to.
     */
    tableName: string,
    /**
     * What identifies the row, as the statement has to refer to it.
     */
    conflict: UpsertConflictTarget,
    /**
     * The full row to insert when nothing conflicts.
     */
    insert: {
        /**
         * The column to write.
         */
        column: string,
        /**
         * The value to write.
         */
        value: unknown
    }[],
    /**
     * The changes to apply when the insert does conflict.
     */
    updates: UpsertUpdate[]
};

/**
 * A dialect specific statement together with the parameters it refers to.
 */
export type UpsertSql = {
    /**
     * The statement, with placeholders in whatever form the dialect uses.
     */
    sql: string,
    /**
     * The parameter values, in the order the statement refers to them.
     */
    params: unknown[]
};

/**
 * Base data source implementation of zibri.
 * Uses typeorm under the hood.
 */
export abstract class TypeOrmBaseDataSource<TOptions extends DataSourceOptions> implements DataSourceInterface {
    abstract readonly entities: Newable<BaseEntity>[];

    /**
     * Who is responsible for making the database match the entities.
     *
     * Has no default on purpose. This used to be typeorm's `synchronize` and it was opt *out*, so a
     * data source that never mentioned it got schema altering ddl on every boot - which is right for
     * a prototype and destroys a column for anybody else. There is no value that is safe to assume,
     * so it is asked for instead.
     */
    abstract readonly schemaManagement: SchemaManagement;

    /**
     * The type of the data source.
     */
    protected abstract readonly type: TOptions['type'];

    /**
     * Converter responsible for transforming a Zibri WhereFilter into a TypeORM FindOptionsWhere.
     */
    protected abstract whereFilterConverter: TypeOrmWhereFilterConverter | undefined;

    /**
     * The configuration options of the data source.
     */
    readonly options: Partial<OmitStrict<TOptions, 'type' | 'entities'>> = {};

    /**
     * The default configuration options of the data source.
     */
    protected abstract readonly defaultOptions: OmitStrict<TOptions, 'type' | 'entities'>;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Combination of the default and user provided options.
     */
    protected get fullOptions(): OmitStrict<TOptions, 'type' | 'entities'> {
        return {
            ...this.defaultOptions,
            ...this.options
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly migrations: Newable<Migration>[] = [];

    /**
     * The internal typeorm data source.
     */
    protected ds?: TODataSource;

    /**
     * Mapping from a Zibri property type to a typeorm column type.
     */
    protected readonly columnTypeMapping: Partial<Record<ToColumnMappableTypes, ColumnType>> = {};

    /**
     * Default mapping from a Zibri property type to a typeorm column type.
     */
    protected abstract readonly defaultColumnTypeMapping: Record<ToColumnMappableTypes, ColumnType>;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Combination of the default and user provided column type mapping.
     */
    protected get fullColumnTypeMapping(): Record<ToColumnMappableTypes, ColumnType> {
        return {
            ...this.defaultColumnTypeMapping,
            ...this.columnTypeMapping
        };
    }

    private readonly repositories: Map<Newable<BaseEntity>, Repository<BaseEntity>> = new Map();

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        protected readonly authService: AuthServiceInterface
    ) {}

    /**
     * The column type a number property is stored as.
     *
     * Its own declaration rather than a row in `defaultColumnTypeMapping`, because a number is the
     * one property type that says more about itself: the format decides how much of a number the
     * column has to hold, and a whole number, a large whole number and an exact decimal are three
     * different columns. Abstract so that a store with fewer of those to offer has to say what it
     * does instead, rather than quietly storing all four the same way.
     * @param format - What kind of number the property holds.
     * @returns The column type to declare.
     */
    protected abstract numberColumnType(format: NumberFormat): ColumnType;

    abstract validateBackupConfiguration(): void | Promise<void>;
    abstract createBackupData(): Readable | Promise<Readable>;
    abstract restoreBackup(backupData: Readable): void | Promise<void>;

    /**
     * Reads the properties a refused write collided on off a failed query.
     *
     * Dialect specific, which is why it cannot live in the shared driver: postgres reports a unique
     * violation as sql state 23505 and names the columns in its detail, mysql as error 1062 naming the
     * key in its message. So both what a failed query has to be asked and where the answer sits differ
     * per server, while what the driver does with the answer does not.
     * @param error - The error the query failed with.
     * @returns The property names, or undefined when the query failed for some other reason.
     */
    abstract violatedUniqueProperties(error: TOQueryFailedError): string[] | undefined;

    /**
     * Reads what a failed query found in a json column that the model does not describe.
     *
     * Dialect specific for the same reason the unique violation above is: what a server calls the
     * failure and where it puts the details are its own, while what the driver does with the answer
     * is not. Only json columns can hold a value the model contradicts - every other column is the
     * type it declares, checked by the server on the way in.
     * @param error - The error the query failed with.
     * @returns What was found, or undefined when the query failed for some other reason.
     */
    abstract mistypedJsonValue(error: TOQueryFailedError): MistypedJsonValue | undefined;

    /**
     * Transforms the given Zibri where filter to typeorm's FindOptionsWhere.
     * @param filter - The filter to transform.
     * @param entityClass - The entity class that the where filter is for.
     * @returns TypeOrm's FindOptionsWhere.
     * @throws When the data source hasn't been initialized yet.
     */
    whereFilterToFindOptionsWhere<T extends object>(
        filter: Where<T>,
        entityClass: Newable<T>
    ): Where<T> extends WhereFilter<T>[] ? ToFindOptionsWhere<T>[] : ToFindOptionsWhere<T> {
        if (!this.whereFilterConverter) {
            throw new DataSourceInitializationError();
        }
        return this.whereFilterConverter.convert(filter, entityClass) as Where<T> extends WhereFilter<T>[]
            ? ToFindOptionsWhere<T>[]
            : ToFindOptionsWhere<T>;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async init(): Promise<void> {
        if (this.ds) {
            throw new InternalError('The data source has already been initialized.');
        }

        await this.validateOptions(this.fullOptions);
        this.validateSchemaManagement();

        registerRepositoryProvidersFor(this.constructor as Newable<DataSourceInterface>, this);

        const schemas: EntitySchema[] = this.getEntitySchemas();
        this.ds = new TODataSource({
            ...this.fullOptions,
            entities: schemas,
            type: this.type,
            synchronize: false
        } as DataSourceOptions);
        await this.ds.initialize();

        await this.beforeMigrations();

        // Every instance of a deployment runs this same block on boot against the same database.
        // Unguarded, three replicas starting together all read an empty migration table and all run
        // the same migration, and all run the same CREATE TABLE - which surfaces as a unique
        // violation on a postgres catalog index rather than as anything recognizable. Holding the
        // lock across the whole block lets the first instance set the schema up and the rest find
        // the work already done.
        await this.schemaLock(SCHEMA_LOCK_KEY, async () => {
            await this.runMigrations();

            if (this.schemaManagement !== 'synchronize') {
                return;
            }

            await this.ds?.synchronize();
            await this.afterSchemaSetup();
        });
    }

    /**
     * Refuses a data source that names migrations as what manages its schema and then declares none.
     *
     * This is the failure the old opt-out default was hiding: with nothing synchronizing and nothing
     * to migrate, no table is ever created and the first query is where anybody finds out. The
     * declaration is a statement about who does the work, so one that nothing can honour is a
     * misconfiguration rather than a risk to report - `external` is the value for a schema somebody
     * else owns, and it says exactly that.
     * @throws When migrations are named as the schema's owner and the data source has none.
     */
    private validateSchemaManagement(): void {
        if (this.schemaManagement !== 'migrations' || this.migrations.length) {
            return;
        }
        throw new InternalError(
            `The data source "${this.constructor.name}" declares schemaManagement: 'migrations' but has no migrations,`
            + ' so nothing would ever create its tables. Add the migrations, or declare'
            + ' schemaManagement: \'external\' if the schema is created outside this application.'
        );
    }

    /**
     * Runs once the connection is open and before anything creates or changes the schema.
     *
     * Where a data source checks what the server it just connected to can do, while there is still
     * nothing written that would have to be undone.
     */
    protected abstract beforeMigrations(): Promise<void>;

    /**
     * Runs once the schema is in the state this build asks for, under the same lock that put it there.
     *
     * Where a data source brings whatever the orm cannot express in line with what the entities
     * declare. Inside the lock, so that the replicas booting together do not all issue the same ddl.
     */
    protected abstract afterSchemaSetup(): Promise<void>;

    protected abstract schemaLock<T>(key: string, fn: () => Promise<T>): Promise<T>;

    /**
     * Inserts a row, or applies the given changes to the row that already holds the identity, as one
     * statement the database performs atomically.
     *
     * One statement is how a sql data source answers this, so it needs no transaction of its own -
     * a statement is already the smallest thing the database will not interleave. A transaction is
     * still honored when the caller passes one, so the row can be used before it commits and rolls
     * back with it.
     *
     * Everything that is the same across dialects happens here: resolving properties to columns,
     * finding the unique constraint the identity refers to, and reading the returned row back into
     * an entity. Only the statement itself is dialect specific, which is what `buildUpsertSql` is for.
     * @param entityClass - The entity to upsert.
     * @param identity - The properties identifying the row. Must be declared together in `uniques`.
     * @param create - The full row to insert when nothing matches the identity yet.
     * @param onConflict - The changes to apply when a row already matches.
     * @param transaction - The transaction to run in.
     * @returns The row as it is after the statement.
     * @throws When the entity declares no unique group covering the identity, or nothing came back.
     */
    async upsert<T extends BaseEntity>(
        entityClass: Newable<T>,
        identity: DeepPartial<T>,
        create: DeepPartial<T>,
        onConflict: AtomicUpdate<T>,
        transaction: Transaction | undefined
    ): Promise<T> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        const manager: EntityManager = transaction
            ? TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner.manager
            : this.ds.manager;
        const metadata: TOEntityMetadata = manager.connection.getMetadata(entityClass);
        const column: (property: string) => string = property => {
            const found: ColumnMetadata | undefined = metadata.findColumnWithPropertyName(property);
            if (!found) {
                throw new InternalError(`"${entityClass.name}" has no property "${property}".`);
            }
            return found.databaseName;
        };

        const updates: UpsertUpdate[] = [];
        for (const [key, change] of ObjectUtilities.entries(onConflict)) {
            if (change == undefined) {
                continue;
            }
            updates.push(
                'increment' in change
                    ? { column: column(String(key)), increment: change.increment }
                    : { column: column(String(key)), value: change.set }
            );
        }
        if (!updates.length) {
            throw new InternalError('upsert was called with an empty onConflict, so the conflict path would do nothing.');
        }

        const created: [string, unknown][] = Object.entries(create);
        const { sql, params }: UpsertSql = this.buildUpsertSql({
            tableName: metadata.tableName,
            conflict: this.conflictTargetFor(entityClass, Object.keys(identity), column),
            insert: created.map(([key, value]) => ({ column: column(key), value })),
            updates
        });

        const rows: Record<string, unknown>[] = await manager.query(sql, params);

        // through the same walk a write's returned rows go through, rather than copying values onto
        // the entity: a column carries what has to happen on the way out - a json document parsed, a
        // number given back the precision its column keeps - and a relation the entity does not
        // declare a key for carries a column the orm invented, which is not a property at all
        const [res] = TypeOrmUtilities.toEntities(entityClass, TypeOrmUtilities.declaredColumnsOf(metadata), rows);
        if (res == undefined) {
            throw new InternalError('upsert returned no row, which should not be reachable.');
        }
        return res;
    }

    /**
     * Builds the dialect specific upsert statement.
     *
     * Postgres spells this `ON CONFLICT ON CONSTRAINT ... DO UPDATE`, MySQL
     * `ON DUPLICATE KEY UPDATE`, and an increment has to reference the stored value in whatever way
     * the dialect allows - which is why this cannot live in the shared driver.
     * @param input - The already resolved parts of the statement, in column names rather than properties.
     * @returns The statement and its parameters, in the order the statement refers to them.
     */
    protected abstract buildUpsertSql(input: UpsertInput): UpsertSql;

    /**
     * Resolves what an upsert on the given identity conflicts against.
     *
     * A key covering every row is a constraint and is named. A key covering some of them is an
     * index, which has no name a statement can use, so it is described instead - by the columns it
     * is over and the condition it was created with, which together identify exactly one index.
     * Both are built from the same declaration the schema was built from, so neither can drift from
     * what is actually on the table.
     * @param entityClass - The entity the key belongs to.
     * @param identityKeys - The properties the caller identified the row by, in any order.
     * @param column - Resolves a property to the column it is stored in.
     * @returns The conflict target.
     * @throws When the entity declares no unique group covering exactly those properties.
     */
    protected conflictTargetFor<T extends BaseEntity>(
        entityClass: Newable<T>,
        identityKeys: string[],
        column: (property: string) => string
    ): UpsertConflictTarget {
        const declared: UniqueGroup = uniqueGroupFor(entityClass, identityKeys);
        const entityMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
        if (!entityMetadata) {
            throw new EntityMetadataMissingError(entityClass);
        }
        if (declared.where == undefined || coversEveryRow(declared.where)) {
            return { constraintName: uniqueConstraintName(entityMetadata.tableName, declared.properties) };
        }
        return {
            columns: declared.properties.map(p => column(p)),
            // the same function the index's own predicate was written with, so the two strings match
            predicate: keyWhereToSql(entityClass, declared.where)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async shutDown(): Promise<void> {
        await this.ds?.destroy();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startTransaction(options?: StartTransactionOptions): Promise<Transaction> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }

        const runner: QueryRunner = this.createQueryRunner();
        try {
            await runner.connect();
            await runner.startTransaction(options?.isolationLevel);
            return new TypeOrmTransaction(runner);
        }
        catch (error) {
            await runner.release();
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runMigrations(): Promise<void> {
        await this.createMigrationTableIfNotExists();
        await runMigrations(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revertMigrationsAfter(targetVersion: SemVerVersion): Promise<void> {
        await this.createMigrationTableIfNotExists();
        await revertMigrationsAfter(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger, targetVersion);
    }

    /**
     * Creates a query runner.
     * @returns A query runner.
     * @throws When the data source has not been initialized yet.
     */
    createQueryRunner(): QueryRunner {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        return this.ds.createQueryRunner();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getRepository<T extends BaseEntity>(cls: Newable<T>): RepositoryTypeForEntity<T> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        if (!this.entities.find(e => e === cls)) {
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

        const driver: TypeOrmRepositoryDriver<T> = new TypeOrmRepositoryDriver(
            cls,
            this.ds.getRepository(cls),
            this
        );

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
    async addPropertyToEntity<T extends BaseEntity>(
        entity: Newable<T>,
        key: keyof T,
        transaction: Transaction
    ): Promise<void> {
        const col: TableColumnOptions = this.propertyToTableColumnOptions(entity, key);
        await TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner.addColumn(
            TypeOrmUtilities.getEntityMetadata(entity, transaction).tableName,
            new TableColumn({ ...col, isNullable: true })
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async changePropertyOfEntity<T extends BaseEntity>(
        entity: Newable<T>,
        oldColumn: keyof T | string & {},
        newColumn: PropertyMetadataInput & {
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
        const entityMetadata: TOEntityMetadata = TypeOrmUtilities.getEntityMetadata(entity, transaction);
        const columnMetadata: ColumnMetadata = TypeOrmUtilities.getColumnMetadata(entity, oldColumn, transaction);

        const col: TableColumnOptions = {
            ...columnMetadata,
            ...newColumn,
            enum: 'enum' in newColumn && newColumn.enum
                ? ObjectUtilities.values(newColumn.enum).map(v => String(v))
                : columnMetadata.enum
                    ? columnMetadata.enum.map(v => String(v))
                    : undefined,
            name: String(newColumn.name ?? oldColumn),
            type: TypeOrmUtilities.normalizeColumnType(
                this.ds,
                {
                    precision: undefined,
                    scale: undefined,
                    ...columnMetadata,
                    ...newColumn,
                    // through the same route a column declared on an entity takes, so that a
                    // migration changing a property to one of the number formats lands the column
                    // the entity would have declared for it. The cast is what asking for the format
                    // costs: the input types omit `type`, so the union has nothing to narrow on and
                    // the check above is the only thing that knows which member this is
                    type: newColumn.type === 'number'
                        ? this.numberColumnType((newColumn as NumberPropertyMetadataInput).format ?? 'number')
                        : this.fullColumnTypeMapping[newColumn.type]
                }
            )
        };

        await TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner.changeColumn(
            entityMetadata.tableName,
            String(oldColumn),
            new TableColumn(col)
        );
    }

    /**
     * Gets entity schemas for the entities of this data source.
     * @returns TypeOrm entity schemas.
     */
    protected getEntitySchemas(): EntitySchema[] {
        const schemas: EntitySchema[] = this.entities.map(e => this.createSchemaForEntity(e));
        return schemas;
    }

    /**
     * Transforms the property on the given entity class to typeorm column options.
     * @param entity - The entity class which property should be transformed.
     * @param property - The key of the actual property that should be transformed.
     * @returns TypeOrm column options.
     * @throws When no data source has been provided or no column metadata could be found.
     */
    protected propertyToTableColumnOptions<T extends BaseEntity>(entity: Newable<T>, property: keyof T): TableColumnOptions {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        const schema: EntitySchema = this.createSchemaForEntity(entity);
        const metadata: TOEntityMetadata = this.ds.getMetadata(schema);
        const col: ColumnMetadata | undefined = metadata.columns.find(c => c.propertyName === property);

        if (!col) {
            throw new InternalError(`Could not determine column metadata for ${entity.name}.${String(property)}`);
        }

        return {
            name: col.databaseName,
            ...col,
            enum: col.enum ? col.enum?.map(v => String(v)) : undefined,
            type: TypeOrmUtilities.normalizeColumnType(
                this.ds,
                {
                    isArray: col.isArray,
                    length: col.length,
                    precision: col.precision,
                    scale: col.scale,
                    type: col.type
                }
            )
        };
    }

    /**
     * Creates a typeorm entity schema for a single entity.
     * @param cls - The entity class to create the schema for.
     * @returns A typeorm entity schema.
     * @throws When the provided entity was configured incorrectly.
     */
    protected createSchemaForEntity(cls: Newable<BaseEntity>): EntitySchema {
        const entityMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(cls);
        if (!entityMetadata) {
            throw new EntityMetadataMissingError(cls);
        }
        const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);

        this.validateEntityClassMetadata(entityMetadata, props);

        const numberOfPrimaryKeys: number = ObjectUtilities
            .values(props)
            .filter(d => 'primary' in d && d.primary)
            .length;
        if (numberOfPrimaryKeys === 0) {
            throw new InternalError(`no primary key specified for entity "${cls.name}".`);
        }
        if (numberOfPrimaryKeys > 1) {
            throw new InternalError(`more than 1 primary key specified for entity "${cls.name}".`);
        }

        const columns: Record<string, EntitySchemaColumnOptions> = {};
        const relations: Record<string, EntitySchemaRelationOptions> = {};
        for (const [key, m] of ObjectUtilities.entries(props)) {
            if (
                m.type === Relation.MANY_TO_ONE
                || m.type === Relation.ONE_TO_MANY
                || m.type === Relation.HAS_ONE
                || m.type === Relation.BELONGS_TO_ONE
                || m.type === Relation.MANY_TO_MANY
            ) {
                relations[key] = this.propertyToRelationOptions(cls, key, m);
                continue;
            }
            columns[key] = this.propertyToColumnOptions(m);
        }

        // read rather than taken from the registry, so that building a schema is not what first
        // resolves a class there - see keyGroupsOf. A property carrying `index` or `unique` and a
        // group under the entity arrive here as one list either way
        const groups: KeyGroups = keyGroupsOf(cls);

        return new EntitySchema({
            name: cls.name,
            target: cls,
            tableName: entityMetadata.tableName,
            columns,
            relations,
            // named explicitly rather than left to typeorm's generated hash, because a migration
            // adding or dropping the constraint has to be able to refer to it by name. Only the
            // groups covering every row: a constraint cannot be given a predicate, so the ones that
            // leave rows out are created as indices below
            uniques: entityMetadata.uniques
                ?.filter(g => coversEveryRow(g.where))
                .map(g => ({ name: uniqueConstraintName(entityMetadata.tableName, g.properties), columns: g.properties })),
            indices: [
                ...groups.indexes.map(c => ({ name: indexName(entityMetadata.tableName, c), columns: c })),
                // a unique that covers only some rows is one of these rather than a constraint, and
                // it keeps the constraint's name because it is still what a migration refers to when
                // it adds or drops the uniqueness of those columns
                ...groups.uniques.flatMap(g => g.where == undefined || coversEveryRow(g.where)
                    ? []
                    : [
                        {
                            name: uniqueConstraintName(entityMetadata.tableName, g.properties),
                            columns: g.properties,
                            unique: true,
                            where: keyWhereToSql(cls, g.where)
                        }
                    ]),
                ...this.indicesOwnedBySelf(cls, entityMetadata.tableName)
            ]
        });
    }

    /**
     * The indices this data source creates and drops itself, declared so that the orm leaves them be.
     *
     * An index kind the orm cannot write is one it also cannot recognize, and it drops every index on
     * a table it did not put there. Naming them here with `synchronize: false` is what stops that:
     * the orm then neither creates nor drops them, and the data source owns them end to end.
     * @param cls - The entity the schema is being built for.
     * @param tableName - The table it is stored in.
     * @returns The indices to declare, each with `synchronize: false`.
     */
    protected abstract indicesOwnedBySelf<T extends BaseEntity>(cls: Newable<T>, tableName: string): EntitySchemaIndexOptions[];

    /**
     * Transforms the given relation metadata to typeorm relation options.
     * @param cls
     * @param key
     * @param metadata - The relation metadata to transform.
     * @returns TypeOrm relation options.
     * @throws If a belongs to one or many to one relation hasn't specified a join column.
     */
    protected abstract propertyToRelationOptions<T extends BaseEntity>(
        cls: Newable<T>,
        key: string,
        metadata: RelationMetadata<T>
    ): EntitySchemaRelationOptions;

    /**
     * Transforms the given property metadata to typeorm column options.
     * @param metadata - The property metadata to transform.
     * @returns TypeOrm column options.
     * @throws When the metadata is incorrect.
     */
    protected abstract propertyToColumnOptions(
        metadata: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>
    ): EntitySchemaColumnOptions;

    /**
     * Validates the entity class metadata and its properties.
     * @param metadata - The entity class metadata.
     * @param props - The properties of the entity class.
     */
    // eslint-disable-next-line unusedImports/no-unused-vars
    protected validateEntityClassMetadata(metadata: EntityMetadata, props: Record<string, PropertyMetadata>): void {
        // do nothing by default.
    }

    /**
     * Validates the data source options.
     * @param options - The full options to validate.
     */
    // eslint-disable-next-line unusedImports/no-unused-vars
    protected validateOptions(options: OmitStrict<TOptions, 'type' | 'entities'>): void | Promise<void> {
        // do nothing by default.
    }

    /**
     * Creates a table for migrations if it does not exist already.
     */
    protected async createMigrationTableIfNotExists(): Promise<void> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }

        const runner: QueryRunner = this.createQueryRunner();
        try {
            await runner.connect();
            const schema: EntitySchema = this.createSchemaForEntity(MigrationEntity);
            const metadata: TOEntityMetadata = this.ds.getMetadata(schema);
            const table: Table = new Table({
                name: metadata.tablePath,
                columns: metadata.columns.map(col => ({
                    name: col.databaseName,
                    ...col,
                    enum: col.enum?.map(v => String(v)),
                    type: TypeOrmUtilities.normalizeColumnType(this.ds, col)
                }))
            });
            await runner.createTable(table, true);

        }
        finally {
            await runner.release();
        }
    }
}