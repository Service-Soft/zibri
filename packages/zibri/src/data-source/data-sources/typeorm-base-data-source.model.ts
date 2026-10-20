import { Readable } from 'node:stream';

import { EntityManager, EntitySchema, EntitySchemaColumnOptions, EntitySchemaIndexOptions, EntitySchemaRelationOptions, QueryRunner, Table, TableColumn, TableColumnOptions, TableForeignKey, DataSource as TODataSource, EntityMetadata as TOEntityMetadata, QueryFailedError as TOQueryFailedError, FindOptionsWhere as ToFindOptionsWhere } from 'typeorm';
import { ConnectionMetadataBuilder } from 'typeorm/connection/ConnectionMetadataBuilder.js';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';
import { ForeignKeyMetadata } from 'typeorm/metadata/ForeignKeyMetadata.js';
import { RelationMetadata as TORelationMetadata } from 'typeorm/metadata/RelationMetadata.js';

import { DataSourceInitializationError } from './data-source-initialization.error.ts';
import { DataSourceInterface, RepositoryTypeForEntity, SCHEMA_LOCK_KEY, StartTransactionOptions } from './data-source.interface.ts';
import { checkConstraintName } from '../check-constraint-name.function.ts';
import { RepositoryDriverInterface } from '../driver/repository-driver.interface.ts';
import { TypeOrmRepositoryDriver } from '../driver/typeorm.repository-driver.ts';
import { ParameterizedSql } from './where-converter/parameterized-sql.model.ts';
import { TypeOrmWhereFilterConverter } from './where-converter/typeorm-where-filter.converter.ts';
import { type AuthServiceInterface } from '../../auth/auth-service.interface.ts';
import { ChangeSetRepository } from '../../change-sets/change-set-repository.ts';
import { ChangeSetEntity } from '../../change-sets/models/change-set-entity.model.ts';
import { ChangeSet } from '../../change-sets/models/change-set.model.ts';
import { isChangeSetEntityNewable } from '../../change-sets/models/is-change-set-entity.function.ts';
import { isSoftDeleteEntityNewable } from '../../change-sets/models/is-soft-delete-entity.function.ts';
import { SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model.ts';
import { SoftDeleteRepository } from '../../change-sets/soft-delete-repository.ts';
import { AlsUtilities } from '../../context/als.utilities.ts';
import { OperationLimitUtilities } from '../../context/operation-limit.utilities.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { EntityMetadata } from '../../entity/decorators/entity.decorator.ts';
import { PropertyMetadata, RelationMetadata } from '../../entity/decorators/property.decorator.ts';
import { EntityMetadataMissingError } from '../../entity/entity-metadata-missing.error.ts';
import { NumberFormat } from '../../entity/models/number-property-metadata.model.ts';
import { RelationType } from '../../entity/models/relation-type.enum.ts';
import { coversEveryRow, KeyWhere, UniqueGroup } from '../../entity/models/unique-declaration.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { KeyGroups, keyGroupsOf } from '../../global/model-registry/key-descriptor.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { ExcludeStrict } from '../../types/exclude-strict.type.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';
import { PromiseUtilities } from '../../utilities/promise.utilities.ts';
import { TypeOrmUtilities } from '../../utilities/typeorm.utilities.ts';
import { SemVerVersion } from '../../versioning/sem-ver.utilities.ts';
import { registerRepositoryProvidersFor } from '../entity-ownership.function.ts';
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../hooks/hooks.default.ts';
import { indexName, trigramIndexName } from '../index-name.function.ts';
import { MigratedEntityUtilities } from '../migration/migrated-entity.utilities.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';
import { Migration } from '../migration/migration.model.ts';
import { recordKeyReconciliation, revertMigrationsAfter, runMigrations } from '../migration/run-migrations.function.ts';
import { AddPropertyToEntityInput } from '../models/add-property-to-entity-input.model.ts';
import { ChangePropertyOfEntityInput } from '../models/change-property-of-entity-input.model.ts';
import { ColumnType } from '../models/column-type.model.ts';
import { CreateEntityInput } from '../models/create-entity-input.model.ts';
import { DataSourceOptions, ResolvedDataSourceOptions } from '../models/data-source-options.model.ts';
import { MergeEntityInput } from '../models/merge-entity-input.model.ts';
import { MigrationPropertyMetadata } from '../models/migration-property-metadata.model.ts';
import { RefusedValue } from '../models/refused-value.model.ts';
import { RemovePropertyFromEntityInput } from '../models/remove-property-from-entity-input.model.ts';
import { RenameEntityInput } from '../models/rename-entity-input.model.ts';
import { ResolvedPropertyConversion } from '../models/resolved-property-conversion.model.ts';
import { SchemaManagement } from '../models/schema-management.model.ts';
import { UpsertRow } from '../models/upsert-row.model.ts';
import { Where, WhereFilter } from '../models/where/where-filter.model.ts';
import { Repository } from '../repository/repository.ts';
import { MistypedStoredValue } from '../stored-value-type-mismatch.error.ts';
import { Transaction } from '../transaction/transaction.model.ts';
import { TypeOrmTransaction } from '../transaction/typeorm-transaction.model.ts';
import { uniqueConstraintName } from '../unique-constraint-name.function.ts';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error.ts';
import { UpsertIdentityUtilities } from '../upsert-identity.utilities.ts';
import { ValueConversionUtilities } from '../value-conversion.utilities.ts';
import { keyWhereToSql } from '../where/key-where-to-sql.function.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
export type ToColumnMappableTypes = ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>['type'];

/**
 * A table built from what a migration says, as synchronizing would create it.
 */
type MigratedTable = {
    /**
     * The table.
     */
    table: Table,
    /**
     * The metadata the orm built it from.
     */
    metadata: TOEntityMetadata
};

/**
 * A join table that a renamed entity takes part in, as it is stored and as it is stored afterwards.
 */
export type RenamedJoinTable = {
    /**
     * Its name now.
     */
    currentName: string,
    /**
     * Its name afterwards.
     */
    name: string,
    /**
     * Each of its columns, as its name now and afterwards.
     */
    columns: [string, string][],
    /**
     * The columns referring to the renamed entity, as they are named now.
     */
    entityColumns: string[]
};

/**
 * The rows a migration merges from one table into another, as far as every dialect resolves them
 * the same way.
 */
export type MergedRows = {
    /**
     * The table the rows are merged from.
     */
    currentTableName: string,
    /**
     * The table they are merged into.
     */
    tableName: string,
    /**
     * The columns both tables have, which are the ones copied.
     */
    columns: string[],
    /**
     * The primary key column of the table merged into.
     */
    primaryColumn: string,
    /**
     * The uniques the entity declares, as their columns and, for one over some of the rows, the
     * condition it was created with. A row breaking one of them, or the primary key, is left out.
     */
    uniques: MergedUnique[],
    /**
     * The join tables of the rows merged from, which hold relations of the rows that are copied.
     */
    joinTables: RenamedJoinTable[]
};

/**
 * A unique of the table rows are merged into.
 */
export type MergedUnique = {
    /**
     * Its columns.
     */
    columns: string[],
    /**
     * The condition it was created with, without the `WHERE` keyword, or undefined when it covers
     * every row.
     */
    where: string | undefined
};

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
     * The id column of the table.
     */
    idColumn: string,
    /**
     * What identifies a row, as the statement has to refer to it.
     */
    conflict: UpsertConflictTarget,
    /**
     * The columns every row is inserted with.
     */
    columns: string[],
    /**
     * The rows to insert, and what to change for each one whose insert conflicts.
     */
    rows: UpsertInputRow[],
    /**
     * The rows the changes may be applied to, or undefined for any row.
     */
    reachable: UpsertReachable | undefined
};

/**
 * One row of an upsert, resolved to columns.
 */
export type UpsertInputRow = {
    /**
     * The id the row is inserted with, which tells its changes apart from those of the other rows.
     */
    id: unknown,
    /**
     * One value per column of the insert, or `default` for a column this row gives no value for.
     */
    values: ({
        /**
         * The value to write.
         */
        value: unknown
    } | 'default')[],
    /**
     * The changes to apply when the insert of this row conflicts.
     */
    updates: UpsertUpdate[],
    /**
     * The rows this row's changes may be applied to on top of the ones `reachable` allows, or
     * undefined when the row asks nothing of the row it conflicts with.
     */
    condition: UpsertReachable | undefined
};

/**
 * The rows the update half of an upsert may be applied to, as a statement selecting the id of the
 * row the insert conflicted with when it is one of them.
 */
export type UpsertReachable = {
    /**
     * The statement selecting the id, with its placeholders numbered from the first. It refers to the
     * conflicting row by the table's own name.
     */
    sql: string,
    /**
     * The parameter values, in the order the statement refers to them.
     */
    params: unknown[]
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
 * One statement of an upsert, together with the rows it writes.
 */
type UpsertStatement<T extends BaseEntity> = {
    /**
     * The rows the statement writes.
     */
    rows: UpsertRow<T>[],
    /**
     * The statement.
     */
    sql: UpsertSql
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
    abstract readonly options: OmitStrict<TOptions, 'type' | 'entities'>;

    /**
     * The default configuration options of the data source.
     */
    protected abstract readonly defaultOptions: ResolvedDataSourceOptions<Partial<OmitStrict<TOptions, 'type' | 'entities'>>>;

    // eslint-disable-next-line jsdoc-js/require-returns
    /**
     * Combination of the default and user provided options.
     */
    protected get fullOptions(): ResolvedDataSourceOptions<OmitStrict<TOptions, 'type' | 'entities'>> {
        return {
            ...this.defaultOptions,
            ...this.options,
            // named once more, because an option the consumer leaves undefined would otherwise
            // replace the default with nothing
            maxBoundValuesPerStatement: this.options.maxBoundValuesPerStatement ?? this.defaultOptions.maxBoundValuesPerStatement
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly migrations: Newable<Migration>[] = [];

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly migrationTimeoutInMs: number = 0;

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

    // eslint-disable-next-line jsdoc-js/require-returns
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

    /**
     * Changes what a column is stored as, converting the values it already holds.
     *
     * Leaves the column of the changed column's type, length and collation, and without a default.
     *
     * Abstract because converting in place is a statement each store spells its own way, and the
     * orm's own answer to a changed type is to drop the column and add it again - which is what a
     * migration changing a property must never do to the rows it is migrating.
     * @param queryRunner - The query runner of the migration's transaction.
     * @param tableName - The table the column belongs to.
     * @param current - The column as it is stored now.
     * @param changed - The column as it is to be stored.
     * @param conversion - What each stored value becomes, as {@link ValueConversionUtilities} defines it.
     */
    protected abstract convertColumnInPlace(
        queryRunner: QueryRunner,
        tableName: string,
        current: TableColumn,
        changed: TableColumn,
        conversion: ResolvedPropertyConversion
    ): Promise<void>;

    /**
     * Finds the stored values a property change cannot convert, before it changes anything.
     *
     * Abstract because it is a query each store spells its own way, while what it has to answer is
     * the same everywhere: what {@link ValueConversionUtilities.resolveConvertedValue} refuses.
     * @param queryRunner - The query runner of the migration's transaction.
     * @param tableName - The table the column belongs to.
     * @param current - The column as it is stored now.
     * @param changed - The column as it is to be stored.
     * @param conversion - What each stored value becomes.
     * @returns Each distinct value that cannot be converted, and why.
     */
    protected abstract findRefusedValues(
        queryRunner: QueryRunner,
        tableName: string,
        current: TableColumn,
        changed: TableColumn,
        conversion: ResolvedPropertyConversion
    ): Promise<RefusedValue[]>;

    /**
     * Makes the indexes and uniques of every entity's table match what the entities declare.
     *
     * Creates every declared one the table does not have, over the rows already stored, and drops
     * every one the data source created that no entity declares anymore. Runs once the migrations
     * have, while the schema lock is held.
     * @returns Whether anything was created or dropped.
     * @throws When stored rows break a declared unique, naming the values they share.
     */
    protected abstract reconcileKeys(): Promise<boolean>;

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
     * @param entityName - The name of the entity the query was made for, which the path starts at.
     * @returns What was found, or undefined when the query failed for some other reason.
     */
    abstract mistypedJsonValue(error: TOQueryFailedError, entityName: string): MistypedStoredValue | undefined;

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

    /**
     * The expression a read is ordered by when it orders by similarity to a search.
     * @param path - The text being compared, as a property path the query builder resolves.
     * @param similarTo - The search the text is compared with.
     * @returns The expression, with the search bound rather than written into it.
     * @throws When the data source hasn't been initialized yet.
     */
    similarityExpression(path: string, similarTo: string): ParameterizedSql {
        if (!this.whereFilterConverter) {
            throw new DataSourceInitializationError();
        }
        return this.whereFilterConverter.similarityExpression(path, similarTo);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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
        // Under the migration timeout rather than the statement timeout: an index built over a large
        // table, or a migration rewriting one, is the work this block exists for, and cutting it off
        // after the limit an ordinary statement gets would fail the deploy
        await OperationLimitUtilities.runWithin(
            this.migrationTimeoutInMs,
            `Setting up the schema of "${this.constructor.name}"`,
            async () => await this.schemaLock(SCHEMA_LOCK_KEY, async () => {
                await this.runMigrations();

                // after the migrations, which may have renamed or removed what a declaration covers,
                // and only where the migrations own the schema: synchronizing makes the indexes and
                // uniques match on its own, and an external owner is told what is missing instead
                if (this.schemaManagement === 'migrations' && await this.reconcileKeys()) {
                    await recordKeyReconciliation(this.constructor as Newable<DataSourceInterface>);
                }
                if (this.schemaManagement !== 'synchronize') {
                    return;
                }

                await this.ds?.synchronize();
                await this.afterSchemaSetup();
            })
        );
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
     * Inserts each row, or applies its changes to the row that already holds its identity, as one
     * statement the database performs atomically.
     *
     * One statement is how a sql data source answers this, so it needs no transaction of its own -
     * a statement is already the smallest thing the database will not interleave. A transaction is
     * still honored when the caller passes one, so the rows can be used before it commits and roll
     * back with it.
     *
     * Everything that is the same across dialects happens here: resolving properties to columns,
     * finding the unique constraint the identity refers to, and reading the returned rows back into
     * entities. Only the statement itself is dialect specific, which is what `buildUpsertSql` is for.
     * @param entityClass - The entity to upsert.
     * @param identity - The properties identifying each row. Must be declared together in `uniques`.
     * @param rows - What to insert, and what to change when the identity is already held.
     * @param transaction - The transaction to run in.
     * @param reachable - The rows the changes may be applied to, or undefined for any row.
     * @returns The rows as they are after the statement, in the order they were given.
     * @throws When the entity declares no unique group covering the identity, or a row holding one is
     * not one `reachable` allows.
     */
    async upsert<T extends BaseEntity>(
        entityClass: Newable<T>,
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined
    ): Promise<T[]> {
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

        const reachableIds: UpsertReachable | undefined = reachable == undefined
            ? undefined
            : this.selectReachableIds(manager, entityClass, reachable, metadata.tableName, column('id'));
        // each built once, whichever statement the row ends up in
        const conditions: Map<UpsertRow<T>, UpsertReachable> = new Map(rows.flatMap(
            (row): [UpsertRow<T>, UpsertReachable][] => row.where == undefined
                ? []
                : [[row, this.selectReachableIds(manager, entityClass, row.where, metadata.tableName, column('id'))]]
        ));
        const conflict: UpsertConflictTarget = this.conflictTargetFor(entityClass, identity, column);
        const statementFor: (pending: UpsertRow<T>[]) => UpsertSql = pending => this.buildUpsertSql({
            tableName: metadata.tableName,
            idColumn: column('id'),
            conflict,
            ...this.resolveUpsertInputRows(pending, column, conditions),
            reachable: reachableIds
        });

        // through the same walk a write's returned rows go through, rather than copying values onto
        // the entity: a column carries what has to happen on the way out - a json document parsed, a
        // number given back the precision its column keeps - and a relation the entity does not
        // declare a key for carries a column the orm invented, which is not a property at all
        const run: (on: EntityManager, statements: UpsertStatement<T>[]) => Promise<Map<UpsertRow<T>, T>> = async (on, statements) => {
            const paired: Map<UpsertRow<T>, T>[] = await PromiseUtilities.allChunked(statements, async statement => {
                const returned: unknown = await on.query(statement.sql.sql, statement.sql.params);
                const entities: T[] = TypeOrmUtilities.toEntities(entityClass, TypeOrmUtilities.declaredColumnsOf(metadata), returned);
                return this.pairUpserted(identity, statement.rows, entities);
            });
            return new Map(paired.flatMap(p => [...p]));
        };
        // in one order whatever order they were given in. A statement locks each row it conflicts
        // with as it reaches it, so two batches naming the same rows in opposite orders would each
        // hold what the other waits on until the database ends one of them. By identity, every batch
        // takes what it shares with another in the same order. The caller still gets its own order
        // back, because the rows are paired by identity rather than by position
        const identities: Map<UpsertRow<T>, string> = new Map(
            rows.map(row => [row, UpsertIdentityUtilities.resolveValues(identity, row.create)])
        );
        const ordered: UpsertRow<T>[] = [...rows].sort((a, b) => {
            const left: string = identities.get(a) ?? '';
            const right: string = identities.get(b) ?? '';
            return left < right ? -1 : left > right ? 1 : 0;
        });
        const statements: UpsertStatement<T>[] = this.resolveUpsertStatements(ordered, statementFor);
        const write: (on: EntityManager) => Promise<Map<UpsertRow<T>, T>> = async on => {
            const res: Map<UpsertRow<T>, T> = await run(on, statements);
            // a row that came back with nothing conflicted with a row it was not allowed to change -
            // or with one committed after the statement began: the conflict is judged against the
            // newest row, and the select deciding which rows may be changed against what the
            // statement could see when it started, which is not that row yet. A fresh statement sees
            // it, so those rows are asked once more and land if they may. Nothing of theirs was
            // written by the first run, so running them again changes nothing twice
            const missing: UpsertRow<T>[] = ordered.filter(row => !res.has(row));
            if (missing.length && (reachable != undefined || conditions.size)) {
                for (const [row, entity] of await run(on, this.resolveUpsertStatements(missing, statementFor))) {
                    res.set(row, entity);
                }
            }
            return res;
        };

        // one statement is atomic on its own. A batch past what one statement binds is several, held
        // together the way one statement holds itself - unless the caller's own transaction already
        // does. Either way they share one connection, so the statements handed over together still
        // reach the server one after the other, and one failing rolls back the rest with it
        const written: Map<UpsertRow<T>, T> = transaction == undefined && statements.length > 1
            ? await this.ds.transaction(async own => await write(own))
            : await write(manager);

        return rows.map(row => {
            const res: T | undefined = written.get(row);
            if (res != undefined) {
                return res;
            }
            if (reachable != undefined || conditions.has(row)) {
                // what inserting the identity would have answered, since to this caller the row
                // holding it is not there - or not one they may change
                const group: UniqueGroup = UpsertIdentityUtilities.resolveUniqueGroup(entityClass, identity);
                throw new UniqueConstraintViolationError(entityClass.name, group.properties);
            }
            throw new InternalError('upsert returned no row, which should not be reachable.');
        });
    }

    /**
     * Splits the rows of an upsert into statements that each bind no more values than
     * `maxBoundValuesPerStatement`.
     * @param rows - The rows to write.
     * @param statementFor - Builds the statement for some of the rows.
     * @returns The statements, each with the rows it writes.
     */
    private resolveUpsertStatements<T extends BaseEntity>(
        rows: UpsertRow<T>[],
        statementFor: (pending: UpsertRow<T>[]) => UpsertSql
    ): UpsertStatement<T>[] {
        const sql: UpsertSql = statementFor(rows);
        if (sql.params.length <= this.fullOptions.maxBoundValuesPerStatement || rows.length === 1) {
            return [{ rows, sql }];
        }
        // halved rather than cut to a size worked out up front, because how many values a row binds
        // is the dialect's to say and differs per row: one leaves a column to its default, another
        // changes more columns on a conflict
        const half: number = Math.ceil(rows.length / 2);
        return [
            ...this.resolveUpsertStatements(rows.slice(0, half), statementFor),
            ...this.resolveUpsertStatements(rows.slice(half), statementFor)
        ];
    }

    /**
     * Resolves the rows of an upsert to the columns one statement inserts them with.
     * @param rows - The rows to insert, and what to change for each one whose insert conflicts.
     * @param column - Resolves a property to the column it is stored in.
     * @param conditions - The statement selecting the rows each conditioned row may change.
     * @returns The columns, and each row's values and changes.
     * @throws When a row has nothing to change on a conflict.
     */
    private resolveUpsertInputRows<T extends BaseEntity>(
        rows: UpsertRow<T>[],
        column: (property: string) => string,
        conditions: Map<UpsertRow<T>, UpsertReachable>
    ): Pick<UpsertInput, 'columns' | 'rows'> {
        // every property any row names, because one statement inserts every row with the same columns
        const properties: string[] = [...new Set(rows.flatMap(row => Object.keys(row.create)))];
        return {
            columns: properties.map(p => column(p)),
            rows: rows.map(row => {
                const values: Map<string, unknown> = new Map(Object.entries(row.create));
                const updates: UpsertUpdate[] = [];
                for (const [key, change] of ObjectUtilities.entries(row.onConflict)) {
                    if (change == undefined) {
                        continue;
                    }
                    updates.push(
                        'increment' in change
                            ? { column: column(key), increment: change.increment }
                            : { column: column(key), value: change.set }
                    );
                }
                if (!updates.length) {
                    throw new InternalError('upsert was called with an empty onConflict, so the conflict path would do nothing.');
                }
                return {
                    id: values.get('id'),
                    // a property this row leaves out is written the way inserting it alone would write it
                    values: properties.map(p => values.has(p) ? { value: values.get(p) } : 'default'),
                    updates,
                    condition: conditions.get(row)
                };
            })
        };
    }

    /**
     * Pairs the rows an upsert statement returned with the rows it was given.
     *
     * A statement promises no order for what it returns, and leaves out a row it was not allowed to
     * change. What both sides hold is the identity, which a change on conflict leaves as it is.
     * @param identity - The properties identifying each row.
     * @param rows - The rows the statement was given.
     * @param returned - The rows it returned.
     * @returns The row written for each row given, keyed by the row given. A row missing from it was
     * not written.
     * @throws When a returned row pairs with none of the rows given.
     */
    private pairUpserted<T extends BaseEntity>(
        identity: string[],
        rows: UpsertRow<T>[],
        returned: T[]
    ): Map<UpsertRow<T>, T> {
        const [onlyRow] = rows;
        const [onlyReturned] = returned;
        // one row given and one returned are each other's, whatever form the database gave the
        // values back in
        if (rows.length === 1 && returned.length === 1 && onlyRow != undefined && onlyReturned != undefined) {
            return new Map([[onlyRow, onlyReturned]]);
        }

        const byIdentity: Map<string, T> = new Map(returned.map(r => [UpsertIdentityUtilities.resolveValues(identity, r), r]));
        const res: Map<UpsertRow<T>, T> = new Map();
        for (const row of rows) {
            const written: T | undefined = byIdentity.get(UpsertIdentityUtilities.resolveValues(identity, row.create));
            if (written != undefined) {
                res.set(row, written);
            }
        }
        // a returned row that pairs with nothing was written but cannot be told apart from one that
        // was refused, and running its row again would apply its change twice
        if (res.size !== returned.length) {
            throw new InternalError(
                'upsert returned a row whose identity matches none of the rows it was given, so the rows cannot be paired.'
            );
        }
        return res;
    }

    /**
     * Builds the statement selecting the id of the row an upsert conflicted with, when its update
     * half may apply to that row.
     *
     * Through the same conversion a read's filter goes through, so the rows an upsert may land on are
     * exactly the rows a read with that filter would find.
     * @param manager - What the upsert runs on.
     * @param entityClass - The entity being upserted.
     * @param reachable - The filter those rows match.
     * @param tableName - The table the upsert writes to, which is how the statement names the row it
     * conflicted with.
     * @param idColumn - The id column of that table.
     * @returns The statement and its parameters.
     */
    private selectReachableIds<T extends BaseEntity>(
        manager: EntityManager,
        entityClass: Newable<T>,
        reachable: Where<T>,
        tableName: string,
        idColumn: string
    ): UpsertReachable {
        const escape: (name: string) => string = name => manager.connection.driver.escape(name);
        // asked about the one row the conflict landed on rather than about every row the filter
        // matches: the filter is the caller's scope alone, which can match most of a table, and this
        // keeps what the statement binds from growing with the rows the batch writes
        const [sql, params] = manager
            .createQueryBuilder(entityClass, 'reachable')
            .setFindOptions({ where: this.whereFilterToFindOptionsWhere(reachable, entityClass) })
            .andWhere(`${escape('reachable')}.${escape(idColumn)} = ${escape(tableName)}.${escape(idColumn)}`)
            .select('reachable.id')
            .getQueryAndParameters();
        return { sql, params };
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
     * Builds the expression an update sets an object column to: the object it holds, with the given
     * one merged in as {@link WriteDataUtilities.resolveMerged} merges it.
     * @param target - The expression reading the stored object, the escaped column to begin with.
     * @param value - The object the update gives.
     * @param cls - Its declared class.
     * @param parameters - The named parameters of the statement, which this adds the ones it binds to.
     * @param name - What the names of the parameters it binds start with, unique in the statement.
     * @returns The expression.
     */
    abstract buildObjectMergeSql(
        target: string,
        value: object,
        cls: Newable<unknown>,
        parameters: Record<string, unknown>,
        name: string
    ): string;

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
        const declared: UniqueGroup = UpsertIdentityUtilities.resolveUniqueGroup(entityClass, identityKeys);
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async shutDown(): Promise<void> {
        await this.ds?.destroy();
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async startTransaction(options?: StartTransactionOptions): Promise<Transaction> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }

        const runner: QueryRunner = this.createQueryRunner();
        // outside the try: a runner that gave up waiting hands its connection back itself, once it
        // has one. Released here, before then, it would never be handed back
        await this.connectQueryRunner(runner);
        try {
            await runner.startTransaction(options?.isolationLevel);
            return new TypeOrmTransaction(runner);
        }
        catch (error) {
            await runner.release();
            throw error;
        }
    }

    /**
     * Takes a connection from the pool for the given runner, and stops waiting for one once the request
     * or the work this runs in has run out of time.
     * @param runner - The runner.
     * @throws What the request or the work was abandoned with, when that comes first.
     */
    async connectQueryRunner(runner: QueryRunner): Promise<void> {
        const connecting: Promise<unknown> = runner.connect();
        try {
            await PromiseUtilities.withSignal(connecting, AlsUtilities.findCurrentSignal());
        }
        catch (error) {
            // the pool still hands a connection over once one comes free, and nobody is waiting for it
            // any more. Released only then, since a runner released before it is connected never hands
            // back what it is given afterwards
            // eslint-disable-next-line promise/prefer-await-to-then
            void connecting.then(async () => await runner.release(), () => undefined);
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async runMigrations(): Promise<void> {
        await this.createMigrationTableIfNotExists();
        await runMigrations(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

        const existingRepository: RepositoryTypeForEntity<T> | undefined = this.repositories.get(cls) as RepositoryTypeForEntity<T> | undefined;
        if (existingRepository) {
            return existingRepository;
        }

        const driver: TypeOrmRepositoryDriver<T> = new TypeOrmRepositoryDriver(
            cls,
            this.ds.getRepository(cls),
            this,
            this.fullOptions.maxBoundValuesPerStatement
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async addPropertyToEntity<T extends BaseEntity>({ entity, property, transaction }: AddPropertyToEntityInput<T>): Promise<void> {
        const queryRunner: QueryRunner = TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner;
        const tableName: string = MigratedEntityUtilities.resolveTableName(entity);
        const migrated: MigratedTable = await this.buildMigratedTable(
            MigratedEntityUtilities.defineEntity(tableName, { [String(property.name)]: property })
        );
        const column: TableColumn = this.findMigratedColumn(migrated, String(property.name));

        // nullable whatever the property says, because the rows already stored have no value for it
        // yet - the migration fills them, and changing the property afterwards makes it required
        await queryRunner.addColumn(tableName, new TableColumn({ ...column, isNullable: true }));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async changePropertyOfEntity<T extends BaseEntity, C extends MigrationPropertyMetadata, M extends MigrationPropertyMetadata>(
        input: ChangePropertyOfEntityInput<T, C, M>
    ): Promise<void> {
        const conversion: ResolvedPropertyConversion = ValueConversionUtilities.resolveConversion(input);
        const queryRunner: QueryRunner = TypeOrmUtilities.toTypeOrmTransaction(input.transaction).queryRunner;
        const tableName: string = TypeOrmUtilities.getEntityMetadata(input.entity, input.transaction).tableName;

        // the column as the database holds it rather than as the class declares it: a rename is the
        // one change where the class has no column under the stored name any more
        const current: TableColumn | undefined = (await queryRunner.getTable(tableName))?.findColumnByName(conversion.currentName);
        if (current == undefined) {
            throw new InternalError(
                `Cannot change ${conversion.entity}.${conversion.currentName}, because nothing is stored under that name.`
            );
        }
        // the columns the migration describes rather than the ones the entity declares now, since the
        // entity may have changed again by the time an old migration runs
        const described: TableColumn = await this.buildMigratedColumn(tableName, conversion.currentName, input.currentProperty);
        if (!this.isSameColumnType(current, described)) {
            throw new InternalError(
                `Cannot change ${conversion.entity}.${conversion.currentName}, because it is stored as`
                + ` ${queryRunner.connection.driver.createFullType(current)}, and the current property describes`
                + ` ${queryRunner.connection.driver.createFullType(described)}.`
            );
        }
        const changed: TableColumn = await this.buildMigratedColumn(tableName, conversion.changedName, input.property);
        // a unique is migrated by the unique helpers, not by changing its property. The column read
        // from the database is unique when a unique covers it alone, and the one built from the
        // migration never is - which changeColumn takes for dropping that unique
        changed.isUnique = current.isUnique;

        // every value checked before anything changes, so that a migration that cannot convert one
        // fails naming all of them rather than with whatever the database makes of the first
        ValueConversionUtilities.validateNothingRefused(
            conversion,
            await this.findRefusedValues(queryRunner, tableName, current, changed, conversion)
        );

        // the same test typeorm's changeColumn applies, because what it answers with for these is a
        // drop and an add: the column comes back empty, and a required one cannot come back at all
        // on a table that has rows
        const changesType: boolean = !this.isSameColumnType(current, changed);
        if (!changesType && !conversion.values.length) {
            await queryRunner.changeColumn(tableName, current, changed);
            return;
        }

        // so the values change here, in place, and typeorm is left the parts it does change in
        // place - a rename, nullability, a default
        await this.convertColumnInPlace(queryRunner, tableName, current, changed, conversion);
        const converted: TableColumn = current.clone();
        converted.type = changed.type;
        converted.length = changed.length;
        converted.isArray = changed.isArray;
        // the conversion collates as the changed column does, which for a type that is not text is
        // not at all - left as it was, the orm would set the old text collation on a number column
        converted.collation = changed.collation;
        // dropped with the conversion, because a default of the old type need not be one of the new
        converted.default = undefined;
        await queryRunner.changeColumn(tableName, converted, changed);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async removePropertyFromEntity<T extends BaseEntity>(input: RemovePropertyFromEntityInput<T>): Promise<void> {
        await TypeOrmUtilities.toTypeOrmTransaction(input.transaction).queryRunner.dropColumn(
            TypeOrmUtilities.getEntityMetadata(input.entity, input.transaction).tableName,
            String(input.propertyKey)
        );
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async renameEntity<T extends BaseEntity>({ entity, currentTableName, transaction }: RenameEntityInput<T>): Promise<void> {
        const queryRunner: QueryRunner = TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner;
        const tableName: string = MigratedEntityUtilities.resolveTableName(entity);
        if (await queryRunner.hasTable(tableName)) {
            throw new InternalError(
                `Cannot rename ${currentTableName} to ${tableName}, because something is stored under ${tableName} already.`
            );
        }
        if (!await queryRunner.hasTable(currentTableName)) {
            throw new InternalError(
                `Cannot rename ${currentTableName} to ${tableName}, because nothing is stored under ${currentTableName}.`
            );
        }

        const joinTables: RenamedJoinTable[] = await this.resolveRenamedJoinTables(entity, currentTableName);
        // the orm's own renames, because they also rename what it named after the table or column -
        // its primary keys, foreign keys and indexes
        await queryRunner.renameTable(currentTableName, tableName);
        for (const joinTable of joinTables) {
            if (joinTable.currentName !== joinTable.name) {
                await queryRunner.renameTable(joinTable.currentName, joinTable.name);
            }
            for (const [current, changed] of joinTable.columns.filter(([a, b]) => a !== b)) {
                await queryRunner.renameColumn(joinTable.name, current, changed);
            }
        }
        await this.renameDeclaredKeys(queryRunner, currentTableName, tableName);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async mergeEntity<T extends BaseEntity>({ entity, currentTableName, transaction }: MergeEntityInput<T>): Promise<void> {
        const queryRunner: QueryRunner = TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner;
        const tableName: string = MigratedEntityUtilities.resolveTableName(entity);
        const current: Table | undefined = await queryRunner.getTable(currentTableName);
        if (current == undefined) {
            throw new InternalError(
                `Cannot merge ${currentTableName} into ${tableName}, because nothing is stored under ${currentTableName}.`
            );
        }
        const stored: Table | undefined = await queryRunner.getTable(tableName);
        // into nothing, which is what renaming is
        if (stored == undefined) {
            await this.renameEntity({ entity, currentTableName, transaction });
            return;
        }

        const metadata: TOEntityMetadata = TypeOrmUtilities.getEntityMetadata(entity, transaction);
        const currentColumns: Set<string> = new Set(current.columns.map(c => c.name));
        const joinTables: RenamedJoinTable[] = [];
        // a join table that is not there holds no relation, because the entities merged from had none
        for (const joinTable of await this.resolveRenamedJoinTables(entity, currentTableName)) {
            if (await queryRunner.hasTable(joinTable.currentName)) {
                joinTables.push(joinTable);
            }
        }
        await this.mergeRows(queryRunner, {
            currentTableName,
            tableName,
            columns: stored.columns.map(c => c.name).filter(name => currentColumns.has(name)),
            primaryColumn: metadata.primaryColumns[0]?.databaseName ?? 'id',
            uniques: keyGroupsOf(entity).uniques.map(u => ({
                columns: u.properties.map(p => metadata.findColumnWithPropertyName(p)?.databaseName ?? p),
                where: u.where == undefined || coversEveryRow(u.where) ? undefined : keyWhereToSql(entity, u.where)
            })),
            joinTables
        });

        await this.pointForeignKeysAt(queryRunner, currentTableName, tableName);
        for (const joinTable of joinTables) {
            await queryRunner.dropTable(joinTable.currentName);
        }
        await queryRunner.dropTable(currentTableName);
    }

    /**
     * Copies the rows a migration merges, and the relations they hold.
     *
     * Leaves out every row breaking the primary key or a unique of the table it is merged into, with
     * its relations. Runs before the tables merged from are dropped.
     * @param queryRunner - The query runner of the migration's transaction.
     * @param merge - What to merge.
     */
    protected abstract mergeRows(queryRunner: QueryRunner, merge: MergedRows): Promise<void>;

    /**
     * Points the foreign keys of the entities' tables that refer to one table at another.
     * @param queryRunner - The query runner of the migration's transaction.
     * @param currentTableName - The table they refer to now.
     * @param tableName - The table they refer to afterwards.
     */
    private async pointForeignKeysAt(queryRunner: QueryRunner, currentTableName: string, tableName: string): Promise<void> {
        for (const metadata of queryRunner.connection.entityMetadatas) {
            const table: Table | undefined = await queryRunner.getTable(metadata.tablePath);
            const pointing: TableForeignKey[] = table?.foreignKeys
                .filter(fk => queryRunner.connection.driver.parseTableName(fk.referencedTableName).tableName === currentTableName)
                ?? [];
            if (table == undefined || !pointing.length) {
                continue;
            }
            await queryRunner.dropForeignKeys(table, pointing);
            await queryRunner.createForeignKeys(table, pointing.map(fk => {
                const pointed: TableForeignKey = fk.clone();
                pointed.referencedTableName = tableName;
                return pointed;
            }));
        }
    }

    /**
     * Renames the indexes and uniques an entity declares along with the table they are on.
     *
     * The data source names each of them after the table, and keeps them by that name.
     * @param queryRunner - The query runner of the migration's transaction.
     * @param currentTableName - The name the table had.
     * @param tableName - The name it has now.
     */
    protected abstract renameDeclaredKeys(queryRunner: QueryRunner, currentTableName: string, tableName: string): Promise<void>;

    /**
     * Resolves the join tables an entity takes part in, as they are named while the entity is stored
     * under another table name, and as they are named once it is not.
     * @param entity - The entity being renamed.
     * @param currentTableName - The table name it is stored under now.
     * @returns Every join table at either end of one of its many to many relations.
     * @throws When the data source has not been initialized.
     */
    private async resolveRenamedJoinTables(entity: Newable<BaseEntity>, currentTableName: string): Promise<RenamedJoinTable[]> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        // an entity of no data source is in no relation here
        if (!this.entities.includes(entity)) {
            return [];
        }
        // built again with the entity under its current table name, so that the orm names the join
        // tables and their columns the way it named them when it created them - rather than this
        // repeating its naming rules
        const schemas: EntitySchema[] = this.getDistinctEntities().map(e => {
            const schema: EntitySchema = this.createSchemaForEntity(e);
            return e === entity ? new EntitySchema({ ...schema.options, tableName: currentTableName }) : schema;
        });
        const current: TOEntityMetadata[] = await new ConnectionMetadataBuilder(this.ds).buildEntityMetadatas(schemas);

        const res: RenamedJoinTable[] = [];
        for (const relation of current.flatMap(m => m.manyToManyRelations)) {
            const involved: boolean = relation.entityMetadata.target === entity || relation.inverseEntityMetadata.target === entity;
            if (relation.isOwning && relation.junctionEntityMetadata != undefined && involved) {
                res.push(this.toRenamedJoinTable(this.ds, entity, relation, relation.junctionEntityMetadata));
            }
        }
        return res;
    }

    /**
     * Pairs the join table of a relation as it is named while an entity is stored under another table
     * name with the one it is named once it is not.
     * @param ds - The connection, whose metadata names the join tables as they are named afterwards.
     * @param entity - The entity being renamed.
     * @param relation - The relation, built with the entity under its current table name.
     * @param joinTable - Its join table, built the same way.
     * @returns The join table, as it is named now and afterwards.
     * @throws When the connection built no join table for the relation.
     */
    private toRenamedJoinTable(
        ds: TODataSource,
        entity: Newable<BaseEntity>,
        relation: TORelationMetadata,
        joinTable: TOEntityMetadata
    ): RenamedJoinTable {
        const renamed: TOEntityMetadata | undefined = ds.getMetadata(relation.entityMetadata.target)
            .findRelationWithPropertyPath(relation.propertyPath)
            ?.junctionEntityMetadata;
        if (renamed == undefined) {
            throw new InternalError(`The join table of ${relation.entityMetadata.name}.${relation.propertyPath} was not built.`);
        }
        // in the same order both times: the columns of the owning side, then the inverse side's
        const columns: [string, string][] = joinTable.columns.map((c, i): [string, string] => [
            c.databaseName,
            renamed.columns[i]?.databaseName ?? c.databaseName
        ]);
        const entityColumns: string[] = [
            ...relation.entityMetadata.target === entity ? joinTable.ownerColumns : [],
            ...relation.inverseEntityMetadata.target === entity ? joinTable.inverseColumns : []
        ].map(c => c.databaseName);
        return { currentName: joinTable.tableName, name: renamed.tableName, columns, entityColumns };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async createEntity<T extends BaseEntity>({ entity, transaction, properties }: CreateEntityInput<T>): Promise<void> {
        const queryRunner: QueryRunner = TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner;
        if (properties !== 'resolveFromEntity') {
            const migrated: MigratedTable = await this.buildMigratedTable(
                MigratedEntityUtilities.defineEntity(MigratedEntityUtilities.resolveTableName(entity), properties)
            );
            await queryRunner.createTable(migrated.table, false, false, true);
            return;
        }

        const metadata: TOEntityMetadata = TypeOrmUtilities.getEntityMetadata(entity, transaction);
        // with the join table of each many to many relation it owns, which the orm builds rather than
        // an entity declaring it - so it is part of creating the entity or of nothing
        const tables: TOEntityMetadata[] = [
            metadata,
            ...metadata.manyToManyRelations.flatMap(r => r.isOwning && r.junctionEntityMetadata ? [r.junctionEntityMetadata] : [])
        ];

        for (const table of tables) {
            // a join table's indexes are the orm's, named its own way, and nothing else keeps them
            const built: Table = Table.create(table, queryRunner.connection.driver);
            const created: Table = table === metadata ? this.withoutDeclaredKeys(built, table.tableName) : built;
            await queryRunner.createTable(created, false, false, true);
        }
        await this.createForeignKeysOf(queryRunner, tables.map(t => t.tablePath));
    }

    /**
     * Takes the indexes and uniques an entity declares off a table about to be created.
     *
     * The data source creates those itself once the migrations have run, as it does for an entity
     * that already exists - so they have one owner, whichever way an entity came to be stored. What
     * the orm adds for a relation stays.
     * @param table - The table as the orm builds it.
     * @param tableName - The name of the table.
     * @returns The table, without them.
     */
    private withoutDeclaredKeys(table: Table, tableName: string): Table {
        table.uniques = table.uniques.filter(u => !this.isDeclaredKeyName(u.name, tableName));
        table.indices = table.indices.filter(i => !this.isDeclaredKeyName(i.name, tableName));
        // a column the orm marks unique gets a constraint of its own when the table is created, under
        // a name only the orm arrives at - so it is unique only where a unique that stays says so
        for (const column of table.columns) {
            column.isUnique = table.uniques.some(u => u.columnNames.length === 1 && u.columnNames[0] === column.name);
        }
        return table;
    }

    /**
     * Whether an index or unique of a table is one the data source keeps as an entity declares it.
     * @param name - The name of the index or unique.
     * @param tableName - The table it is on.
     * @returns True when the data source named it, or the orm did with its own default names, and so
     * the data source creates and drops it.
     */
    protected isDeclaredKeyName(name: string | undefined, tableName: string): boolean {
        // the orm's default names as well: this data source names every index and unique it declares
        // itself, so one of those on an entity's table was left by 2.x, which let the orm name them -
        // and is replaced like any other the entity no longer declares. A relation's own (REL_) stays
        const prefixes: string[] = [
            uniqueConstraintName(tableName, []),
            indexName(tableName, []),
            trigramIndexName(tableName, ''),
            'UQ_',
            'IDX_'
        ];
        return name != undefined && prefixes.some(prefix => name.startsWith(prefix));
    }

    /**
     * Creates the foreign keys that tables just created complete.
     *
     * A foreign key needs the tables at both of its ends, so each one is created by whichever of
     * the two comes second - which lets a migration create its entities in any order, two that
     * point at each other included.
     * @param queryRunner - The query runner of the migration's transaction.
     * @param created - The tables just created.
     */
    private async createForeignKeysOf(queryRunner: QueryRunner, created: string[]): Promise<void> {
        for (const owner of queryRunner.connection.entityMetadatas) {
            const candidates: ForeignKeyMetadata[] = owner.foreignKeys
                .filter(fk => created.includes(owner.tablePath) || created.includes(fk.referencedTablePath));
            if (!candidates.length) {
                continue;
            }
            const stored: Table | undefined = await queryRunner.getTable(owner.tablePath);
            if (stored == undefined) {
                continue;
            }
            const missing: TableForeignKey[] = [];
            for (const fk of candidates) {
                if (!stored.foreignKeys.some(existing => existing.name === fk.name) && await queryRunner.hasTable(fk.referencedTablePath)) {
                    missing.push(TableForeignKey.create(fk, queryRunner.connection.driver));
                }
            }
            if (missing.length) {
                await queryRunner.createForeignKeys(stored, missing);
            }
        }
    }

    /**
     * Builds the table an entity class built from a migration describes, the way synchronizing
     * would create it.
     * @param cls - The class built from the migration.
     * @returns The table, and the metadata it was built from.
     * @throws When the data source has not been initialized.
     */
    private async buildMigratedTable(cls: Newable<BaseEntity>): Promise<MigratedTable> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        // through the orm's own metadata builder, so that the class is read exactly as an entity of
        // this data source would be - without registering it as one
        const [metadata]: TOEntityMetadata[] = await new ConnectionMetadataBuilder(this.ds)
            .buildEntityMetadatas([this.createSchemaForEntity(cls)]);
        if (metadata == undefined) {
            throw new InternalError(`The migration's description of "${cls.name}" built no table.`);
        }
        return { table: Table.create(metadata, this.ds.driver), metadata };
    }

    /**
     * Builds the column of a property a migration describes, the way synchronizing would create it.
     * @param tableName - The table the column belongs to.
     * @param name - The name of the property.
     * @param metadata - What the migration says about the property.
     * @returns The column.
     */
    private async buildMigratedColumn(tableName: string, name: string, metadata: MigrationPropertyMetadata): Promise<TableColumn> {
        return this.findMigratedColumn(
            await this.buildMigratedTable(MigratedEntityUtilities.defineEntity(tableName, { [name]: metadata })),
            name
        );
    }

    /**
     * Whether two columns store the same type of value.
     * @param a - The one column.
     * @param b - The other column.
     * @returns True when type, length and being an array all match - what the database stores, rather
     * than whether it takes no value or what it defaults to.
     */
    private isSameColumnType(a: TableColumn, b: TableColumn): boolean {
        // a column without a length has an empty one read from the database and none built from
        // metadata, which is the same thing
        return a.type === b.type && (a.length || undefined) === (b.length || undefined) && a.isArray === b.isArray;
    }

    /**
     * Finds a column of a table built from a migration.
     * @param migrated - The table.
     * @param name - The column's name.
     * @returns The column.
     * @throws When the table has no such column.
     */
    private findMigratedColumn(migrated: MigratedTable, name: string): TableColumn {
        const column: TableColumn | undefined = migrated.table.findColumnByName(name);
        if (column == undefined) {
            throw new InternalError(`The migration's description of ${migrated.table.name} has no column "${name}".`);
        }
        return column;
    }

    /**
     * Gets entity schemas for the entities of this data source.
     * @returns TypeOrm entity schemas.
     */
    protected getEntitySchemas(): EntitySchema[] {
        const schemas: EntitySchema[] = this.getDistinctEntities().map(e => this.createSchemaForEntity(e));
        return schemas;
    }

    /**
     * Gets the entities of this data source, each once.
     * @returns The entities.
     */
    private getDistinctEntities(): Newable<BaseEntity>[] {
        // an entity listed twice is still one entity, as resolveEntityOwnership has it. Given two
        // schemas of one class, the orm collects the indices of both under that class and creates
        // each of them twice, which the second time fails on the name
        return [...new Set(this.entities)];
    }

    /**
     * Transforms the property on the given entity class to typeorm column options.
     * @param entity - The entity class which property should be transformed.
     * @param property - The key of the actual property that should be transformed.
     * @returns TypeOrm column options.
     * @throws When no data source has been provided or no column metadata could be found.
     */
    protected propertyToTableColumnOptions<T extends BaseEntity>(entity: Newable<T>, property: keyof T | string & {}): TableColumnOptions {
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
                m.type === RelationType.MANY_TO_ONE
                || m.type === RelationType.ONE_TO_MANY
                || m.type === RelationType.HAS_ONE
                || m.type === RelationType.BELONGS_TO_ONE
                || m.type === RelationType.MANY_TO_MANY
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
            // named explicitly rather than left to typeorm's generated hash, because keeping the
            // uniques an entity declares tells them apart by name, and an upsert names one as its
            // conflict target. The property's own and the entity's alike: a
            // property's used to reach the column as typeorm's own unique, under a name nothing else
            // could arrive at, so an upsert identified by it named a constraint that did not exist.
            // Only the groups covering every row: a constraint cannot be given a predicate, so the
            // ones that leave rows out are created as indices below
            uniques: groups.uniques
                .filter(g => coversEveryRow(g.where))
                .map(g => ({ name: uniqueConstraintName(entityMetadata.tableName, g.properties), columns: g.properties })),
            indices: [
                ...groups.indexes.map(c => ({ name: indexName(entityMetadata.tableName, c), columns: c })),
                // a unique that covers only some rows is one of these rather than a constraint, named
                // with the rows it covers: one whose condition changes is then another index, which
                // keeping the declared ones replaces rather than leaving the old condition in force
                ...groups.uniques.flatMap(g => {
                    if (g.where == undefined || coversEveryRow(g.where)) {
                        return [];
                    }
                    const where: string = keyWhereToSql(cls, g.where);
                    const name: string = uniqueConstraintName(entityMetadata.tableName, g.properties, where);
                    return [{ name, columns: g.properties, unique: true, where }];
                }),
                ...this.indicesOwnedBySelf(cls, entityMetadata.tableName)
            ],
            // `IS TRUE`, because a check passes a row its condition is NULL for - a comparison of a
            // column holding none - where the filter it was declared as does not match that row
            checks: (entityMetadata.checks ?? []).map(check => {
                const predicate: string = keyWhereToSql(cls, check);
                return { name: checkConstraintName(entityMetadata.tableName, predicate), expression: `(${predicate}) IS TRUE` };
            })
        });
    }

    /**
     * Finds the check of an entity a failed write broke.
     * @param error - What the store answered the write with.
     * @param entityClass - The entity written.
     * @returns The check, or undefined when the write broke none of them.
     */
    findViolatedCheck(error: TOQueryFailedError, entityClass: Newable<BaseEntity>): KeyWhere | undefined {
        const name: string | undefined = this.violatedCheckName(error);
        if (name == undefined) {
            return undefined;
        }
        const entityMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
        return entityMetadata?.checks?.find(
            check => checkConstraintName(entityMetadata.tableName, keyWhereToSql(entityClass, check)) === name
        );
    }

    /**
     * Reads the name of the check constraint a failed statement broke.
     * @param error - What the store answered the statement with.
     * @returns The name, or undefined when the statement broke no check.
     */
    protected abstract violatedCheckName(error: TOQueryFailedError): string | undefined;

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
    // eslint-disable-next-line no-unused-vars
    protected validateEntityClassMetadata(metadata: EntityMetadata, props: Record<string, PropertyMetadata>): void {
        // do nothing by default.
    }

    /**
     * Validates the data source options.
     * @param options - The full options to validate.
     */
    // eslint-disable-next-line no-unused-vars
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
            // built the way createEntity builds a table, so the unique on the name is created with it -
            // columns alone leave out every constraint the entity declares
            await runner.createTable(Table.create(metadata, this.ds.driver), true);
        }
        finally {
            await runner.release();
        }
    }
}