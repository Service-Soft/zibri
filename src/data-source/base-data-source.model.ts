import { DataSource as TODataSource, Repository as TORepository, EntityMetadata as TOEntityMetadata, EntitySchema, EntitySchemaColumnOptions, QueryRunner, EntitySchemaRelationOptions, Table, TableColumnOptions } from 'typeorm';
import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';

import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../di';
import { BaseEntity, EntityMetadata, FilePropertyMetadata, PropertyMetadata, Relation, RelationMetadata, StringPropertyMetadata } from '../entity';
import { ExcludeStrict, Newable, OmitStrict, Version } from '../types';
import { compareVersion, MetadataUtilities } from '../utilities';
import { Migration, MigrationEntity } from './migration';
import { ColumnType, DataSourceOptions } from './models';
import { Repository } from './repository.model';
import { Transaction } from './transaction';
import { register } from '../di/register.function';
import { GlobalRegistry } from '../global';
import { LoggerInterface } from '../logging';
import { TypeOrmTransaction } from './transaction/typeorm-transaction.model';

type ToColumnMappableTypes = ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity> | FilePropertyMetadata>['type'];

export abstract class BaseDataSource {
    protected readonly columnTypeMappingOverride: Partial<Record<ToColumnMappableTypes, ColumnType>> = {};

    private get columnTypeMapping(): Record<ToColumnMappableTypes, ColumnType> {
        return {
            array: 'array',
            number: Number,
            string: String,
            object: 'jsonb',
            date: 'timestamptz',
            boolean: 'boolean',
            ...this.columnTypeMappingOverride
        };
    }

    abstract readonly options: OmitStrict<DataSourceOptions, 'entities'>;
    abstract readonly entities: Newable<BaseEntity>[];
    readonly migrations: Newable<Migration>[] = [];

    protected ds?: TODataSource;
    protected readonly logger: LoggerInterface;

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    async init(): Promise<void> {
        if (this.ds) {
            throw new Error(`The ${this.options.type} data source has already been initialized.`);
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
            ...this.options,
            synchronize: false
        } as DataSourceOptions);
        await this.ds.initialize();

        await this.runMigrations();

        if (this.options.synchronize !== false) {
            await this.ds.synchronize();
        }
    }

    protected getEntitySchemas(): EntitySchema[] {
        const schemas: EntitySchema[] = this.entities.map(e => this.createSchemaForEntity(e));
        return schemas;
    }

    protected createSchemaForEntity(cls: Newable<BaseEntity>): EntitySchema {
        const entityMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(cls);
        if (!entityMetadata) {
            throw new Error(`Could not find metadata for entity "${cls.name}". Did you forget to decorate it with @Entity?`);
        }
        const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);

        const numberOfPrimaryKeys: number = Object.values(props).filter(d => (d as StringPropertyMetadata).primary).length;
        if (numberOfPrimaryKeys === 0) {
            throw new Error(`no primary key specified for entity "${cls.name}".`);
        }
        if (numberOfPrimaryKeys > 1) {
            throw new Error(`more than 1 primary key specified for entity "${cls.name}".`);
        }

        const columns: Record<string, EntitySchemaColumnOptions> = {};
        for (const [key, m] of Object.entries(props)) {
            if (
                m.type === Relation.MANY_TO_ONE
                || m.type === Relation.ONE_TO_MANY
                || m.type === Relation.ONE_TO_ONE
                || m.type === Relation.MANY_TO_MANY
            ) {
                continue;
            }
            if (m.type === 'file') {
                throw new Error(`the property "${cls.name}.${key}" of type file cannot be mapped to a database column.`);
            }
            columns[key] = this.propertyToColumnOptions(m, cls, key);
        }

        const relations: Record<string, EntitySchemaRelationOptions> = {};
        for (const [key, m] of Object.entries(props)) {
            if (m.type !== 'many-to-one') {
                continue;
            }
            relations[key] = this.propertyToRelationOptions(m);
        }

        return new EntitySchema({
            name: cls.name,
            target: cls,
            tableName: entityMetadata.tableName,
            columns,
            relations
        });
    }

    protected propertyToRelationOptions<T extends BaseEntity>(metadata: RelationMetadata<T>): EntitySchemaRelationOptions {
        switch (metadata.type) {
            case Relation.MANY_TO_MANY:
            case Relation.ONE_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE: {
                return {
                    nullable: !metadata.required,
                    joinColumn: true,
                    ...metadata,
                    inverseSide: metadata.inverseSide as string | undefined
                };
            }
        }
    }

    protected propertyToColumnOptions(
        metadata: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity> | FilePropertyMetadata>,
        cls: Newable<BaseEntity>,
        key: string
    ): EntitySchemaColumnOptions {
        switch (metadata.type) {
            case 'boolean':
            case 'object':
            case 'date': {
                return {
                    nullable: !metadata.required,
                    ...metadata,
                    type: this.columnTypeMapping[metadata.type]
                };
            }
            case 'array': {
                if (metadata.items.type === 'file') {
                    throw new Error(`the property "${cls.name}.${key}" of type file array cannot be mapped to a database column.`);
                }
                return {
                    nullable: !metadata.required,
                    ...metadata,
                    type: this.columnTypeMapping[metadata.items.type],
                    array: true
                };
            }
            case 'number': {
                return {
                    nullable: !metadata.required,
                    generated: metadata.primary ? 'increment' : undefined,
                    ...metadata,
                    type: this.columnTypeMapping[metadata.type]
                };
            }
            case 'string': {
                return {
                    nullable: !metadata.required,
                    generated: metadata.primary ? 'uuid' : undefined,
                    ...metadata,
                    type: metadata.format === 'uuid' || metadata.primary ? 'uuid' : this.columnTypeMapping[metadata.type],
                    length: metadata.maxLength
                };
            }
        }
    }

    getRepository<T extends BaseEntity>(cls: Newable<T>): Repository<T> {
        if (!this.ds) {
            throw new Error(`The ${this.options.type} data source needs to be initialized before it can be used.`);
        }
        if (!this.entities.find(e => e === cls)) {
            throw new Error(`The entity "${cls.name}" is not in this database. Did you forget to include it in the entities array?`);
        }
        const repo: TORepository<T> = this.ds.getRepository(cls);
        return new Repository(cls, repo);
    }

    async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
        if (!this.ds) {
            throw new Error(`The ${this.options.type} data source needs to be initialized before it can be used.`);
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

    createQueryRunner(): QueryRunner {
        if (!this.ds) {
            throw new Error(`The ${this.options.type} data source needs to be initialized before it can be used.`);
        }
        return this.ds.createQueryRunner();
    }

    async runMigrations(): Promise<void> {
        await this.createMigrationTableIfNotExists();

        const migrationsRepository: Repository<MigrationEntity> = this.getRepository(MigrationEntity);
        const finishedMigrationVersions: string[] = (await migrationsRepository.findAll()).map(m => m.version);
        const allMigrations: { migration: Migration, name: string }[] = this.migrations.map(m => ({ migration: inject(m), name: m.name }));

        const migrationsToRunUp: { migration: Migration, name: string }[] = allMigrations.filter(m => {
            return !finishedMigrationVersions.includes(m.migration.version)
                && compareVersion(m.migration.version, GlobalRegistry.getAppData('version') as Version) !== 'bigger';
        });

        const migrationsToRunDown: { migration: Migration, name: string }[] = allMigrations.filter(m => {
            return finishedMigrationVersions.includes(m.migration.version)
                && compareVersion(m.migration.version, GlobalRegistry.getAppData('version') as Version) === 'bigger';
        });

        for (const migration of migrationsToRunUp) {
            this.logger.info('    > runs up migration', migration.name);
            await migration.migration.runUp();
        }

        for (const migration of migrationsToRunDown) {
            this.logger.info('    > runs down migration', migration.name);
            await migration.migration.runDown();
        }

        const skipped: number = allMigrations.length - migrationsToRunDown.length - migrationsToRunUp.length;
        if (skipped) {
            this.logger.info('    > skipped', skipped, 'migrations that have already been applied');
        }
    }

    protected async createMigrationTableIfNotExists(): Promise<void> {
        if (!this.ds) {
            throw new Error(`The ${this.options.type} data source needs to be initialized before it can be used.`);
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

    propertyToTableColumnOptions<T extends BaseEntity>(entity: Newable<T>, property: keyof T): TableColumnOptions {
        if (!this.ds) {
            throw new Error(`The ${this.options.type} data source needs to be initialized before it can be used.`);
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

    normalizeColumnType(
        column: {
            type: ColumnType | string & {} | undefined,
            length: number | string | undefined,
            precision: number | null | undefined,
            scale: number | undefined,
            isArray: boolean | undefined
        }
    ): string {
        if (!this.ds) {
            throw new Error(`The ${this.options.type} data source needs to be initialized before it can be used.`);
        }
        return this.ds.driver.normalizeType(column);
    }
}