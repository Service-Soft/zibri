import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZibriPlugin } from '../../plugin/plugin.model';
import { inject } from '../inject.function';
import { defineProvider, DiProvider } from '../models/di-provider.model';
import { InjectionToken } from '../models/injection-token.model';

// overriding a default is a duplicate registration, and so is `[...sharedProviders, myOverride]`,
// so a duplicate as such is configuration. What has no decision behind it is two plugins claiming
// one token, where the winner would be whichever is listed first - which nobody writes as a
// precedence list

const contested: InjectionToken<string> = new InjectionToken<string>('contested-token');

class FirstPlugin extends ZibriPlugin {
    override providers: DiProvider<unknown>[] = [defineProvider({ token: contested, useFactory: () => 'from the first plugin' })];

    validate(): void {}
}

class SecondPlugin extends ZibriPlugin {
    override providers: DiProvider<unknown>[] = [defineProvider({ token: contested, useFactory: () => 'from the second plugin' })];

    validate(): void {}
}

// one class for the whole file, since a data source declared and never deployed is refused by name
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

describe('ProviderCollisionError', () => {
    it('refuses to start an application whose two plugins both provide a token', async () => {
        await expect(startTestServer({ dataSources: [dataSourceClass], plugins: [new FirstPlugin(), new SecondPlugin()] }))
            .rejects.toThrow(/"FirstPlugin" and "SecondPlugin" both provide "contested-token"/);
    }, TestTimeouts.inMemory.start);

    it('lets the application settle it', async () => {
        const server: StartedTestServer = await startTestServer({
            dataSources: [dataSourceClass],
            plugins: [new FirstPlugin(), new SecondPlugin()],
            providers: [...defaultTestServerProviders, defineProvider({ token: contested, useFactory: () => 'from the application' })]
        });
        try {
            expect(inject(contested)).toBe('from the application');
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});