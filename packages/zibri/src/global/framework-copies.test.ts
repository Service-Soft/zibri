import { describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { DuplicateFrameworkCopyError } from './framework-copies';
import { GlobalRegistry } from './global-registry';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { initDiContainer } from '../di/init-di-container.function';
import { Newable } from '../types/newable.type';

/**
 * The second copy loaded below counts itself into a slot the whole realm shares, and nothing takes
 * it back out - so the duplicate test has to be the last one in this file. Jest gives every test
 * file its own realm, so it reaches no further than that. The constraint is the finding restated as
 * a property of the suite: what a copy of the framework does to a process cannot be undone from
 * inside it.
 */

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

describe('framework copies', () => {
    it('boots while this is the only copy', async () => {
        const server: StartedTestServer = await startTestServer({ dataSources: [dataSourceClass] });
        await server.shutdown();
    }, TestTimeouts.inMemory.start + TestTimeouts.inMemory.shutdown);

    it('refuses to boot once a second copy is loaded, naming the install and the test runner as the causes', async () => {
        // a fresh module registry evaluating the same files is what two copies in node_modules are:
        // one realm, two module instances, and two of everything those modules declare
        jest.resetModules();
        const secondCopy: typeof import('./global-registry') = jest.requireActual('./global-registry');

        // the registry the second copy keeps its injectables and entities in is not the one the
        // first copy reads, and neither of them can tell
        expect(secondCopy.GlobalRegistry).not.toBe(GlobalRegistry);
        expect(() => initDiContainer()).toThrow(DuplicateFrameworkCopyError);
        // exactly two: one evaluation per module registry, which is what makes the number the
        // number of copies rather than the number of times something was imported
        expect(() => initDiContainer()).toThrow(/^2 copies of zibri/);
        // and the message has to point at the install, because nothing in the application is wrong
        expect(() => initDiContainer()).toThrow(/npm ls zibri/);
        // 07 §T7: a module registry reset in a test is the other way to get here, and the install
        // diagnosis alone sends that reader to the wrong place
        expect(() => initDiContainer()).toThrow(/jest\.resetModules/);
        // which is what a consumer's test sees when it boots after the reset
        await expect(startTestServer({ dataSources: [dataSourceClass] })).rejects.toThrow(DuplicateFrameworkCopyError);
    }, TestTimeouts.inMemory.start);
});