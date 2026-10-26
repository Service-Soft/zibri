import { afterAll, beforeAll } from '@jest/globals';

import { Album, Artist, describeNestedRelations, Track } from './nested-relations.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Artist, Album, Track],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Artist, Album, Track]
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeNestedRelations(
    'postgres',
    () => inject(postgresDataSourceClass).getRepository(Artist),
    () => inject(postgresDataSourceClass).getRepository(Album),
    () => inject(postgresDataSourceClass).getRepository(Track)
);

describeNestedRelations(
    'valkey',
    () => inject(valKeyDataSourceClass).getRepository(Artist),
    () => inject(valKeyDataSourceClass).getRepository(Album),
    () => inject(valKeyDataSourceClass).getRepository(Track)
);