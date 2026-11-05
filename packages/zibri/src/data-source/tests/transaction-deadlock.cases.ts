import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Repository } from '../repository/repository';
import { TransactionDeadlockError } from '../transaction/transaction-deadlock.error';
import { Transaction } from '../transaction/transaction.model';

/**
 * The cases every data source holding a row for the transaction writing it answers the same way: two
 * transactions waiting on each other end in one of them failing, soon, and the other committing. A
 * file per data source runs them against a repository of its own.
 */

/**
 * A row two transactions write.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class ContendedRow extends BaseEntity {
    /**
     * Who wrote it last.
     */
    @Property.string()
    writer!: string;
}

/**
 * Well under the ten seconds a wait for a row may last, so a cycle ended by running out of patience
 * fails here rather than passing slowly.
 */
const SOON_IN_MS: number = 5000;

/**
 * Runs the last write of a transaction and commits it, rolling it back when the write fails, the way
 * a caller of a transaction does.
 * @param transaction - The transaction.
 * @param write - The write.
 */
async function finish(transaction: Transaction, write: () => Promise<unknown>): Promise<void> {
    try {
        await write();
        await transaction.commit();
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
}

/**
 * Runs every case against the rows of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param rowsOf - Reads the repository, once the data source is started.
 */
export function describeTransactionDeadlock(dataSourceName: string, rowsOf: () => Repository<ContendedRow>): void {
    describe(`two transactions waiting on each other, on ${dataSourceName}`, () => {
        it('fails one of them soon, and lets the other commit', async () => {
            const first: ContendedRow = await rowsOf().create({ writer: 'nobody' });
            const second: ContendedRow = await rowsOf().create({ writer: 'nobody' });
            const left: Transaction = await rowsOf().dataSource.startTransaction();
            const right: Transaction = await rowsOf().dataSource.startTransaction();
            await rowsOf().updateById(first.id, { writer: 'left' }, { transaction: left });
            await rowsOf().updateById(second.id, { writer: 'right' }, { transaction: right });

            const startedAt: number = Date.now();
            // each now waits on the row the other holds
            const outcomes: PromiseSettledResult<void>[] = await Promise.allSettled([
                finish(left, async () => await rowsOf().updateById(second.id, { writer: 'left' }, { transaction: left })),
                finish(right, async () => await rowsOf().updateById(first.id, { writer: 'right' }, { transaction: right }))
            ]);

            expect(Date.now() - startedAt).toBeLessThan(SOON_IN_MS);
            const failed: PromiseRejectedResult[] = outcomes.filter(o => o.status === 'rejected');
            expect(failed).toHaveLength(1);
            expect(failed[0]?.reason).toBeInstanceOf(TransactionDeadlockError);

            // the other wrote both rows
            const survivor: string = outcomes[0]?.status === 'fulfilled' ? 'left' : 'right';
            expect((await rowsOf().findAll({ where: { id: { oneOf: [first.id, second.id] } } })).map(r => r.writer))
                .toEqual([survivor, survivor]);
        }, 30000);

        it('fails neither of two transactions of which one only waits for the other', async () => {
            // a control: waiting is what a held row asks of the next writer, and only a cycle ends one
            const row: ContendedRow = await rowsOf().create({ writer: 'nobody' });
            const holder: Transaction = await rowsOf().dataSource.startTransaction();
            const waiter: Transaction = await rowsOf().dataSource.startTransaction();
            await rowsOf().updateById(row.id, { writer: 'holder' }, { transaction: holder });

            const waiting: Promise<void> = finish(
                waiter,
                async () => await rowsOf().updateById(row.id, { writer: 'waiter' }, { transaction: waiter })
            );
            await new Promise<void>(resolve => {
                setTimeout(resolve, 1500);
            });
            await holder.commit();

            await expect(waiting).resolves.toBeUndefined();
            expect((await rowsOf().findById(row.id)).writer).toBe('waiter');
        }, 30000);
    });
}