import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { LeaseLostError } from './lease-lost.error';
import { LeaseServiceInterface } from './lease-service.interface';
import { Lease } from './lease.model';
import { LeaseService } from './lease.service';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { Transaction } from '../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { MetricsServiceInterface } from '../metrics/metrics-service.interface';
import { MetricsSnapshot } from '../metrics/metrics-snapshot.model';
import { Newable } from '../types/newable.type';
import { PromiseUtilities } from '../utilities/promise.utilities';

describe('LeaseService — starting', () => {
    it('refuses to start without Lease, and names it', async () => {
        await expect(startAndStopTestServerWithout([Lease])).rejects.toThrow(/Error initializing LeaseService[\S\s]*Lease/);
    }, TestTimeouts.inMemory.start);
});

describe('LeaseService — shutting down', () => {
    it('hands a grant back once the drain gives up on its work', async () => {
        @DataSource({ allowOrphan: true })
        class DrainDataSource extends InMemoryDataSource {
            override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
            readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
        }
        const server: StartedTestServer = await startTestServer({
            dataSources: [DrainDataSource],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.LEASE_DRAIN_TIMEOUT_IN_MS, useFactory: () => 100 })
            ]
        });
        try {
            const leaseService: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
            const leaseRepository: Repository<Lease> = inject(repositoryTokenFor(Lease));

            // work that outlasts the drain, the shape a replica being stopped mid task is in
            const work: Promise<void> = leaseService.withLease({ key: 'drain-test', leaseInMs: 60000 }, async () => await sleep(1000));
            await sleep(50);
            expect(await leaseRepository.findAll({ where: { key: 'drain-test' } })).toHaveLength(1);

            // the class rather than the token, which types it without the hook. One instance either way
            const drainingService: LeaseService = inject(LeaseService);
            expect(drainingService).toBe(leaseService);
            await drainingService.onAppShutdown();

            expect(await leaseRepository.findAll({ where: { key: 'drain-test' } })).toEqual([]);
            // let the work end while the server is still up, so its own release has somewhere to run
            await work;
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});

describe('LeaseService — held until a transaction ends', () => {
    const leaseInMs: number = 60000;
    let server: StartedTestServer;
    let leaseService: LeaseServiceInterface;
    let leaseRepository: Repository<Lease>;

    /**
     * Whether a grant is free, asked the way another caller would.
     * @param key - The grant.
     * @returns Whether it could be taken.
     */
    async function isFree(key: string): Promise<boolean> {
        return await leaseService.withLease({ key, leaseInMs }, async () => await Promise.resolve(true)) === true;
    }

    beforeAll(async () => {
        @DataSource({ allowOrphan: true })
        class HeldUntilDataSource extends InMemoryDataSource {
            override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
            readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
        }
        server = await startTestServer({ dataSources: [HeldUntilDataSource], providers: defaultTestServerProviders });
        leaseService = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
        leaseRepository = inject(repositoryTokenFor(Lease));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('holds a grant past the work until the transaction commits', async () => {
        const transaction: Transaction = await leaseRepository.dataSource.startTransaction();

        await leaseService.withLease({ key: 'until-commit', leaseInMs, heldUntil: transaction }, async () => {});

        expect(await isFree('until-commit')).toBe(false);
        await transaction.commit();
        expect(await isFree('until-commit')).toBe(true);
    });

    it('hands a grant back on a rollback, which counts as the work having thrown', async () => {
        const released: Transaction = await leaseRepository.dataSource.startTransaction();
        const retained: Transaction = await leaseRepository.dataSource.startTransaction();

        await leaseService.withLease({ key: 'until-rollback', leaseInMs, heldUntil: released }, async () => {});
        await leaseService.withLease(
            { key: 'until-rollback-retained', leaseInMs, onCompletion: 'retainOnError', heldUntil: retained },
            async () => {}
        );
        await released.rollback();
        await retained.rollback();

        expect(await isFree('until-rollback')).toBe(true);
        expect(await isFree('until-rollback-retained')).toBe(false);
    });

    it('hands a grant back once the work returns, when the transaction ended before', async () => {
        const endedInside: Transaction = await leaseRepository.dataSource.startTransaction();
        const endedBefore: Transaction = await leaseRepository.dataSource.startTransaction();
        await endedBefore.commit();

        await leaseService.withLease({ key: 'ended-inside', leaseInMs, heldUntil: endedInside }, async () => await endedInside.commit());
        await leaseService.withLease({ key: 'ended-before', leaseInMs, heldUntil: endedBefore }, async () => {});

        expect(await isFree('ended-inside')).toBe(true);
        expect(await isFree('ended-before')).toBe(true);
    });
});

describe('LeaseService — losing a grant', () => {
    // renewed every 100 ms
    const leaseInMs: number = 300;
    let server: StartedTestServer;
    let leaseService: LeaseServiceInterface;
    let leaseRepository: Repository<Lease>;

    /**
     * Work that waits to be told its grant is gone, and reports what it was told.
     * @param lost - The signal the work was handed.
     * @returns The reason, once the signal fired.
     */
    async function waitToBeTold(lost: AbortSignal): Promise<unknown> {
        await new Promise<void>(resolve => {
            lost.addEventListener('abort', () => resolve(), { once: true });
        });
        return lost.reason;
    }

    /**
     * The value of an unlabelled counter, as the metrics service collects it.
     * @param name - The counter.
     * @returns Its value.
     */
    async function counterOf(name: string): Promise<number> {
        const metricsService: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
        await metricsService.collect();
        const snapshot: MetricsSnapshot | undefined = metricsService.getMetricSnapshots().at(-1);
        return snapshot?.metrics.find(m => m.name === name)?.value ?? 0;
    }

    beforeAll(async () => {
        @DataSource({ allowOrphan: true })
        class LostGrantDataSource extends InMemoryDataSource {
            override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
            readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
        }
        server = await startTestServer({ dataSources: [LostGrantDataSource], providers: defaultTestServerProviders });
        leaseService = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
        leaseRepository = inject(repositoryTokenFor(Lease));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('tells the work once its grant was taken away, and counts the grant as lost', async () => {
        const lostBefore: number = await counterOf('leases_lost_total');
        const told: Promise<unknown> = leaseService.withLease({ key: 'taken-away', leaseInMs }, waitToBeTold);
        await sleep(50);

        // what another instance leaves behind once it took the key over: a row of its own
        await leaseRepository.deleteAll({ key: 'taken-away' });

        expect(await PromiseUtilities.withTimeout(async () => await told, leaseInMs)).toBeInstanceOf(LeaseLostError);
        expect(await counterOf('leases_lost_total') - lostBefore).toBe(1);
    });

    it('tells the work once renewals failed for as long as the grant lives, and not for one that failed', async () => {
        const failuresBefore: number = await counterOf('lease_renewal_failures_total');
        const lostBefore: number = await counterOf('leases_lost_total');
        const spy: jest.SpiedFunction<Repository<Lease>['updateAll']> = jest.spyOn(leaseRepository, 'updateAll')
            .mockRejectedValue(new Error('the data source is unreachable'));
        try {
            let reason: unknown = undefined;
            const work: Promise<unknown> = leaseService.withLease({ key: 'unreachable', leaseInMs }, async lost => {
                reason = await waitToBeTold(lost);
                return reason;
            });

            // one renewal has failed by now, and the grant is still good by the clock
            await sleep(leaseInMs / 2);
            expect(reason).toBeUndefined();

            expect(await PromiseUtilities.withTimeout(async () => await work, leaseInMs * 2)).toBeInstanceOf(LeaseLostError);
        }
        finally {
            spy.mockRestore();
        }
        // every failed renewal, the one that lost the grant included
        expect(await counterOf('lease_renewal_failures_total') - failuresBefore).toBeGreaterThanOrEqual(2);
        expect(await counterOf('leases_lost_total') - lostBefore).toBe(1);
    });

    it('hands the signal to work over several grants, and to work holding a grant of its own', async () => {
        let overSeveral: AbortSignal | undefined = undefined;
        await leaseService.withLeases(['several-a', 'several-b'], { leaseInMs }, (_taken, lost) => {
            overSeveral = lost;
            return Promise.resolve();
        });
        let own: AbortSignal | undefined = undefined;
        await leaseService.hold({ name: 'own', renew: () => Promise.resolve(), release: () => Promise.resolve() }, leaseInMs, lost => {
            own = lost;
            return Promise.resolve();
        });

        expect(overSeveral).toBeInstanceOf(AbortSignal);
        expect(own).toBeInstanceOf(AbortSignal);
    });
});