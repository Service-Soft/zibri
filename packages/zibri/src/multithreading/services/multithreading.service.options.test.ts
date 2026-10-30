import { afterEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, defaultTestProviders, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Newable } from '../../types/newable.type';
import { MultithreadingOptions } from '../models/multithreading-options.model';

/**
 * The options of an application that says nothing, and of one that says one thing. The harness's
 * own providers rather than this repository's, which turn TypeScript worker files on for the suites.
 */

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

afterEach(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('MULTITHREADING_OPTIONS', () => {
    // 07 §T9: a worker file that is TypeScript at runtime needs a compiler in the image, which a
    // deployment that ships compiled files never has - so an application that says nothing does
    // not load one, and does not have to install one
    it('runs no TypeScript worker files unless the application says so', async () => {
        server = await startTestServer({ dataSources: [dataSourceClass], providers: defaultTestProviders });

        const options: MultithreadingOptions = inject(ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS);

        expect(options.enableTsWorkerFiles).toBe(false);
        expect(options.maxThreads).toBeGreaterThanOrEqual(1);
    }, TestTimeouts.inMemory.start);

    it('takes what the application says through MULTITHREADING_OPTIONS_INPUT over the defaults', async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS_INPUT, useValue: { enableTsWorkerFiles: true, maxAttempts: 5 } })
            ]
        });

        const options: MultithreadingOptions = inject(ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS);

        expect(options.enableTsWorkerFiles).toBe(true);
        expect(options.maxAttempts).toBe(5);
        expect(options.maxThreads).toBeGreaterThanOrEqual(1);
    }, TestTimeouts.inMemory.start);
});