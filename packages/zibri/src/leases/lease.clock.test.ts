import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { LeaseServiceInterface } from './lease-service.interface';
import { TestTimeouts } from '../__testing__/constants';
import { holdUntilLetGo } from '../__testing__/hold-until-let-go.function';
import { runApplicationClockAhead } from '../__testing__/run-application-clock-ahead.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Ms } from '../utilities/ms';

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

/**
 * How far the clock of an instance runs from the clock of the data source: more than a lease lasts.
 */
const SKEW_IN_MS: number = 40 * Ms.SECOND;

// round 2's 06 §F13: a grant's expiry was written and judged by the clock of whichever instance
// touched it, so two instances whose clocks are further apart than a lease disagreed on who holds it
describe('A lease, between instances whose clocks are apart', () => {
    let server: StartedTestServer;
    let leases: LeaseServiceInterface;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        leases = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }, TestTimeouts.inMemory.start);

    afterEach(() => {
        jest.useRealTimers();
    });

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('stays with its holder against an instance whose clock runs ahead by more than the lease', async () => {
        const letGo: () => Promise<void> = await holdUntilLetGo(
            async whileHeld => await leases.withLease({ key: 'clock.ahead', leaseInMs: 30 * Ms.SECOND }, whileHeld)
        );
        try {
            runApplicationClockAhead(SKEW_IN_MS);

            expect(await leases.withLease({ key: 'clock.ahead', leaseInMs: 30 * Ms.SECOND }, async () => await Promise.resolve(true))).toBeUndefined();
        }
        finally {
            jest.useRealTimers();
            await letGo();
        }
    });

    it('goes to another instance once it lapsed, though its holder\'s clock ran ahead', async () => {
        runApplicationClockAhead(SKEW_IN_MS);
        await leases.withLease({ key: 'clock.lapsed', leaseInMs: 200, onCompletion: 'retain' }, async () => {});
        jest.useRealTimers();
        await sleep(400);

        expect(await leases.withLease({ key: 'clock.lapsed', leaseInMs: 200 }, async () => await Promise.resolve(true))).toBe(true);
    });
});