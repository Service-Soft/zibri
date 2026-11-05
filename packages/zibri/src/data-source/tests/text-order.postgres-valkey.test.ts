import { afterAll, beforeAll } from '@jest/globals';

import { describeTextOrder, GlossaryWord } from './text-order.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { defineDateFormat } from '../../localization/define-date-format.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, GlossaryWord],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, GlossaryWord]
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [postgresDataSourceClass, valKeyDataSourceClass],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({
                token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
                useValue: {
                    defaultLocale: 'sv-SE',
                    supportedLocales: {
                        'sv-SE': {
                            currencyCode: 'SEK',
                            defaultDateFormat: defineDateFormat('YYYY-MM-DD'),
                            defaultDateTimeFormat: defineDateFormat('YYYY-MM-DD HH:mm'),
                            defaultTimeFormat: defineDateFormat('HH:mm')
                        }
                    }
                }
            })
        ]
    });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeTextOrder('postgres', () => inject(postgresDataSourceClass));

describeTextOrder('valkey', () => inject(valKeyDataSourceClass));