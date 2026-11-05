import { expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Newable } from '../types/newable.type';

/**
 * The localize service starts with every test server, on the empty translation source the harness
 * writes into the server's scratch directory. The repository's test servers used to replace its
 * startup with nothing, which left the startup path of a shipped service run by no suite.
 */

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

it('runs the startup of the localize service when a test server boots with the defaults', async () => {
    const server: StartedTestServer = await startTestServer({ dataSources: [dataSourceClass] });

    expect(server.bootLog).toContain('Initializes localization for the locales');
    expect(server.bootLog).toContain('  - en-US');

    await server.shutdown();
}, TestTimeouts.inMemory.start + TestTimeouts.inMemory.shutdown);