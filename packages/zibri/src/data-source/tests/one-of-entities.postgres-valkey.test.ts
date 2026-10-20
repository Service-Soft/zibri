import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Table } from 'typeorm';

import { describeStoredOneOf, Lead } from './one-of-entities.cases.ts';
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
    entities: [...defaultTestServerEntities, Lead]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Lead]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Lead>;
let valKey: Repository<Lead>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Lead);
    valKey = inject(valKeyDataSourceClass).getRepository(Lead);
}, 50000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeStoredOneOf('postgres', () => postgres);

describe('the columns a value of several shapes needs on postgres', () => {
    it('stores one, and an array of them, as one json value each', async () => {
        const table: Table | undefined = await inject(postgresDataSourceClass).createQueryRunner()
            .getTable('lead');

        expect(table?.findColumnByName('contact')?.type).toBe('jsonb');
        expect(table?.findColumnByName('history')?.type).toBe('jsonb');
        expect(table?.findColumnByName('history')?.isArray).toBe(false);
    }, 30000);
});

describeStoredOneOf('valkey', () => valKey);