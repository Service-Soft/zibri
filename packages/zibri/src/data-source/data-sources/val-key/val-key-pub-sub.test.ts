import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { GlideClient } from '@valkey/valkey-glide';

import { ValKeyDataSource } from './val-key-data-source.model';
import { valKeyGlide } from './val-key-glide.function';
import { createTestDataSource } from '../../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../../__testing__/test-server/create-test-val-key-data-source.function';
import { TestTimeouts } from '../../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { PostgresDataSource } from '../postgres/postgres-typeorm-data-source.model';
import { DataSourceSubscription } from '../pub-sub-data-source.interface';

/**
 * Executable form of evaluation/round-2/02-data-layer-stores.md §S11 and
 * evaluation/round-2/03-http-runtime-core.md §H18: a subscription whose client failed once
 * delivered nothing for the rest of the process.
 */

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({ entities: [MigrationEntity] });

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterEach(() => {
    jest.restoreAllMocks();
});

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

/**
 * What arrived on a channel so far, and the subscription.
 */
type Collected = {
    /**
     * The messages, in the order they arrived.
     */
    received: string[],
    /**
     * The subscription they arrived through.
     */
    subscription: DataSourceSubscription
};

/**
 * Collects what arrives on a channel.
 * @param channel - The channel.
 * @returns What arrived so far, and the subscription.
 */
async function collect(channel: string): Promise<Collected> {
    const received: string[] = [];
    const subscription: DataSourceSubscription = await inject(valKeyDataSourceClass).subscribe(channel, m => received.push(m));
    return { received, subscription };
}

/**
 * Publishes on a channel until the message arrives, since what is published while a subscription is
 * connecting again is not delivered.
 * @param channel - The channel.
 * @param collected - What arrives on it.
 * @param message - The message to publish.
 * @returns Whether it arrived within ten seconds.
 */
async function resolveArrivedAgain(channel: string, collected: Collected, message: string): Promise<boolean> {
    const deadline: number = Date.now() + 10000;
    while (Date.now() < deadline) {
        await inject(valKeyDataSourceClass).publish(channel, message);
        await sleep(250);
        if (collected.received.includes(message)) {
            return true;
        }
    }
    return false;
}

describe('ValKeyDataSource — a subscription whose connection failed', () => {
    it('hands over a message published as soon as subscribing returned', async () => {
        // subscribing used to return before the server had confirmed it, so a message published
        // right after was lost now and then; one channel passed most runs, many at once show it
        const channels: string[] = Array.from({ length: 20 }, (_, i) => `pub-sub.control.${i}`);
        const collected: Collected[] = await Promise.all(channels.map(async channel => {
            const subscribed: Collected = await collect(channel);
            await inject(valKeyDataSourceClass).publish(channel, 'hello');
            return subscribed;
        }));
        try {
            await sleep(500);

            expect(collected.map(c => c.received)).toEqual(channels.map(() => ['hello']));
        }
        finally {
            await Promise.all(collected.map(c => c.subscription.unsubscribe()));
        }
    });

    it('hears its channel again after the server dropped its connection', async () => {
        const collected: Collected = await collect('pub-sub.killed');
        const admin: GlideClient = await valKeyGlide().GlideClient.createClient({
            addresses: [{ host: 'localhost', port: inject(valKeyDataSourceClass).options.port ?? 6379 }]
        });
        try {
            await admin.customCommand(['CLIENT', 'KILL', 'TYPE', 'pubsub']);

            expect(await resolveArrivedAgain('pub-sub.killed', collected, 'after the kill')).toBe(true);
        }
        finally {
            admin.close();
            await collected.subscription.unsubscribe();
        }
    }, 20000);

    it('hears its channel again after its client was closed', async () => {
        // a spy that calls through, only to get hold of the client the subscription opens: a closed
        // client is what ends a subscription, and nothing outside the process can close one
        const createClient: jest.SpiedFunction<typeof GlideClient.createClient> = jest.spyOn(valKeyGlide().GlideClient, 'createClient');
        const collected: Collected = await collect('pub-sub.closed');
        try {
            const opened: (typeof createClient.mock.results)[number] | undefined = createClient.mock.results.at(-1);
            const subscriber: GlideClient | undefined = opened?.type === 'return' ? await opened.value : undefined;
            expect(subscriber).toBeDefined();
            subscriber?.close();

            expect(await resolveArrivedAgain('pub-sub.closed', collected, 'after the close')).toBe(true);
        }
        finally {
            await collected.subscription.unsubscribe();
        }
    }, 20000);
});