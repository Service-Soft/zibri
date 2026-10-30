import { beforeAll, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository, UNBOUNDED_FIND_ALL_LIMIT } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';
import { UnboundedReturnError } from '../unbounded-return.error';

/**
 * The cases every data source answers the same way about a write asked to hand back more rows than
 * can be handed back at once. A file per data source runs them against a repository of its own.
 */

/**
 * How long seeding the rows may take.
 */
const SEED_TIMEOUT_IN_MS: number = 60000;

/**
 * A row of a match too large to hand back.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class BoundedRow extends BaseEntity {
    /**
     * Which run a row belongs to, so the filters of one run match its rows alone.
     */
    @Property.string()
    batch!: string;

    /**
     * What an update sets, so that whether it wrote anything can be read off the rows.
     */
    @Property.boolean({ required: false })
    marked: boolean | undefined | null;
}

/**
 * Runs every case against the rows of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param rowsOf - Reads the repository, once the data source is started.
 */
export function describeBoundedReturns(dataSourceName: string, rowsOf: () => Repository<BoundedRow>): void {
    describe(`a write asked to hand back more rows than fit, on ${dataSourceName}`, () => {
        const batch: string = UUIDUtilities.generate();

        // one more row than can be handed back, seeded once: the cases go on to the boundary itself
        beforeAll(async () => {
            await rowsOf().createAll(Array.from({ length: UNBOUNDED_FIND_ALL_LIMIT + 1 }, () => ({ batch })));
        }, SEED_TIMEOUT_IN_MS);

        it('refuses an update handing back the rows, and writes none of them', async () => {
            await expect(rowsOf().updateAll({ batch }, { marked: true }, { returnUpdated: true })).rejects.toThrow(UnboundedReturnError);

            expect(await rowsOf().count({ where: { batch, marked: true } })).toBe(0);
        }, SEED_TIMEOUT_IN_MS);

        it('writes none of them in the caller\'s transaction either, which the caller may still commit', async () => {
            const transaction: Transaction = await rowsOf().dataSource.startTransaction();
            await expect(rowsOf().updateAll({ batch }, { marked: true }, { returnUpdated: true, transaction }))
                .rejects.toThrow(UnboundedReturnError);
            await transaction.commit();

            expect(await rowsOf().count({ where: { batch, marked: true } })).toBe(0);
        }, SEED_TIMEOUT_IN_MS);

        it('refuses a delete handing back the rows, and deletes none of them', async () => {
            await expect(rowsOf().deleteAll({ batch }, { returnDeleted: true })).rejects.toThrow(UnboundedReturnError);

            expect(await rowsOf().count({ where: { batch } })).toBe(UNBOUNDED_FIND_ALL_LIMIT + 1);
        }, SEED_TIMEOUT_IN_MS);

        it('hands back as many rows as fit', async () => {
            const [extra] = await rowsOf().findAll({ where: { batch }, limit: 1 });
            await rowsOf().deleteById(extra?.id ?? '');

            expect(await rowsOf().updateAll({ batch }, { marked: true }, { returnUpdated: true })).toHaveLength(UNBOUNDED_FIND_ALL_LIMIT);
            expect(await rowsOf().deleteAll({ batch }, { returnDeleted: true })).toHaveLength(UNBOUNDED_FIND_ALL_LIMIT);
        }, SEED_TIMEOUT_IN_MS);
    });
}