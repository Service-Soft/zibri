import { setTimeout as wait } from 'node:timers/promises';

import { beforeEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

// the in memory transaction wrote back the whole row
// it had read, over what another writer committed to the same row meanwhile

/**
 * A ticket, which two writers change at once.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Ticket extends BaseEntity {
    /**
     * What the ticket is about.
     */
    @Property.string()
    title!: string;

    /**
     * Whether it is done.
     */
    @Property.boolean()
    done!: boolean;

    /**
     * How often it was looked at.
     */
    @Property.number()
    views!: number;
}

/**
 * The title the transaction gives the ticket.
 */
const CHANGED_TITLE: string = 'Login fails on Safari';

/**
 * Gives a write that was not awaited the time to land, or to be held back by the store until the
 * transaction holding its row ends. Awaiting it instead would wait for that end.
 * @param write - The write.
 */
async function letLandOrWait(write: Promise<unknown>): Promise<void> {
    await Promise.race([write, wait(200)]);
}

/**
 * Runs the cases about a row a transaction and another writer change at once against one data source.
 *
 * The other writer goes after the transaction wrote and before it commits. A store that holds the
 * other write back until the transaction ends gets there in the other order, so each case asserts
 * what both orders end in.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param dataSourceOf - Reads the data source, once it is started.
 */
export function describeConcurrentRowUpdates(dataSourceName: string, dataSourceOf: () => DataSourceInterface): void {
    describe(`a row changed by a transaction and another writer at once on ${dataSourceName}`, () => {
        let tickets: Repository<Ticket>;
        let ticket: Ticket;

        beforeEach(async () => {
            tickets = dataSourceOf().getRepository(Ticket);
            await tickets.deleteAll({});
            ticket = await tickets.create({ title: 'Broken login', done: false, views: 0 });
        }, 30000);

        it('keeps what each of them wrote to a column of its own', async () => {
            const transaction: Transaction = await dataSourceOf().startTransaction();
            await tickets.updateById(ticket.id, { title: CHANGED_TITLE }, { transaction });

            const other: Promise<Ticket> = tickets.updateById(ticket.id, { done: true });
            await letLandOrWait(other);
            await transaction.commit();
            await other;

            expect(await tickets.findById(ticket.id)).toMatchObject({ title: CHANGED_TITLE, done: true });
        }, 30000);

        it('adds both amounts to the same column', async () => {
            const transaction: Transaction = await dataSourceOf().startTransaction();
            await tickets.updateAll({ id: ticket.id }, { views: { increment: 1 } }, { transaction });

            const other: Promise<number> = tickets.updateAll({ id: ticket.id }, { views: { increment: 1 } });
            await letLandOrWait(other);
            await transaction.commit();
            await other;

            expect((await tickets.findById(ticket.id)).views).toBe(2);
        }, 30000);

        it('leaves a row deleted that the transaction changed', async () => {
            const transaction: Transaction = await dataSourceOf().startTransaction();
            await tickets.updateById(ticket.id, { title: CHANGED_TITLE }, { transaction });

            const other: Promise<Ticket> = tickets.deleteById(ticket.id);
            await letLandOrWait(other);
            await transaction.commit();
            await other;

            expect(await tickets.findAll()).toEqual([]);
        }, 30000);
    });
}