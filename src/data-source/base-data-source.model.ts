import { DataSource as TODataSource, Repository as TORepository, EntitySchema, EntitySchemaColumnOptions, QueryRunner, EntitySchemaRelationOptions } from 'typeorm';
import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';

import { repositoryTokenFor } from '../di';
import { BaseEntity, EntityMetadata, PropertyMetadata, Relation, RelationMetadata, StringPropertyMetadata } from '../entity';
import { Newable, OmitStrict } from '../types';
import { MetadataUtilities } from '../utilities';
import { ColumnType, DataSourceOptions } from './models';
import { Repository } from './repository.model';
import { Transaction } from './transaction';
import { register } from '../di/register.function';
import { TypeOrmTransaction } from './transaction/typeorm-transaction.model';

export abstract class BaseDataSource {
    protected readonly columnTypeMappingOverride: Partial<Record<PropertyMetadata['type'], ColumnType>> = {};

    private get columnTypeMapping(): Record<Exclude<PropertyMetadata, RelationMetadata<BaseEntity>>['type'], ColumnType> {
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

    protected ds?: TODataSource;

    async init(): Promise<void> {
        if (this.ds) {
            throw new Error(`The ${this.options.type} data source has already been initialized.`);
        }
        const schemas: EntitySchema[] = this.getEntitySchemas();
        this.ds = new TODataSource({ ...this.options, entities: schemas, poolSize: 100 } as DataSourceOptions);
        for (const entityClass of this.entities) {
            register({
                token: repositoryTokenFor(entityClass),
                useFactory: () => this.getRepository(entityClass)
            });
        }
        await this.ds.initialize();
    }

    protected getEntitySchemas(): EntitySchema[] {
        const schemas: EntitySchema[] = this.entities.map(cls => {
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
                columns[key] = this.propertyToColumnOptions(m);
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
        });

        return schemas;
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

    protected propertyToColumnOptions(metadata: Exclude<PropertyMetadata, RelationMetadata<BaseEntity>>): EntitySchemaColumnOptions {
        switch (metadata.type) {
            case 'boolean':
            case 'object':
            case 'date':
            case 'array': {
                return {
                    nullable: !metadata.required,
                    ...metadata,
                    type: this.columnTypeMapping[metadata.type]
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
                    type: metadata.format === 'uuid' || metadata.primary ? 'uuid' : this.columnTypeMapping[metadata.type]
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

    // TODO
    async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
        if (!this.ds) {
            throw new Error(`The ${this.options.type} data source needs to be initialized before it can be used.`);
        }
        const runner: QueryRunner = this.ds.createQueryRunner();
        await runner.connect();
        await runner.startTransaction(isolationLevel);
        return new TypeOrmTransaction(runner);
    }
}