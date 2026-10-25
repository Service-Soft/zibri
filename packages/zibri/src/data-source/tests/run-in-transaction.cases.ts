import { beforeEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { Repository } from '../repository/repository';
import { TransactionConflictError } from '../transaction/transaction-conflict.error';
import { TransactionDeadlockError } from '../transaction/transaction-deadlock.error';

// evaluation/round-2/02-data-layer-stores.md S5: a conflict that ended a transaction left re-running
// the whole unit of work to every caller, by hand

/**
 * A booking, which the work below writes.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Booking extends BaseEntity {
    /**
     * Who booked.
     */
    @Property.string()
    guest!: string;
}

/**
 * Runs the cases about running work in a transaction against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param dataSourceOf - Reads the data source, once it is started.
 */
export function describeRunInTransaction(dataSourceName: string, dataSourceOf: () => DataSourceInterface): void {
    describe(`running work in a transaction on ${dataSourceName}`, () => {
        let bookings: Repository<Booking>;

        /**
         * The guests of every booking stored, sorted.
         * @returns The guests.
         */
        async function findGuests(): Promise<string[]> {
            return (await bookings.findAll()).map(b => b.guest).sort();
        }

        beforeEach(async () => {
            bookings = dataSourceOf().getRepository(Booking);
            await bookings.deleteAll({});
        }, 30000);

        it('commits what the work wrote, and hands back what it returned', async () => {
            const booked: Booking = await dataSourceOf().runInTransaction(
                async transaction => await bookings.create({ guest: 'ada' }, { transaction }),
                { maxAttempts: 1 }
            );

            expect(booked.guest).toBe('ada');
            expect(await findGuests()).toEqual(['ada']);
        }, 30000);

        it('rolls back what the work wrote when it fails, and fails with it', async () => {
            const failed: Promise<void> = dataSourceOf().runInTransaction(async transaction => {
                await bookings.create({ guest: 'ada' }, { transaction });
                throw new Error('the work failed');
            }, { maxAttempts: 3 });

            await expect(failed).rejects.toThrow('the work failed');
            expect(await findGuests()).toEqual([]);
        }, 30000);

        it('runs the work again from the start after a conflict ended it', async () => {
            let attempts: number = 0;

            await dataSourceOf().runInTransaction(async transaction => {
                attempts++;
                await bookings.create({ guest: `attempt ${attempts}` }, { transaction });
                if (attempts === 1) {
                    // what a write answers when the store ended the transaction to let another one go on
                    throw new TransactionDeadlockError();
                }
            }, { maxAttempts: 3 });

            expect(attempts).toBe(2);
            expect(await findGuests()).toEqual(['attempt 2']);
        }, 30000);

        it('fails with the conflict once every attempt ended in one', async () => {
            let attempts: number = 0;

            const failed: Promise<void> = dataSourceOf().runInTransaction(async transaction => {
                attempts++;
                await bookings.create({ guest: `attempt ${attempts}` }, { transaction });
                throw new TransactionDeadlockError();
            }, { maxAttempts: 3 });

            await expect(failed).rejects.toThrow(TransactionConflictError);
            expect(attempts).toBe(3);
            expect(await findGuests()).toEqual([]);
        }, 30000);

        it('refuses a number of attempts that runs the work not even once', async () => {
            await expect(dataSourceOf().runInTransaction(() => Promise.resolve(), { maxAttempts: 0 }))
                .rejects.toThrow('maxAttempts has to be a whole number of at least 1, but is 0.');
        }, 30000);
    });
}