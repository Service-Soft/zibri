import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Repository } from './repository/repository.ts';
import { Transaction } from './transaction/transaction.model.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { LeaseServiceInterface } from '../leases/lease-service.interface.ts';
import { LogLevel } from '../logging/log-level.enum.ts';
import { Log } from '../logging/log.model.ts';
import { Ms } from '../utilities/ms.ts';

/**
 * The guard that reports a transaction outliving the grant it was written under.
 *
 * Observed through the logs the framework really persists rather than a spy on the logger, so the
 * test fails if the warning is produced but never reaches anywhere a developer would see it.
 *
 * Both directions matter. A guard that never fires is worse than no guard, because it reads as
 * proof that the code is fine - so the quiet cases are asserted just as explicitly as the loud one.
 */

/**
 * Long enough that nothing here is ever renewed or lapses while it runs, so the guard is the only
 * thing under test and a slow container cannot turn it into a lease expiry test.
 */
const LEASE_IN_MS: number = Ms.MINUTE;

let server: StartedTestServer;
let logRepository: Repository<Log>;
let leaseService: LeaseServiceInterface;

async function leaseWarnings(): Promise<Log[]> {
    // the guard logs without waiting for the write, which is what logging does everywhere now. Every
    // assertion here is about a row existing or not, so the queue has to be empty before looking -
    // otherwise "no warning" and "the warning has not been written yet" are the same result.
    await inject(ZIBRI_DI_TOKENS.LOGGER).flush();

    const logs: Log[] = await logRepository.findAll({ where: { level: LogLevel.WARN } });
    return logs.filter(l => l.message.includes('while holding the lease'));
}

describe('withLease transaction guard', () => {
    beforeAll(async () => {
        server = await startTestServer({});
        await server.start();
        logRepository = inject(repositoryTokenFor(Log));
        leaseService = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }, 60000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await logRepository.deleteAll({});
    });

    it('warns when a write used a transaction that is still open as the grant releases', async () => {
        const dataSource: Repository<Log>['dataSource'] = logRepository.dataSource;
        const transaction: Transaction = await dataSource.startTransaction();

        await leaseService.withLease({ key: 'guard:escaping', leaseInMs: LEASE_IN_MS }, async () => {
            await logRepository.create(
                { level: LogLevel.INFO, message: 'written under the lease', context: {}, cleanupAt: new Date(Date.now() + Ms.DAY) },
                { transaction }
            );
        });

        // asserted before the commit, because the point is that the grant was already handed back
        // while this write was still invisible to anyone else
        const warnings: Log[] = await leaseWarnings();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.message).toContain('guard:escaping');

        await transaction.commit();
    }, 20000);

    it('stays quiet when the transaction is committed while the grant is still held', async () => {
        const dataSource: Repository<Log>['dataSource'] = logRepository.dataSource;

        await leaseService.withLease({ key: 'guard:committed', leaseInMs: LEASE_IN_MS }, async () => {
            const transaction: Transaction = await dataSource.startTransaction();
            await logRepository.create(
                { level: LogLevel.INFO, message: 'written and committed under the lease', context: {}, cleanupAt: new Date(Date.now() + Ms.DAY) },
                { transaction }
            );
            await transaction.commit();
        });

        // this is the safe shape and the one the docs tell people to use - warning here would train
        // everyone to ignore the warning
        expect(await leaseWarnings()).toHaveLength(0);
    }, 20000);

    it('stays quiet when the transaction still open is the one the grant is held until', async () => {
        const dataSource: Repository<Log>['dataSource'] = logRepository.dataSource;
        const transaction: Transaction = await dataSource.startTransaction();

        await leaseService.withLease({ key: 'guard:held-until', leaseInMs: LEASE_IN_MS, heldUntil: transaction }, async () => {
            await logRepository.create(
                { level: LogLevel.INFO, message: 'written under a lease held until the commit', context: {}, cleanupAt: new Date(Date.now() + Ms.DAY) },
                { transaction }
            );
        });

        // the grant covers this commit, so there is nothing to report
        expect(await leaseWarnings()).toHaveLength(0);

        await transaction.commit();
    }, 20000);

    it('stays quiet when the write used no transaction at all', async () => {
        await leaseService.withLease({ key: 'guard:no-transaction', leaseInMs: LEASE_IN_MS }, async () => {
            await logRepository.create({ level: LogLevel.INFO, message: 'written without a transaction', context: {}, cleanupAt: new Date(Date.now() + Ms.DAY) });
        });

        expect(await leaseWarnings()).toHaveLength(0);
    }, 20000);

    it('reports the innermost grant when a nested write outlives it, and only that one', async () => {
        const dataSource: Repository<Log>['dataSource'] = logRepository.dataSource;

        await leaseService.withLease({ key: 'guard:outer', leaseInMs: LEASE_IN_MS }, async () => {
            const transaction: Transaction = await dataSource.startTransaction();

            await leaseService.withLease({ key: 'guard:inner', leaseInMs: LEASE_IN_MS }, async () => {
                await logRepository.create(
                    { level: LogLevel.INFO, message: 'written under the nested lease', context: {}, cleanupAt: new Date(Date.now() + Ms.DAY) },
                    { transaction }
                );
            });

            // committed while the outer grant is still held, so the outer one did cover this write
            // and the inner one did not. Naming both would send someone to fix a lease that is fine.
            await transaction.commit();
        });

        const warnings: Log[] = await leaseWarnings();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.message).toContain('guard:inner');
    }, 20000);

    it('does not report a transaction that never touched a repository under the grant', async () => {
        const dataSource: Repository<Log>['dataSource'] = logRepository.dataSource;
        const transaction: Transaction = await dataSource.startTransaction();

        // open the whole time, but nothing was written through it while the grant was held, so there
        // is no claim that could be lost and nothing to report
        await leaseService.withLease({ key: 'guard:untouched', leaseInMs: LEASE_IN_MS }, async () => {
            await logRepository.findAll({ where: { level: LogLevel.ERROR } });
        });

        expect(await leaseWarnings()).toHaveLength(0);

        await transaction.rollback();
    }, 20000);
});