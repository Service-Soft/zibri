import { beforeAll, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { PaginationResult } from '../../open-api/pagination-result.model';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about the numbers a read is paged by: a page and a
 * limit are whole numbers of at least 1, and a skip is one of at least 0. Anything else is refused
 * before the store sees it, rather than refused by one store and read from the end by another. A
 * file per data source runs them against a repository of its own.
 */

/**
 * A row with a place of its own in the order.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class PagedRow extends BaseEntity {
    /**
     * Where the row sits.
     */
    @Property.number({ format: 'integer' })
    position!: number;
}

/**
 * Runs every case against the rows of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoryOf - Reads the repository, once the data source is started.
 */
export function describePagingValues(dataSourceName: string, repositoryOf: () => Repository<PagedRow>): void {
    describe(`the numbers a read is paged by, on ${dataSourceName}`, () => {
        beforeAll(async () => {
            await repositoryOf().deleteAll({});
            await repositoryOf().createAll([1, 2, 3, 4, 5].map(position => ({ position })));
        });

        it('reads the page it names', async () => {
            const page: PaginationResult<PagedRow> = await repositoryOf().findAllPaginated(2, 2, { order: { position: 'ASC' } });

            expect(page.items.map(r => r.position)).toStrictEqual([3, 4]);
            expect(page.totalAmount).toBe(5);
        });

        it.each([
            ['a page of 0', 0, 2, 'page', 1],
            ['a negative page', -1, 2, 'page', 1],
            ['a page that is a fraction', 1.5, 2, 'page', 1],
            ['a limit of 0', 1, 0, 'limit', 1],
            ['a negative limit', 1, -2, 'limit', 1],
            ['a limit that is a fraction', 1, 2.5, 'limit', 1],
            ['a limit that is no number', 1, Number.NaN, 'limit', 1]
        ])('refuses %s for a page', async (_, page, limit, name, min) => {
            await expect(repositoryOf().findAllPaginated(page, limit, { order: { position: 'ASC' } }))
                .rejects.toThrow(`PagedRow: the ${name} of a read has to be a whole number of at least ${min}`);
        });

        it.each([
            ['a limit of 0', 0],
            ['a negative limit', -2],
            ['a limit that is a fraction', 2.5]
        ])('refuses %s for the page after a cursor', async (_, limit) => {
            await expect(repositoryOf().findAllAfter(undefined, limit, { order: { position: 'ASC' } }))
                .rejects.toThrow('PagedRow: the limit of a read has to be a whole number of at least 1');
        });

        it.each([
            ['a take of 0', { take: 0 }, 'take', 1],
            ['a negative take', { take: -2 }, 'take', 1],
            ['a take that is a fraction', { take: 2.5 }, 'take', 1],
            ['a negative skip', { skip: -2 }, 'skip', 0],
            ['a skip that is a fraction', { skip: 1.5 }, 'skip', 0]
        ])('refuses %s for a read of every row', async (_, window, name, min) => {
            await expect(repositoryOf().findAll({ ...window, order: { position: 'ASC' } }))
                .rejects.toThrow(`PagedRow: the ${name} of a read has to be a whole number of at least ${min}`);
        });

        it('reads every row for a skip of 0 and a take of all', async () => {
            const rows: PagedRow[] = await repositoryOf().findAll({ skip: 0, take: 'all', order: { position: 'ASC' } });

            expect(rows.map(r => r.position)).toStrictEqual([1, 2, 3, 4, 5]);
        });
    });
}