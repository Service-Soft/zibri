import { afterAll, beforeAll } from '@jest/globals';

import { describeDataSourceTime, Stamp } from './data-source-time.cases';
import { PostgresDataSource } from './data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from './data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from './migration/migration-entity.model';
import { Repository } from './repository/repository';
import { TestTimeouts } from '../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { inject } from '../di/inject.function';
import { Newable } from '../types/newable.type';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Stamp],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Stamp]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Stamp>;
let valKey: Repository<Stamp>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Stamp);
    valKey = inject(valKeyDataSourceClass).getRepository(Stamp);
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeDataSourceTime('postgres', () => postgres);

describeDataSourceTime('valkey', () => valKey);