import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresDataSource } from './postgres-data-source.model';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { createTestDataSource } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { DataSourceSubscription } from '../pub-sub-data-source.interface';

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, 120000);

afterAll(async () => {
    // closing the data source waits for every connection it handed out, the listening one included
    await server?.shutdown();
}, 30000);

/**
 * Collects what arrives on a channel.
 * @param channel - The channel.
 * @returns What arrived so far, and the subscription.
 */
async function collect(channel: string): Promise<{ received: string[], subscription: DataSourceSubscription }> {
    const received: string[] = [];
    const subscription: DataSourceSubscription = await inject(dataSourceClass).subscribe(channel, m => received.push(m));
    return { received, subscription };
}

describe('PostgresDataSource — publish and subscribe', () => {
    it('hands a message to the subscribers of its channel only, the publishing instance included', async () => {
        const first: { received: string[], subscription: DataSourceSubscription } = await collect('pub-sub.first');
        const second: { received: string[], subscription: DataSourceSubscription } = await collect('pub-sub.first');
        const other: { received: string[], subscription: DataSourceSubscription } = await collect('pub-sub.other');
        try {
            await inject(dataSourceClass).publish('pub-sub.first', 'hello');
            await sleep(500);

            expect(first.received).toEqual(['hello']);
            expect(second.received).toEqual(['hello']);
            expect(other.received).toEqual([]);
        }
        finally {
            await first.subscription.unsubscribe();
            await second.subscription.unsubscribe();
            await other.subscription.unsubscribe();
        }
    });

    it('hands nothing over once unsubscribed, while the channel keeps its other subscribers', async () => {
        const leaving: { received: string[], subscription: DataSourceSubscription } = await collect('pub-sub.leaving');
        const staying: { received: string[], subscription: DataSourceSubscription } = await collect('pub-sub.leaving');
        await leaving.subscription.unsubscribe();
        try {
            await inject(dataSourceClass).publish('pub-sub.leaving', 'after');
            await sleep(500);

            expect(leaving.received).toEqual([]);
            expect(staying.received).toEqual(['after']);
        }
        finally {
            await staying.subscription.unsubscribe();
        }
    });

    it('listens again after the last subscriber left and a new one came', async () => {
        const gone: DataSourceSubscription = (await collect('pub-sub.again')).subscription;
        await gone.unsubscribe();
        const back: { received: string[], subscription: DataSourceSubscription } = await collect('pub-sub.again');
        try {
            await inject(dataSourceClass).publish('pub-sub.again', 'welcome back');
            await sleep(500);

            expect(back.received).toEqual(['welcome back']);
        }
        finally {
            await back.subscription.unsubscribe();
        }
    });

    it('listens again once the server ended the connection it listened on', async () => {
        const dropped: { received: string[], subscription: DataSourceSubscription } = await collect('pub-sub.dropped');
        try {
            const terminated: Record<string, unknown>[] = await queryPostgres(
                inject(dataSourceClass),
                'SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE query LIKE $1 AND pid <> pg_backend_pid()',
                ['LISTEN %pub-sub.dropped%']
            );
            expect(terminated).toEqual([{ terminated: true }]);
            // what is published while nothing listens is gone, so until one arrives
            for (let waited: number = 0; dropped.received.length === 0 && waited < 5000; waited += 250) {
                await inject(dataSourceClass).publish('pub-sub.dropped', 'still there');
                await sleep(250);
            }

            expect(dropped.received[0]).toBe('still there');
        }
        finally {
            await dropped.subscription.unsubscribe();
        }
    });

    it('refuses a message larger than postgres carries, and says how large it may be', async () => {
        const dataSource: PostgresDataSource = inject(dataSourceClass);
        expect(dataSource.maxMessageBytes).toBe(7999);

        await expect(dataSource.publish('pub-sub.large', 'a'.repeat(8000))).rejects.toThrow(/8000 bytes[\S\s]*at most 7999/);
    });
});