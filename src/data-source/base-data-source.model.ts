import { Transaction, DataSource as TODataSource, DataSourceOptions as TODataSourceOptions, Repository as TORepository, EntitySchema, EntitySchemaColumnOptions, ColumnType } from 'typeorm';

import { repositoryTokenFor } from '../di';
import { EntityMetadata, PropertyMetadata } from '../entity';
import { Newable, OmitStrict } from '../types';
import { MetadataUtilities } from '../utilities';
import { BaseEntity, Repository } from './repository.model';
import { register } from '../di/register.function';

export type DataSourceOptions = TODataSourceOptions;

export abstract class BaseDataSource {
    protected readonly columnTypeMappingOverride: Partial<Record<PropertyMetadata['type'], ColumnType>> = {};

    private get columnTypeMapping(): Record<PropertyMetadata['type'], ColumnType> {
        return {
            array: 'array',
            number: Number,
            string: String,
            object: 'jsonb',
            date: 'date',
            ...this.columnTypeMappingOverride
        };
    }

    abstract readonly options: OmitStrict<DataSourceOptions, 'entities'>;
    abstract readonly entities: Newable<BaseEntity>[];

    protected ds?: TODataSource;

    async init(): Promise<void> {
        if (this.ds) {
            throw new Error(`The ${this.options.type} datasource has already been initialized.`);
        }
        const schemas: EntitySchema[] = this.getEntitySchemas();
        this.ds = new TODataSource({ ...this.options, entities: schemas } as DataSourceOptions);
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
            const columns: Record<string, EntitySchemaColumnOptions> = {};

            for (const [key, m] of Object.entries(props)) {
                columns[key] = this.propertyToColumnOptions(m);
            }

            return new EntitySchema({
                name: cls.name,
                target: cls,
                tableName: entityMetadata.tableName,
                columns
            });
        });

        return schemas;
    }

    protected propertyToColumnOptions(metadata: PropertyMetadata): EntitySchemaColumnOptions {
        switch (metadata.type) {
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
                    type: metadata.primary ? 'uuid' : this.columnTypeMapping[metadata.type]
                };
            }
        }
    }

    getRepository<T extends BaseEntity>(cls: Newable<T>): Repository<T> {
        if (!this.ds) {
            throw new Error(`The ${this.options.type} datasource needs to be initialized before it can be used.`);
        }
        if (!this.entities.find(e => e === cls)) {
            throw new Error(`The entity "${cls.name}" is not in this database. Did you forget to include it in the entities array?`);
        }
        const repo: TORepository<T> = this.ds.getRepository(cls);
        return new Repository(cls.name, repo);
    }

    // TODO
    startTransaction(): Transaction {
        if (!this.ds) {
            throw new Error(`The ${this.options.type} datasource needs to be initialized before it can be used.`);
        }
        return new Transaction();
    }
}