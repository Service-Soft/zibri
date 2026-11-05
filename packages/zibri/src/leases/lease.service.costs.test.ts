import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { LeaseServiceInterface } from './lease-service.interface';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';

/**
 * What queueing for a grant costs, as calls on the store.
 */

const roundTrips: RoundTripCounter = new RoundTripCounter();

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories,
    roundTrips
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describe('what waiting for a grant costs', () => {
    it('asks the store a few times while the holder works for a second, and takes the grant as soon as it is handed back', async () => {
        const leaseService: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
        let releasedAt: number = 0;
        const holding: Promise<void> = (async () => {
            await leaseService.withLease({ key: 'costs-wait', leaseInMs: Ms.MINUTE }, async () => await sleep(Ms.SECOND));
            releasedAt = Date.now();
        })();
        await sleep(20);

        roundTrips.reset();
        let takenAt: number = 0;
        await leaseService.withLease(
            { key: 'costs-wait', leaseInMs: Ms.MINUTE, mode: 'wait', acquireTimeoutInMs: Ms.SECOND * 10 },
            () => {
                takenAt = Date.now();
                return Promise.resolve();
            }
        );
        await holding;

        // the holder's renewal and release, and the waiter trying when it starts and once it is
        // told the grant is free, rather than twice every hundred milliseconds
        expect(roundTrips.trips.filter(t => t.statement.startsWith('Lease.')).length).toBeLessThanOrEqual(8);
        expect(takenAt - releasedAt).toBeLessThan(100);
    });

    it('takes and hands back a grant nobody else holds in four calls', async () => {
        const leaseService: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);

        roundTrips.reset();
        await leaseService.withLease({ key: 'costs-free', leaseInMs: Ms.MINUTE }, () => Promise.resolve());

        // clearing a lapsed grant and inserting its own to take it, finding and removing it to hand it back
        expect(roundTrips.trips.filter(t => t.statement.startsWith('Lease.')).length).toBeLessThanOrEqual(4);
    });
});