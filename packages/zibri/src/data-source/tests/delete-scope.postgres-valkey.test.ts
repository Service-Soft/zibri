import { afterAll, beforeAll } from '@jest/globals';

import { deleteScopeHooks, describeDeleteScope, OwnedNote } from './delete-scope.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, OwnedNote],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, OwnedNote]
});

let server: StartedTestServer | undefined;
let postgres: Repository<OwnedNote>;
let valKey: Repository<OwnedNote>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [postgresDataSourceClass, valKeyDataSourceClass],
        providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.REPOSITORY_HOOKS, useValue: deleteScopeHooks })]
    });
    postgres = inject(postgresDataSourceClass).getRepository(OwnedNote);
    valKey = inject(valKeyDataSourceClass).getRepository(OwnedNote);
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeDeleteScope('postgres', () => postgres);

describeDeleteScope('valkey', () => valKey);