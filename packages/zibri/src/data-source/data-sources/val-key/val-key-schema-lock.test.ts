import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { ValKeyDataSource } from './val-key-data-source.model';
import { valKeyGlide } from './val-key-glide.function';
import { TestServerTimeouts, TestTimeouts } from '../../../__testing__/constants';
import { holdUntilLetGo } from '../../../__testing__/hold-until-let-go.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { SCHEMA_LOCK_KEY } from '../data-source.interface';

const timeouts: TestServerTimeouts = TestTimeouts.resolveCombined('inMemory', 'valKey');

// the framework's own entities, in a data source that needs no container
const frameworkDataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

const dataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource();

/**
 * The data source of another application on the same server, holding the schema lock the way it does
 * while it sets its schema up.
 */
class LockHoldingDataSource extends createTestValKeyDataSource({ allowOrphan: true }) {
    /**
     * Connects to the server of its options, without the setup init does: that registers the
     * repositories of the data source, which an application that has started takes no more of.
     */
    async connect(): Promise<void> {
        const { host = 'localhost', port, useTLS } = this.options;
        this.client = await valKeyGlide().GlideClient.createClient({ addresses: [{ host, port }], useTLS });
    }

    /**
     * Holds the schema lock while the given function runs.
     * @param whileHeld - What runs while it is held.
     */
    async holdSchemaLock(whileHeld: () => Promise<void>): Promise<void> {
        await this.schemaLock(SCHEMA_LOCK_KEY, whileHeld);
    }
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [frameworkDataSourceClass, dataSourceClass] });
}, timeouts.start);

afterAll(async () => {
    await server?.shutdown();
}, timeouts.shutdown);

// the lock was one per server, so an application with a key prefix of
// its own waited for every other one setting up its schema, and gave up after the schema lock timeout
describe('applications sharing a server, each under a key prefix of its own', () => {
    it('set their schemas up without waiting for each other', async () => {
        if (server == undefined) {
            throw new Error('the server did not start');
        }
        const other: LockHoldingDataSource = new LockHoldingDataSource();
        other.options = { ...inject(dataSourceClass).options, keyPrefix: `other-application-${UUIDUtilities.generate()}` };
        await other.connect();
        try {
            const letGo: () => Promise<void> = await holdUntilLetGo(async whileHeld => await other.holdSchemaLock(whileHeld));
            const restarted: Promise<void> = server.reInit();
            try {
                await expect(PromiseUtilities.withTimeout(async () => await restarted, timeouts.restart)).resolves.toBeUndefined();
            }
            finally {
                await letGo();
                await restarted;
            }
        }
        finally {
            await other.shutDown();
        }
    }, 2 * timeouts.restart);
});