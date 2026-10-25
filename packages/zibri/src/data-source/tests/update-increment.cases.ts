/* eslint-disable jsdoc/require-jsdoc */
import { afterEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { scopeFor } from '../../entity/models/entity-scope.model';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about adding to what a row stores: `updateAll`
 * with `{ increment }` adds to every matching row in one write, loses nothing to another writer, and
 * is judged against the caller's scope on what it wrote. A file per data source runs them against a
 * repository of its own.
 */

/**
 * The most a counter may hold for the caller to see it, set by the case about the scope. Undefined
 * everywhere else, which the scope then does not restrict.
 */
let visibleBelow: number | undefined;

/**
 * What a counter is set to, which happens to name a property `increment`.
 */
export class CounterSettings {
    @Property.number({ format: 'integer' })
    increment!: number;
}

@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    scope: { restrictedTo: scopeFor<Counter>(() => visibleBelow == undefined ? undefined : { count: { lesserThan: visibleBelow } }) }
})
export class Counter extends BaseEntity {
    /**
     * Groups the counters of one case, so the cases do not read each other's rows.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    @Property.number({ format: 'integer' })
    count!: number;

    @Property.number()
    total!: number;

    @Property.string()
    label!: string;

    @Property.number({ format: 'integer', required: false })
    hits?: number | null;

    @Property.object({ cls: () => CounterSettings, required: false })
    settings?: CounterSettings | null;
}

/**
 * Runs every case against the counters of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoryOf - Reads the repository, once the data source is started.
 */
export function describeUpdateIncrement(dataSourceName: string, repositoryOf: () => Repository<Counter>): void {

    async function storeCounters(counts: number[]): Promise<string> {
        const batch: string = UUIDUtilities.generate();
        await repositoryOf().createAll(counts.map(count => ({ batch, count, total: 0.5, label: 'stored' })));
        return batch;
    }

    async function countsOf(batch: string): Promise<number[]> {
        return (await repositoryOf().findAll({ where: { batch }, order: { count: 'ASC' } })).map(c => c.count);
    }

    describe(`adding to what a row stores, on ${dataSourceName}`, () => {
        afterEach(() => {
            visibleBelow = undefined;
        });

        it('adds the amount to every matching row and leaves the others', async () => {
            const batch: string = await storeCounters([1, 2, 3]);
            const other: string = await storeCounters([1]);

            const updated: number = await repositoryOf().updateAll({ batch }, { count: { increment: 2 } });

            expect(updated).toBe(3);
            expect(await countsOf(batch)).toEqual([3, 4, 5]);
            expect(await countsOf(other)).toEqual([1]);
        });

        it('adds and sets in the same write', async () => {
            const batch: string = await storeCounters([1, 2]);

            await repositoryOf().updateAll({ batch }, { label: 'counted', count: { increment: 1 }, total: { increment: 0.25 } });

            const rows: Counter[] = await repositoryOf().findAll({ where: { batch }, order: { count: 'ASC' } });
            expect(rows.map(r => [r.count, r.total, r.label])).toEqual([[2, 0.75, 'counted'], [3, 0.75, 'counted']]);
        });

        it('hands back the rows with what they hold now, when asked for them', async () => {
            const batch: string = await storeCounters([5]);

            const rows: Counter[] = await repositoryOf().updateAll({ batch }, { count: { increment: -3 } }, { returnUpdated: true });

            expect(rows.map(r => r.count)).toEqual([2]);
        });

        it('loses no amount to writers adding at the same time', async () => {
            const batch: string = await storeCounters([0]);

            const addOne: () => Promise<number> = async () => await repositoryOf().updateAll({ batch }, { count: { increment: 1 } });
            await Promise.all(Array.from({ length: 20 }, addOne));

            expect(await countsOf(batch)).toEqual([20]);
        });

        it('adds to a property that holds no value as though it held 0', async () => {
            const batch: string = await storeCounters([1]);

            await repositoryOf().updateAll({ batch }, { hits: { increment: 4 } });

            expect((await repositoryOf().findAll({ where: { batch } })).map(r => r.hits)).toEqual([4]);
        });

        it('writes an object naming a property `increment` as the object it is', async () => {
            const batch: string = await storeCounters([1]);
            await repositoryOf().updateAll({ batch }, { settings: { increment: 3 } });

            await repositoryOf().updateAll({ batch }, { settings: { increment: 7 } });

            expect((await repositoryOf().findAll({ where: { batch } })).map(r => r.settings)).toEqual([{ increment: 7 }]);
        });

        it('refuses an amount with a fraction for a whole number, before anything is written', async () => {
            const batch: string = await storeCounters([1]);

            await expect(repositoryOf().updateAll({ batch }, { count: { increment: 0.5 } }))
                .rejects.toThrow('Counter.count holds whole numbers, so it cannot be increased by 0.5.');
            expect(await countsOf(batch)).toEqual([1]);
        });

        it('refuses an increment of a property that holds no number', async () => {
            const batch: string = await storeCounters([1]);

            // @ts-expect-error - only a number can be added to
            await expect(repositoryOf().updateAll({ batch }, { label: { increment: 1 } }))
                .rejects.toThrow('Counter.label holds no number, so nothing can be added to it.');
        });

        it('refuses an increment that moves a row out of what the caller may see, and writes nothing', async () => {
            const batch: string = await storeCounters([1, 8]);
            visibleBelow = 10;

            await expect(repositoryOf().updateAll({ batch }, { count: { increment: 5 } })).rejects.toThrow(ForbiddenError);

            visibleBelow = undefined;
            expect(await countsOf(batch)).toEqual([1, 8]);
        });

        it('adds within what the caller may see', async () => {
            const batch: string = await storeCounters([1, 12]);
            visibleBelow = 10;

            const updated: number = await repositoryOf().updateAll({ batch }, { count: { increment: 5 } });

            visibleBelow = undefined;
            expect(updated).toBe(1);
            expect(await countsOf(batch)).toEqual([6, 12]);
        });
    });
}