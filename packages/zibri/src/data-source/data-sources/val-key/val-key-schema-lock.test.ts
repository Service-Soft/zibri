import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { GlideClient } from '@valkey/valkey-glide';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { ValKeyDataSource } from './val-key-data-source.model';
import { valKeyGlide } from './val-key-glide.function';
import { TestServerTimeouts, TestTimeouts } from '../../../__testing__/constants';
import { holdUntilLetGo } from '../../../__testing__/hold-until-let-go.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../../__testing__/test-server/create-test-val-key-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { LoggerInterface } from '../../../logging/logger.interface';
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
        await this.openConnections();
    }

    /**
     * Holds the schema lock while the given function runs.
     * @param whileHeld - What runs while it is held.
     */
    async holdSchemaLock(whileHeld: () => Promise<void>): Promise<void> {
        await this.schemaLock(SCHEMA_LOCK_KEY, whileHeld);
    }
}

/**
 * How long the schema lock lives, short so that it is renewed every third of it rather than every ten seconds.
 */
const HOLD_IN_MS: number = 300;

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [frameworkDataSourceClass, dataSourceClass],
        providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.SCHEMA_LOCK_HOLD_IN_MS, useValue: HOLD_IN_MS })]
    });
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

// the lock is renewed through a connection of its own and handed back through the data source's, so a renewal on
// its way when the work ended reached the server after the lock was handed back, found it gone, and warned that
// another instance may be running the same code
describe('a schema lock handed back while a renewal of it is on its way', () => {
    it('is not reported as lost', async () => {
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');
        const other: LockHoldingDataSource = new LockHoldingDataSource();
        other.options = { ...inject(dataSourceClass).options, keyPrefix: `other-application-${UUIDUtilities.generate()}` };
        await other.connect();
        // what a renewal slow on its way does, made certain: every script sent through another connection than
        // the data source's own, which of this data source are the renewals alone, is sent a hold late
        const prototype: GlideClient = valKeyGlide().GlideClient.prototype;
        const invokeScript: GlideClient['invokeScript'] = prototype.invokeScript;
        const delayed: jest.SpiedFunction<GlideClient['invokeScript']> = jest.spyOn(prototype, 'invokeScript').mockImplementation(
            async function delayRenewal(this: GlideClient, script, options) {
                if (this !== other.connection) {
                    await sleep(HOLD_IN_MS);
                }
                return await Reflect.apply(invokeScript, this, [script, options]);
            }
        );
        try {
            // long enough for the first renewal to be due, which is then on its way while the lock is handed back
            await other.holdSchemaLock(async () => await sleep(HOLD_IN_MS / 2));
            // the renewal reaches the server, and is answered
            await sleep(HOLD_IN_MS * 2);

            expect(warn.mock.calls.map(([message]) => message).filter(message => String(message).includes('while still working')))
                .toEqual([]);
        }
        finally {
            delayed.mockRestore();
            warn.mockRestore();
            await other.shutDown();
        }
    }, timeouts.restart);
});