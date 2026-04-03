import { ChildProcessByStdio, spawn } from 'node:child_process';
import { PassThrough, Readable, Writable } from 'node:stream';

import { DataSource as TODataSource, Repository as TORepository, EntityMetadata as TOEntityMetadata, EntitySchema, EntitySchemaColumnOptions, QueryRunner, EntitySchemaRelationOptions, Table, TableColumnOptions, TableColumn, EntityTarget } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel.js';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';
import { OnDeleteType } from 'typeorm/metadata/types/OnDeleteType.js';
import { OnUpdateType } from 'typeorm/metadata/types/OnUpdateType.js';

import { DataSourceInterface } from './data-source.interface';
import { ChangeSetRepository } from '../../change-sets/change-set-repository';
import { isChangeSetEntityNewable, ChangeSetEntity } from '../../change-sets/models/change-set-entity.model';
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
import { FilePropertyMetadata } from '../../entity/models/file-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { StringPropertyMetadata } from '../../entity/models/string-property-metadata.model';
import { GlobalRegistry } from '../../global/global-registry';
import { type LoggerInterface } from '../../logging/logger.interface';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { Version } from '../../types/version.type';
import { compareVersion } from '../../utilities/compare-versions.function';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Migration } from '../migration/migration.model';
import { ColumnType } from '../models/column-type.model';
import { DataSourceOptions } from '../models/data-source-options.model';
import { Repository } from '../repository';
import { Transaction } from '../transaction/transaction.model';
import { TypeOrmTransaction } from '../transaction/typeorm-transaction.model';

// eslint-disable-next-line jsdoc/require-jsdoc
type ToColumnMappableTypes = ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>['type'];

// eslint-disable-next-line jsdoc/require-jsdoc
type MigrationWithName = { migration: Migration, name: string };

/**
 * Postgres-specific connection options.
 */
export type PostgresOptions = OmitStrict<PostgresConnectionOptions, 'entities' | 'type'>;

/**
 * A base postgres data source definition.
 */
export abstract class PostgresDataSource implements DataSourceInterface {
    /**
     * Mapping from a Zibri property type to a typeorm column type.
     */
    protected readonly columnTypeMappingOverride: Partial<Record<ToColumnMappableTypes, ColumnType>> = {};

    private get columnTypeMapping(): Record<ToColumnMappableTypes, ColumnType> {
        return {
            array: 'array',
            number: 'decimal',
            string: 'varchar',
            object: 'jsonb',
            date: 'timestamptz',
            boolean: 'boolean',
            unknown: 'jsonb',
            file: 'bytea',
            ...this.columnTypeMappingOverride
        };
    }

    abstract readonly options: PostgresOptions;
    abstract readonly entities: Newable<BaseEntity>[];
    /**
     * The optional root password.
     */
    readonly rootPw: string | undefined;
    /**
     * The optional root username.
     */
    readonly rootUsername: string | undefined;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly migrations: Newable<Migration>[] = [];

    /**
     * The internal typeorm data source.
     */
    protected ds?: TODataSource;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) { }

    // eslint-disable-next-line jsdoc/require-jsdoc
    createBackupData(): Readable {
        const dumpCommand: string = 'pg_dumpall';
        const { host, port } = this.options;
        if (!this.rootUsername || !host || !port) {
            throw new Error('Could not create a backup, missing this.rootUsername, this.options.host or this.options.port');
        }
        const args: string[] = ['-U', this.rootUsername, '-h', host, '-p', port.toString()];

        const child: ChildProcessByStdio<null, Readable, null> = spawn(dumpCommand, args, {
            stdio: ['ignore', 'pipe', 'inherit'],
            env: { ...process.env, PGPASSWORD: this.rootPw }
        });

        const out: PassThrough = new PassThrough();
        child.stdout.pipe(out);
        child.on('error', err => {
            out.destroy(err);
        });
        child.on('exit', code => {
            if (code !== 0) {
                out.destroy(new Error(`${dumpCommand} exited with code ${code}`));
            }
            else {
                out.end();
            }
        });

        return out;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async restoreBackup(backupData: Readable): Promise<void> {
        const { host, port, database } = this.options;
        if (!this.rootUsername || !host || !port || !database) {
            throw new Error('Missing rootUsername, host, port, or database for restore');
        }

        const args: string[] = ['-U', this.rootUsername, '-h', host, '-p', port.toString(), '-d', database];
        const child: ChildProcessByStdio<Writable, null, null> = spawn('psql', args, {
            stdio: ['pipe', 'inherit', 'inherit'],
            env: { ...process.env, PGPASSWORD: this.rootPw }
        });

        return new Promise((resolve, reject) => {
            backupData.pipe(child.stdin);

            child.on('error', reject);
            child.on('close', code => {
                if (code !== 0) {
                    reject(new Error(`psql exited with code ${code}`));
                }
                else {
                    resolve();
                }
            });
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async init(): Promise<void> {
        if (this.ds) {
            throw new Error('The postgres data source has already been initialized.');
        }

        if (this.options.username === 'postgres' && this.options.password === 'password') {
            await this.logger.warn(
                `The data source "${this.constructor.name}" uses the default credentials, you probably want to change that.`
            );
        }

        for (const entityClass of this.entities) {
            register({
                token: repositoryTokenFor(entityClass),
                useFactory: () => this.getRepository(entityClass)
            });
        }

        const schemas: EntitySchema[] = this.getEntitySchemas();
        this.ds = new TODataSource({
            entities: schemas,
            poolSize: 100,
            type: 'postgres',
            ...this.options,
            synchronize: false
        } as DataSourceOptions);
        await this.ds.initialize();

        await this.runMigrations();

        if (this.options.synchronize !== false) {
            await this.ds.synchronize();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async shutDown(): Promise<void> {
        await this.ds?.destroy();
    }

    /**
     * Gets entity schemas for the entities of this data source.
     * @returns Typeorm entity schemas.
     */
    protected getEntitySchemas(): EntitySchema[] {
        const schemas: EntitySchema[] = this.entities.map(e => this.createSchemaForEntity(e));
        return schemas;
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
            throw new Error(`Could not find metadata for entity "${cls.name}". Did you forget to decorate it with @Entity?`);
        }
        const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);

        const numberOfPrimaryKeys: number = ObjectUtilities.values(props).filter(d => (d as StringPropertyMetadata).primary).length;
        if (numberOfPrimaryKeys === 0) {
            throw new Error(`no primary key specified for entity "${cls.name}".`);
        }
        if (numberOfPrimaryKeys > 1) {
            throw new Error(`more than 1 primary key specified for entity "${cls.name}".`);
        }

        const columns: Record<string, EntitySchemaColumnOptions> = {};
        const relations: Record<string, EntitySchemaRelationOptions> = {};
        for (const [key, m] of ObjectUtilities.entries(props)) {
            if (
                m.type === Relation.MANY_TO_ONE
                || m.type === Relation.ONE_TO_MANY
                || m.type === Relation.ONE_TO_ONE
                || m.type === Relation.MANY_TO_MANY
            ) {
                relations[key] = this.propertyToRelationOptions(m);
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
     * @param metadata - The relation metadata to transform.
     * @returns Typeorm relation options.
     */
    protected propertyToRelationOptions<T extends BaseEntity>(metadata: RelationMetadata<T>): EntitySchemaRelationOptions {
        const thisHasRemove: boolean = this.hasCascadeFlag(metadata.cascade, 'remove');
        const thisHasUpdate: boolean = this.hasCascadeFlag(metadata.cascade, 'update');
        const thisHasInsert: boolean = this.hasCascadeFlag(metadata.cascade, 'insert');

        // try to inspect inverse property's cascade (if inverseSide provided)
        const targetClass: Newable<T> = metadata.target();
        const targetProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
        const inv: RelationMetadata<BaseEntity> = targetProps[metadata.inverseSide] as RelationMetadata<BaseEntity>;
        const inverseHasRemove: boolean = this.hasCascadeFlag(inv.cascade, 'remove');
        const inverseHasUpdate: boolean = this.hasCascadeFlag(inv.cascade, 'update');
        const inverseHasInsert: boolean = this.hasCascadeFlag(inv.cascade, 'insert');

        const onDelete: OnDeleteType | undefined = thisHasRemove || inverseHasRemove ? 'CASCADE' : undefined;
        const onUpdate: OnUpdateType | undefined = thisHasUpdate || inverseHasUpdate ? 'CASCADE' : undefined;
        const persistence: boolean = 'persistence' in metadata ? metadata.persistence : thisHasInsert || inverseHasInsert;
        const nullable: boolean = typeof metadata.required === 'boolean' ? !metadata.required : true;

        switch (metadata.type) {
            case Relation.ONE_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_MANY: {
                return {
                    nullable,
                    ...metadata,
                    inverseSide: metadata.inverseSide as string,
                    onDelete,
                    onUpdate,
                    persistence
                };
            }
            case Relation.MANY_TO_ONE: {
                return {
                    nullable,
                    joinColumn: true,
                    ...metadata,
                    inverseSide: metadata.inverseSide as string,
                    onDelete,
                    onUpdate,
                    persistence
                };
            }
        }
    }

    private hasCascadeFlag(c: RelationMetadata<BaseEntity>['cascade'], flag: 'remove' | 'update' | 'insert'): boolean {
        if (c === true) {
            return true;
        }
        if (Array.isArray(c)) {
            return c.includes(flag);
        }
        return false;
    }

    /**
     * Transforms the given property metadata to typeorm column options.
     * @param metadata - The property metadata to transform.
     * @returns Typeorm column options.
     * @throws When the metadata is incorrect.
     */
    protected propertyToColumnOptions(
        metadata: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>
    ): EntitySchemaColumnOptions {
        const nullable: boolean = typeof metadata.required === 'boolean' ? !metadata.required : true;
        switch (metadata.type) {
            case 'file':
            case 'boolean':
            case 'object':
            case 'unknown':
            case 'date': {
                return {
                    nullable,
                    ...metadata,
                    type: this.columnTypeMapping[metadata.type],
                    default: undefined
                };
            }
            case 'array': {
                if (metadata.items.type === 'object') {
                    return {
                        nullable,
                        ...metadata,
                        type: this.columnTypeMapping[metadata.items.type],
                        default: undefined
                    };
                }
                return {
                    nullable,
                    ...metadata,
                    type: this.columnTypeMapping[metadata.items.type],
                    array: true,
                    default: undefined
                };
            }
            case 'number': {
                return {
                    nullable,
                    generated: metadata.primary ? 'increment' : undefined,
                    ...metadata,
                    type: this.columnTypeMapping[metadata.type],
                    default: undefined,
                    transformer: {
                        // eslint-disable-next-line unicorn/no-null
                        to: (v: number | null) => v != null ? String(v) : null,
                        // eslint-disable-next-line unicorn/no-null
                        from: (v: string | null) => v != null ? Number(v) : undefined
                    }
                };
            }
            case 'string': {
                return {
                    nullable,
                    generated: metadata.primary ? 'uuid' : undefined,
                    ...metadata,
                    type: metadata.format === 'uuid' || metadata.primary ? 'uuid' : this.columnTypeMapping[metadata.type],
                    length: metadata.maxLength,
                    enum: metadata.enum ? ObjectUtilities.values(metadata.enum) : undefined,
                    default: undefined
                };
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getRepository<T extends BaseEntity>(cls: Newable<T>): Repository<T> {
        if (!this.ds) {
            // eslint-disable-next-line sonar/no-duplicate-string
            throw new Error('The postgres data source needs to be initialized before it can be used.');
        }
        if (!this.entities.find(e => e === cls)) {
            throw new Error(`The entity "${cls.name}" is not in this database. Did you forget to include it in the entities array?`);
        }
        const repo: TORepository<T> = this.ds.getRepository(cls);

        if (isSoftDeleteEntityNewable(cls)) {
            return new SoftDeleteRepository(
                cls,
                repo as unknown as TORepository<SoftDeleteEntity>,
                this.logger
            ) as unknown as Repository<T>;
        }
        if (isChangeSetEntityNewable(cls)) {
            return new ChangeSetRepository(
                cls,
                repo as unknown as TORepository<ChangeSetEntity>,
                this.logger
            ) as unknown as Repository<T>;
        }
        return new Repository(cls, repo, this.logger);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
        if (!this.ds) {
            throw new Error('The postgres data source needs to be initialized before it can be used.');
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

    /**
     * Creates a query runner.
     * @returns A query runner.
     * @throws When the data source has not been initialized yet.
     */
    createQueryRunner(): QueryRunner {
        if (!this.ds) {
            throw new Error('The postgres data source needs to be initialized before it can be used.');
        }
        return this.ds.createQueryRunner();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runMigrations(): Promise<void> {
        await this.createMigrationTableIfNotExists();

        // we need to dynamically inject here because the repositories aren't ready in the constructor.
        const migrationsRepository: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity));
        const finishedMigrationVersions: string[] = (await migrationsRepository.findAll()).map(m => m.version);
        const allMigrations: MigrationWithName[] = this.migrations.map(m => ({ migration: inject(m), name: m.name }));

        const migrationsToRunUp: MigrationWithName[] = allMigrations.filter(m => {
            return !finishedMigrationVersions.includes(m.migration.version)
                && compareVersion(m.migration.version, GlobalRegistry.getAppData('version') as Version) !== 'bigger';
        });

        const migrationsToRunDown: MigrationWithName[] = allMigrations.filter(m => {
            return finishedMigrationVersions.includes(m.migration.version)
                && compareVersion(m.migration.version, GlobalRegistry.getAppData('version') as Version) === 'bigger';
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async addPropertyToEntity<T extends BaseEntity>(
        entity: Newable<T>,
        key: keyof T,
        transaction: Transaction
    ): Promise<void> {
        const col: TableColumnOptions = this.propertyToTableColumnOptions(entity, key);
        await transaction.queryRunner.addColumn(
            this.getEntityMetadata(entity, transaction).tableName,
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
        const entityMetadata: TOEntityMetadata = this.getEntityMetadata(entity, transaction);
        const columnMetadata: ColumnMetadata = this.getColumnMetadata(entity, oldColumn, transaction);

        const col: TableColumnOptions = {
            ...columnMetadata,
            ...newColumn,
            enum: 'enum' in newColumn && newColumn.enum
                ? ObjectUtilities.values(newColumn.enum).map(v => String(v))
                : columnMetadata.enum
                    ? columnMetadata.enum.map(v => String(v))
                    : undefined,
            name: String(newColumn.name ?? oldColumn),
            type: this.normalizeColumnType({
                precision: undefined,
                scale: undefined,
                ...columnMetadata,
                ...newColumn,
                type: this.columnTypeMapping[newColumn.type]
            })
        };

        await transaction.queryRunner.changeColumn(entityMetadata.tableName, String(oldColumn), new TableColumn(col));
    }

    /**
     * Gets the typeorm metadata for a given entity.
     * @param target - The target entity.
     * @param transaction - The transaction to run this command with.
     * @returns The typeorm metadata.
     */
    protected getEntityMetadata<T extends BaseEntity>(target: EntityTarget<T>, transaction: Transaction): TOEntityMetadata {
        return transaction.queryRunner.connection.getMetadata(target);
    }

    /**
     * Gets the metadata for a typeorm column.
     * @param target - The entity.
     * @param propertyName - The name of the property to get the column metadata for.
     * @param transaction - The transaction to use to get the column metadata.
     * @returns The typeorm column metadata.
     * @throws When the provided propertyName could not be found as a column.
     */
    protected getColumnMetadata<T extends BaseEntity>(
        target: EntityTarget<T>,
        propertyName: keyof T | string & {},
        transaction: Transaction
    ): ColumnMetadata {
        const metadata: TOEntityMetadata = this.getEntityMetadata(target, transaction);
        const column: ColumnMetadata | undefined = metadata.columns.find(
            (col) => col.propertyName === propertyName
        );

        if (!column) {
            throw new Error(
                `Column ${propertyName.toString()} not found in model`
            );
        }

        return column;
    }

    /**
     * Creates a table for migrations if it does not exist already.
     */
    protected async createMigrationTableIfNotExists(): Promise<void> {
        if (!this.ds) {
            throw new Error('The postgres data source needs to be initialized before it can be used.');
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
                    // eslint-disable-next-line typescript/no-non-null-assertion
                    type: this.ds!.driver.normalizeType(col)
                }))
            });
            await runner.createTable(table, true);

        }
        finally {
            await runner.release();
        }
    }

    /**
     * Transforms the property on the given entity class to typeorm column options.
     * @param entity - The entity class which property should be transformed.
     * @param property - The key of the actual property that should be transformed.
     * @returns Typeorm column options.
     * @throws When no data source has been provided or no column metadata could be found.
     */
    protected propertyToTableColumnOptions<T extends BaseEntity>(entity: Newable<T>, property: keyof T): TableColumnOptions {
        if (!this.ds) {
            throw new Error('The postgres data source needs to be initialized before it can be used.');
        }
        const schema: EntitySchema = this.createSchemaForEntity(entity);
        const metadata: TOEntityMetadata = this.ds.getMetadata(schema);
        const col: ColumnMetadata | undefined = metadata.columns.find(c => c.propertyName === property);

        if (!col) {
            throw new Error(`Could not determine column metadata for ${entity.name}.${String(property)}`);
        }

        return {
            name: col.databaseName,
            ...col,
            enum: col.enum ? col.enum?.map(v => String(v)) : undefined,
            type: this.normalizeColumnType({
                isArray: col.isArray,
                length: col.length,
                precision: col.precision,
                scale: col.scale,
                type: col.type
            })
        };
    }

    private normalizeColumnType(
        column: {
            // eslint-disable-next-line jsdoc/require-jsdoc
            type: ColumnType | string & {} | undefined,
            // eslint-disable-next-line jsdoc/require-jsdoc
            length: number | string | undefined,
            // eslint-disable-next-line jsdoc/require-jsdoc
            precision: number | null | undefined,
            // eslint-disable-next-line jsdoc/require-jsdoc
            scale: number | undefined,
            // eslint-disable-next-line jsdoc/require-jsdoc
            isArray: boolean | undefined
        }
    ): string {
        if (!this.ds) {
            throw new Error('The postgres data source needs to be initialized before it can be used.');
        }
        return this.ds.driver.normalizeType(column);
    }
}