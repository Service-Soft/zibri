import { describe, expect, it } from '@jest/globals';

import { waitUntil } from '../../__testing__/wait-until.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { LeaseServiceInterface } from '../../leases/lease-service.interface';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { TransactionAlreadyFinishedError } from '../transaction/transaction-already-finished.error';
import { Transaction } from '../transaction/transaction.model';

/**
 * How long the transactions below may sit idle, short only so the cases do not sit through the default.
 * Long enough for the grant to be asked about before it ends: at 500ms, a loaded valkey answered that
 * question after the transaction had already been rolled back, and the grant handed back.
 */
const IDLE_TIMEOUT_IN_MS: number = 2000;

/**
 * How long a grant lives without being renewed: shorter than {@link ENDED_WITHIN_MS}, so a grant that
 * is still held after it is one something kept renewing.
 */
const LEASE_IN_MS: number = 1000;

/**
 * How long the cases wait for a transaction to be given up on, and for its grant to be handed back.
 * Polled rather than slept through, so a timer firing late on a loaded machine is waited for and a
 * quick one is not.
 */
const ENDED_WITHIN_MS: number = IDLE_TIMEOUT_IN_MS * 5;

/**
 * How long one of the cases below may take.
 */
const CASE_TIMEOUT_IN_MS: number = ENDED_WITHIN_MS * 3;

/**
 * What a case reports when the transaction was not given up on in time.
 */
const STILL_OPEN_MESSAGE: string = 'the transaction is still open';

/**
 * Whether a grant is free, asked the way another caller would.
 * @param key - The grant.
 * @returns Whether it could be taken.
 */
async function isFree(key: string): Promise<boolean> {
    const leaseService: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    return await leaseService.withLease({ key, leaseInMs: LEASE_IN_MS, mode: 'skip' }, async () => await Promise.resolve(true)) === true;
}

/**
 * A transaction nothing comes back to, and the grant held until it ends.
 */
type AbandonedTransaction = {
    /**
     * The transaction.
     */
    transaction: Transaction,
    /**
     * The key of the grant.
     */
    key: string
};

/**
 * Starts a transaction nothing will come back to, and holds a grant until it ends.
 * @param dataSource - The data source to start it on.
 * @returns The transaction and the key of the grant.
 */
async function abandonHoldingALease(dataSource: DataSourceInterface): Promise<AbandonedTransaction> {
    const leaseService: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    const transaction: Transaction = await dataSource.startTransaction({ idleTimeoutInMs: IDLE_TIMEOUT_IN_MS });
    const key: string = `abandoned-${UUIDUtilities.generate()}`;
    await leaseService.withLease({ key, leaseInMs: LEASE_IN_MS, mode: 'wait', heldUntil: transaction }, async () => {});
    return { transaction, key };
}

/**
 * Cases for a transaction that reaches neither a commit nor a rollback, which every data source has
 * to end the same way: rolled back, with the work waiting for its end told so.
 * @param dataSourceName - The name of the data source, for the test names.
 * @param dataSourceOf - Resolves the data source the transactions are started on, once the server runs.
 */
export function describeAbandonedTransactionLease(dataSourceName: string, dataSourceOf: () => DataSourceInterface): void {
    describe(`a transaction left idle while a lease is held until it ends, on ${dataSourceName}`, () => {
        it('is rolled back, and the lease handed back', async () => {
            const { transaction, key } = await abandonHoldingALease(dataSourceOf());
            expect(await isFree(key)).toBe(false);

            await waitUntil(() => transaction.isFinished, ENDED_WITHIN_MS, () => STILL_OPEN_MESSAGE);
            // for longer than the grant lives: one still held then is one something keeps renewing, for as
            // long as the process lives, since nobody ends the transaction
            await waitUntil(async () => await isFree(key), ENDED_WITHIN_MS, () => 'the grant is still held');
        }, CASE_TIMEOUT_IN_MS);

        it('refuses a commit afterwards, and takes a rollback as already done', async () => {
            const { transaction } = await abandonHoldingALease(dataSourceOf());

            await waitUntil(() => transaction.isFinished, ENDED_WITHIN_MS, () => STILL_OPEN_MESSAGE);

            await expect(transaction.commit()).rejects.toThrow(TransactionAlreadyFinishedError);
            await expect(transaction.rollback()).resolves.toBeUndefined();
        }, CASE_TIMEOUT_IN_MS);

        // in memory and on valkey the idle
        // clock started with the first thing a transaction did, so one that did nothing was never ended
        it('is rolled back when it did nothing at all', async () => {
            const transaction: Transaction = await dataSourceOf().startTransaction({ idleTimeoutInMs: IDLE_TIMEOUT_IN_MS });

            await waitUntil(() => transaction.isFinished, ENDED_WITHIN_MS, () => STILL_OPEN_MESSAGE);

            await expect(transaction.commit()).rejects.toThrow(TransactionAlreadyFinishedError);
        }, CASE_TIMEOUT_IN_MS);
    });
}