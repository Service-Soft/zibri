import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntityMetadata as TOEntityMetadata } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';

import { TypeOrmUtilities } from './typeorm.utilities.ts';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface.ts';
import { PostgresDataSource } from '../data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { Transaction } from '../data-source/transaction/transaction.model.ts';
import { inject } from '../di/inject.function.ts';
import { BaseEntity } from '../entity/base-entity.model.ts';
import { Entity } from '../entity/decorators/entity.decorator.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { Newable } from '../types/newable.type.ts';

@Entity({ tenant: 'shared' })
class TypeOrmUtilitiesTestItem extends BaseEntity {
    @Property.string()
    value!: string;
}

let server: StartedTestServer;
let dataSource: DataSourceInterface;

describe('TypeOrmUtilities', () => {
    beforeAll(async () => {
        const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
            entities: [...defaultTestServerEntities, TypeOrmUtilitiesTestItem]
        });
        server = await startTestServer({ dataSources: [dataSourceClass] });
        dataSource = inject(dataSourceClass);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    describe('getEntityMetadata', () => {
        it('resolves the real typeorm metadata for a registered entity', async () => {
            const transaction: Transaction = await dataSource.startTransaction();
            const metadata: TOEntityMetadata = TypeOrmUtilities.getEntityMetadata(TypeOrmUtilitiesTestItem, transaction);

            expect(metadata.columns.map(c => c.propertyName).sort()).toEqual(['id', 'value']);
            await transaction.rollback();
        });
    });

    describe('getColumnMetadata', () => {
        it('resolves the column metadata for a known property', async () => {
            const transaction: Transaction = await dataSource.startTransaction();
            const column: ColumnMetadata = TypeOrmUtilities.getColumnMetadata(TypeOrmUtilitiesTestItem, 'value', transaction);

            expect(column.propertyName).toBe('value');
            await transaction.rollback();
        });

        it('throws when the property does not exist as a column', async () => {
            const transaction: Transaction = await dataSource.startTransaction();

            expect(() => TypeOrmUtilities.getColumnMetadata(TypeOrmUtilitiesTestItem, 'doesNotExist', transaction))
                .toThrow(/doesNotExist not found in model/);

            await transaction.rollback();
        });
    });

    describe('normalizeColumnType', () => {
        it('delegates to the real driver to normalize a column type', async () => {
            const transaction: Transaction = await dataSource.startTransaction();
            const normalized: string = TypeOrmUtilities.normalizeColumnType(
                TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner.connection,
                { type: 'varchar' }
            );

            expect(normalized).toBe('character varying');
            await transaction.rollback();
        });

        it('throws a DataSourceInitializationError when no dataSource is provided', () => {
            expect(() => TypeOrmUtilities.normalizeColumnType(undefined, { type: 'varchar' })).toThrow();
        });
    });
});