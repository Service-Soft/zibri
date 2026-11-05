import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { describeStoredOneOf, Lead } from './one-of-entities.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { findStoredColumns, StoredColumn } from '../../__testing__/find-stored-columns.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Lead],
    repositories: defaultTestServerRepositories
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
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeStoredOneOf('postgres', () => postgres);

describe('the columns a value of several shapes needs on postgres', () => {
    it('stores one, and an array of them, as one json value each', async () => {
        const columns: Map<string, StoredColumn> = await findStoredColumns(inject(postgresDataSourceClass), 'lead');

        expect(columns.get('contact')?.type).toBe('jsonb');
        expect(columns.get('history')?.type).toBe('jsonb');
        expect(columns.get('history')?.isArray).toBe(false);
    }, 30000);
});

describeStoredOneOf('valkey', () => valKey);