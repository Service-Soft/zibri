import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Table } from 'typeorm';

import { describeNumberFormats, Measurement } from './number-formats.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';
import { Repository } from '../repository/repository.ts';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Measurement]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Measurement]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Measurement>;
let valKey: Repository<Measurement>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Measurement);
    valKey = inject(valKeyDataSourceClass).getRepository(Measurement);
}, 40000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeNumberFormats('postgres', () => postgres);

describeNumberFormats('valkey', () => valKey);

describe('what a number property is stored as', () => {
    it('declares the column each kind needs', async () => {
        const dataSource: PostgresDataSource = inject(postgresDataSourceClass);
        const table: Table | undefined = await dataSource.createQueryRunner().getTable('measurement');

        // what the format buys beyond the type: a counter in an int8 rather than in an arbitrary
        // precision numeric, which indexes and aggregates as the whole number it is. Not an int4,
        // because the format takes every whole number a double holds exactly
        expect(table?.findColumnByName('temperature')?.type).toBe('double precision');
        expect(table?.findColumnByName('readings')?.type).toBe('bigint');
        expect(table?.findColumnByName('sequence')?.type).toBe('bigint');
        expect(table?.findColumnByName('price')?.type).toBe('numeric');
    }, 30000);
});