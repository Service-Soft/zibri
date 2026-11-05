/* eslint-disable jsdoc/require-jsdoc */
import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { FindAllPaginatedOptions } from '../models/options/find-all-paginated-options.model';
import { KeysetPage, PaginationResult } from '../models/pagination-result.model';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * The cases every data source answers the same way about a page and its total: which rows a window
 * holds when the rows it reads come with related rows, what a page past the end says, and what a walk
 * by cursor counts. A file per data source runs them against repositories of its own.
 */

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class PagedCustomer extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => PagedOrder, inverseSide: 'customer' })
    orders!: PagedOrder[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class PagedOrder extends BaseEntity {
    /**
     * Groups the orders of one case, so the cases do not read each other's rows.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    /**
     * Where the order sits.
     */
    @Property.number({ format: 'integer' })
    position!: number;

    @Property.manyToOne({ target: () => PagedCustomer, joinColumn: 'customerId', inverseSide: 'orders' })
    customer!: PagedCustomer;

    @Property.string({ format: 'uuid', required: false })
    customerId?: string;

    @Property.oneToMany({ target: () => PagedLine, inverseSide: 'order' })
    lines!: PagedLine[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class PagedLine extends BaseEntity {
    @Property.string()
    product!: string;

    @Property.manyToOne({ target: () => PagedOrder, joinColumn: 'orderId', inverseSide: 'lines' })
    order!: PagedOrder;

    @Property.string({ format: 'uuid', required: false })
    orderId?: string;
}

export const pagedReadEntities: (typeof PagedCustomer | typeof PagedOrder | typeof PagedLine)[] = [PagedCustomer, PagedOrder, PagedLine];

/**
 * The repositories of one data source.
 */
export type PagedReadRepositories = {
    customers: Repository<PagedCustomer>,
    orders: Repository<PagedOrder>,
    lines: Repository<PagedLine>
};

/**
 * The rows of one case: five orders of two customers, each with three lines.
 */
type StoredOrders = {
    batch: string,
    /**
     * The customers, the first one named so that it sorts first.
     */
    customers: PagedCustomer[]
};

const POSITIONS: number[] = [1, 2, 3, 4, 5];
const PRODUCTS: string[] = ['a', 'b', 'c'];

/**
 * Runs every case against the repositories of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param reposOf - Reads the repositories, once the data source is started.
 */
export function describePagedReads(dataSourceName: string, reposOf: () => PagedReadRepositories): void {

    async function storeOrders(): Promise<StoredOrders> {
        const batch: string = UUIDUtilities.generate();
        const customers: PagedCustomer[] = await reposOf().customers.createAll([{ name: `${batch} Ada` }, { name: `${batch} Grace` }]);
        // the even positions belong to the first customer, the odd ones to the second
        const orders: PagedOrder[] = await reposOf().orders.createAll(POSITIONS.map(position => ({
            batch,
            position,
            customerId: customers[position % 2]?.id
        })));
        await reposOf().lines.createAll(orders.flatMap(order => PRODUCTS.map(product => ({ product, orderId: order.id }))));
        return { batch, customers };
    }

    describe(`a page and its total, on ${dataSourceName}`, () => {
        it('holds as many rows as the limit when each row comes with several related rows, and counts the rows', async () => {
            const { batch }: StoredOrders = await storeOrders();

            const page: PaginationResult<PagedOrder> = await reposOf().orders.findAllPaginated(1, 2, {
                where: { batch },
                relations: ['lines'],
                order: { position: 'ASC' }
            });

            expect(page.items.map(o => [o.position, o.lines.length])).toEqual([[1, 3], [2, 3]]);
            expect(page.totalAmount).toBe(5);
        });

        it('answers a page past the last one with no rows and the total', async () => {
            const { batch }: StoredOrders = await storeOrders();

            const page: PaginationResult<PagedOrder> = await reposOf().orders.findAllPaginated(4, 2, {
                where: { batch },
                order: { position: 'ASC' }
            });

            expect(page.items).toEqual([]);
            expect(page.totalAmount).toBe(5);
        });

        it('orders a page by a property of the related row it reads', async () => {
            const { batch }: StoredOrders = await storeOrders();

            const page: PaginationResult<PagedOrder> = await reposOf().orders.findAllPaginated(1, 3, {
                where: { batch },
                relations: ['customer'],
                order: { customer: { name: 'ASC' }, position: 'ASC' }
            });

            expect(page.items.map(o => [o.customer.name.endsWith('Ada'), o.position])).toEqual([[true, 2], [true, 4], [false, 1]]);
            expect(page.totalAmount).toBe(5);
        });

        it('reads the rows a filter through a relation matches, with the related rows they come with', async () => {
            const { batch, customers }: StoredOrders = await storeOrders();

            const page: PaginationResult<PagedOrder> = await reposOf().orders.findAllPaginated(1, 10, {
                where: { batch, customer: { where: { name: customers[0]?.name } } },
                relations: ['lines'],
                order: { position: 'ASC' }
            });

            expect(page.items.map(o => [o.position, o.lines.length])).toEqual([[2, 3], [4, 3]]);
            expect(page.totalAmount).toBe(2);
        });

        it('walks the rows a filter through a relation matches, page after page', async () => {
            const { batch, customers }: StoredOrders = await storeOrders();
            const options: FindAllPaginatedOptions<PagedOrder> = {
                where: { batch, customer: { where: { name: customers[0]?.name } } },
                order: { position: 'ASC' }
            };

            const first: KeysetPage<PagedOrder> = await reposOf().orders.findAllAfter(undefined, 1, options);
            const second: KeysetPage<PagedOrder> = await reposOf().orders.findAllAfter(first.nextCursor, 1, options);

            expect([first, second].map(p => [p.items.map(o => o.position), p.totalAmount])).toEqual([[[2], 2], [[4], 2]]);
        });

        it('counts the whole filter on every page of a walk', async () => {
            const { batch }: StoredOrders = await storeOrders();
            const options: FindAllPaginatedOptions<PagedOrder> = { where: { batch }, relations: ['lines'], order: { position: 'ASC' } };

            const first: KeysetPage<PagedOrder> = await reposOf().orders.findAllAfter(undefined, 2, options);
            const second: KeysetPage<PagedOrder> = await reposOf().orders.findAllAfter(first.nextCursor, 2, options);
            const third: KeysetPage<PagedOrder> = await reposOf().orders.findAllAfter(second.nextCursor, 2, options);

            expect([first, second, third].map(p => [p.items.map(o => o.position), p.totalAmount])).toEqual([
                [[1, 2], 5],
                [[3, 4], 5],
                [[5], 5]
            ]);
            expect(third.nextCursor).toBeUndefined();
        });

        it('answers the page after the last row of a walk with no rows and the total', async () => {
            const { batch }: StoredOrders = await storeOrders();
            const options: FindAllPaginatedOptions<PagedOrder> = { where: { batch }, order: { position: 'ASC' } };

            // a page that filled up: the walk learns it was the last one from the next read
            const full: KeysetPage<PagedOrder> = await reposOf().orders.findAllAfter(undefined, 5, options);
            const after: KeysetPage<PagedOrder> = await reposOf().orders.findAllAfter(full.nextCursor, 5, options);

            expect(full.items).toHaveLength(5);
            expect(after.items).toEqual([]);
            expect(after.totalAmount).toBe(5);
            expect(after.nextCursor).toBeUndefined();
        });

        it('reads a page inside a transaction of the caller', async () => {
            const { batch }: StoredOrders = await storeOrders();
            const transaction: Transaction = await reposOf().orders.dataSource.startTransaction();

            try {
                const page: PaginationResult<PagedOrder> = await reposOf().orders.findAllPaginated(2, 2, {
                    where: { batch },
                    relations: ['lines'],
                    order: { position: 'ASC' },
                    transaction
                });

                expect(page.items.map(o => [o.position, o.lines.length])).toEqual([[3, 3], [4, 3]]);
                expect(page.totalAmount).toBe(5);
            }
            finally {
                await transaction.commit();
            }
        });
    });

    /**
     * Reads every row a stream hands out.
     * @param rows - The stream.
     * @returns The rows, in the order they came.
     */
    async function collect<R>(rows: AsyncIterable<R>): Promise<R[]> {
        const res: R[] = [];
        for await (const row of rows) {
            res.push(row);
        }
        return res;
    }

    // a stream had no order on any data source, because one of them could not give it
    describe(`a stream in an order, on ${dataSourceName}`, () => {
        it('hands out the rows in the order asked for, with the related rows they come with', async () => {
            const { batch }: StoredOrders = await storeOrders();

            const streamed: PagedOrder[] = await collect(reposOf().orders.stream({
                where: { batch },
                relations: ['lines'],
                order: { position: 'DESC' }
            }));

            expect(streamed.map(o => [o.position, o.lines.length])).toEqual([[5, 3], [4, 3], [3, 3], [2, 3], [1, 3]]);
        });

        it('orders by a property of a related row it does not hand out', async () => {
            const { batch }: StoredOrders = await storeOrders();

            const streamed: PagedOrder[] = await collect(reposOf().orders.stream({
                where: { batch },
                order: { customer: { name: 'ASC' }, position: 'DESC' }
            }));

            // the value rather than `in`: an entity the orm builds declares every property, set or not
            expect(streamed.map(o => [o.position, o.customer]))
                .toEqual([[4, undefined], [2, undefined], [5, undefined], [3, undefined], [1, undefined]]);
        });

        it('keeps the order across every batch it reads', async () => {
            const batch: string = UUIDUtilities.generate();
            // more rows than a batch, written in the reverse of the order they are streamed in
            const positions: number[] = Array.from({ length: 1100 }, (_, i) => 1100 - i);
            await reposOf().orders.createAll(positions.map(position => ({ batch, position })));

            const streamed: PagedOrder[] = await collect(reposOf().orders.stream({ where: { batch }, order: { position: 'ASC' } }));

            expect(streamed.map(o => o.position)).toEqual([...positions].reverse());
        });

        // `break` has to end the read rather than leave a cursor and its connection open behind it,
        // which the pool would be short of for good
        it('stops reading when the caller stops', async () => {
            const batch: string = UUIDUtilities.generate();
            await reposOf().orders.createAll(Array.from({ length: 50 }, (_, i) => ({ batch, position: i })));

            let read: number = 0;
            for await (const order of reposOf().orders.stream({ where: { batch } })) {
                expect(order.batch).toBe(batch);
                read++;
                break;
            }

            expect(read).toBe(1);
        });
    });

    // `defaultOrder` is optional and most entities declare none, so this is what pagination does by
    // default
    describe(`a walk over an entity that declares no order, on ${dataSourceName}`, () => {
        // an ordinary write in the middle of an ordinary walk: postgres writes an updated row anew and
        // leaves the old version behind, so a read naming no order finds the rows in another order on
        // every page - which is how OFFSET skips rows nobody deleted
        it('hands each row out exactly once, though rows are written between the pages', async () => {
            const batch: string = UUIDUtilities.generate();
            await reposOf().orders.createAll(Array.from({ length: 12 }, (_, i) => ({ batch, position: i })));

            const seen: string[] = [];
            for (let page: number = 1; page <= 6; page++) {
                const res: PaginationResult<PagedOrder> = await reposOf().orders.findAllPaginated(page, 2, { where: { batch } });
                seen.push(...res.items.map(o => o.id));
                // guarded rather than indexed: a walk gone wrong runs out of rows early
                const edited: PagedOrder | undefined = res.items.at(0);
                if (edited) {
                    await reposOf().orders.updateById(edited.id, { position: 100 + page });
                }
            }

            expect(new Set(seen).size).toBe(12);
        });

        // a page and a count taken as two statements answer the same question at two moments, and
        // disagree whenever a row came or went in between
        it('reports a total the page it came with agrees with, while another writer adds and removes rows', async () => {
            const batch: string = UUIDUtilities.generate();
            await reposOf().orders.createAll(Array.from({ length: 20 }, (_, i) => ({ batch, position: i })));

            let churning: boolean = true;
            const churn: Promise<void> = (async () => {
                while (churning) {
                    const extra: PagedOrder = await reposOf().orders.create({ batch, position: -1 });
                    await reposOf().orders.deleteById(extra.id);
                }
            })();
            try {
                for (let i: number = 0; i < 100; i++) {
                    // a page holding the whole match, so the two numbers answer one question
                    const res: PaginationResult<PagedOrder> = await reposOf().orders.findAllPaginated(1, 30, { where: { batch } });
                    expect(res.items).toHaveLength(res.totalAmount);
                }
            }
            finally {
                churning = false;
                await churn;
            }
        }, 60000);
    });
}