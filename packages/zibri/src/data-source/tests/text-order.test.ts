import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeTextOrder, GlossaryWord } from './text-order.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { defineDateFormat } from '../../localization/define-date-format.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, GlossaryWord],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
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
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeTextOrder('the in memory data source', () => inject(dataSourceClass));