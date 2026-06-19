import { Readable } from 'node:stream';

import { EntitySchema, EntitySchemaColumnOptions, EntitySchemaRelationOptions, QueryRunner, Table, TableColumn, TableColumnOptions, DataSource as TODataSource, EntityMetadata as TOEntityMetadata, Repository as TORepository, FindOptionsWhere as ToFindOptionsWhere } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';

import { DataSourceInitializationError } from './data-source-initialization.error';
import { DataSourceInterface, IsolationLevel, RepositoryTypeForEntity } from './data-source.interface';
import { TypeOrmWhereFilterConverter } from './where-converter/typeorm-where-filter.converter';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { ChangeSetRepository } from '../../change-sets/change-set-repository';
import { ChangeSetEntity, isChangeSetEntityNewable } from '../../change-sets/models/change-set-entity.model';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { isSoftDeleteEntityNewable, SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../change-sets/soft-delete-repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { register } from '../../di/register.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { PropertyMetadata, PropertyMetadataInput, RelationMetadata } from '../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../entity/entity-metadata-missing.error';
import { FilePropertyMetadata } from '../../entity/models/file-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { type LoggerInterface } from '../../logging/logger.interface';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { SemVerUtilities, SemVerVersion } from '../../utilities/sem-ver.utilities';
import { TypeOrmUtilities } from '../../utilities/typeorm.utilities';
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../hooks/hooks.default';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Migration } from '../migration/migration.model';
import { ColumnType } from '../models/column-type.model';
import { DataSourceOptions } from '../models/data-source-options.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { Repository } from '../repository';
import { Transaction } from '../transaction/transaction.model';
import { TypeOrmTransaction } from '../transaction/typeorm-transaction.model';

// eslint-disable-next-line jsdoc/require-jsdoc
export type MigrationWithName = { migration: Migration, name: string };

// eslint-disable-next-line jsdoc/require-jsdoc
export type ToColumnMappableTypes = ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>['type'];

/**
 * Base data source implementation of zibri.
 * Uses typeorm under the hood.
 */
export abstract class TypeOrmBaseDataSource<TOptions extends DataSourceOptions> implements DataSourceInterface {
    abstract readonly entities: Newable<BaseEntity>[];

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
    protected abstract readonly defaultOptions: OmitStrict<TOptions, 'type' | 'entities' | 'synchronize'>;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Combination of the default and user provided options.
     */
    protected get fullOptions(): OmitStrict<TOptions, 'type' | 'entities' | 'synchronize'> {
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

    abstract createBackupData(): Readable;
    abstract restoreBackup(backupData: Readable): void | Promise<void>;

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

        for (const entityClass of this.entities) {
            register({
                token: repositoryTokenFor(entityClass),
                useFactory: () => this.getRepository(entityClass)
            });
        }

        const schemas: EntitySchema[] = this.getEntitySchemas();
        this.ds = new TODataSource({
            ...this.fullOptions,
            entities: schemas,
            type: this.type,
            synchronize: false
        } as DataSourceOptions);
        await this.ds.initialize();

        this.beforeMigrations();

        await this.runMigrations();

        // Only skip if synchronize has been explicitly set to false
        if (this.options.synchronize === false) {
            return;
        }

        await this.ds.synchronize();
    }

    protected abstract beforeMigrations(): void;

    // eslint-disable-next-line jsdoc/require-jsdoc
    async shutDown(): Promise<void> {
        await this.ds?.destroy();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }

        const runner: QueryRunner = this.createQueryRunner();
        try {
            await runner.connect();
            await runner.startTransaction(isolationLevel);
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

        // we need to dynamically inject here because the repositories aren't ready in the constructor.
        const migrationsRepository: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity));
        const finishedMigrationVersions: string[] = (await migrationsRepository.findAll()).map(m => m.version);
        const allMigrations: MigrationWithName[] = this.migrations.map(m => ({ migration: inject(m), name: m.name }));

        const appVersion: SemVerVersion | undefined = GlobalRegistry.getAppData('version');
        if (!appVersion) {
            throw new InternalError('Couldn\'t run migrations: No app version could be resolved');
        }

        const migrationsToRunUp: MigrationWithName[] = allMigrations.filter(m => {
            return !finishedMigrationVersions.includes(m.migration.version)
                && SemVerUtilities.compare(m.migration.version, appVersion) !== 'bigger';
        });

        const migrationsToRunDown: MigrationWithName[] = allMigrations.filter(m => {
            return finishedMigrationVersions.includes(m.migration.version)
                && SemVerUtilities.compare(m.migration.version, appVersion) === 'bigger';
        });

        for (const migration of migrationsToRunUp) {
            await this.logger.info(`    > runs up migration ${migration.name}`);
            await migration.migration.runUp();
        }

        for (const migration of migrationsToRunDown) {
            await this.logger.info(`    > runs down migration ${migration.name}`);
            await migration.migration.runDown();
        }

        const skipped: number = allMigrations.length - migrationsToRunDown.length - migrationsToRunUp.length;
        if (skipped) {
            await this.logger.info(`    > skipped ${skipped} migrations that have already been applied`);
        }
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

        const repo: TORepository<T> = this.ds.getRepository(cls);

        if (isSoftDeleteEntityNewable(cls)) {
            const res: RepositoryTypeForEntity<T> = new SoftDeleteRepository(
                cls,
                repo as unknown as TORepository<SoftDeleteEntity>,
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
                repo as unknown as TORepository<ChangeSetEntity>,
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
            repo,
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
        await transaction.queryRunner.addColumn(
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
            name?: keyof T,
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
                    type: this.fullColumnTypeMapping[newColumn.type]
                }
            )
        };

        await transaction.queryRunner.changeColumn(entityMetadata.tableName, String(oldColumn), new TableColumn(col));
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

        return new EntitySchema({
            name: cls.name,
            target: cls,
            tableName: entityMetadata.tableName,
            columns,
            relations
        });
    }

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
    protected validateOptions(options: OmitStrict<TOptions, 'type' | 'entities' | 'synchronize'>): void | Promise<void> {
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