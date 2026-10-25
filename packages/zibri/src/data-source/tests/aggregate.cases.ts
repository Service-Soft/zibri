/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { scopeFor } from '../../entity/models/entity-scope.model';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about adding up what rows hold: a sum, an
 * average, a minimum and a maximum over the rows a filter matches, per group when asked to, through
 * the same scopes every read is narrowed by. A file per data source runs them against a repository of
 * its own.
 */

/**
 * The region the scope restricts to, set by the case about it. Undefined everywhere else.
 */
let visibleRegion: string | undefined;

@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    scope: { restrictedTo: scopeFor<Sale>(() => visibleRegion == undefined ? undefined : { region: visibleRegion }) }
})
export class Sale extends BaseEntity {
    /**
     * Groups the sales of one case, so the cases do not read each other's rows.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    @Property.string()
    region!: string;

    @Property.string()
    product!: string;

    @Property.number({ format: 'integer' })
    quantity!: number;

    @Property.number()
    price!: number;

    @Property.date()
    soldAt!: Date;

    @Property.number({ format: 'integer', required: false })
    discount?: number | null;
}

/**
 * Runs every case against the sales of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoryOf - Reads the repository, once the data source is started.
 */
export function describeAggregates(dataSourceName: string, repositoryOf: () => Repository<Sale>): void {

    async function storeSales(): Promise<string> {
        const batch: string = UUIDUtilities.generate();
        await repositoryOf().createAll([
            { batch, region: 'north', product: 'tea', quantity: 2, price: 1.5, soldAt: new Date('2026-01-01T00:00:00Z'), discount: 10 },
            { batch, region: 'north', product: 'coffee', quantity: 4, price: 2.5, soldAt: new Date('2026-03-01T00:00:00Z') },
            { batch, region: 'south', product: 'tea', quantity: 6, price: 1.5, soldAt: new Date('2026-02-01T00:00:00Z'), discount: 20 },
            { batch, region: 'south', product: 'tea', quantity: 8, price: 1.75, soldAt: new Date('2026-04-01T00:00:00Z') }
        ]);
        return batch;
    }

    describe(`adding up what rows hold, on ${dataSourceName}`, () => {
        afterEach(() => {
            visibleRegion = undefined;
        });

        it('sums, averages and finds the smallest and largest value of the rows a filter matches', async () => {
            const batch: string = await storeSales();

            const sum: number = await repositoryOf().sum('quantity', { where: { batch } });
            const average: number | undefined = await repositoryOf().average('price', { where: { batch } });
            const minimum: Date | undefined = await repositoryOf().minimum('soldAt', { where: { batch } });
            const maximum: number | undefined = await repositoryOf().maximum('quantity', { where: { batch, region: 'north' } });

            expect([sum, average, minimum?.toISOString(), maximum]).toEqual([20, 1.8125, '2026-01-01T00:00:00.000Z', 4]);
        });

        it('answers no rows with a sum of 0 and nothing for the others', async () => {
            const batch: string = UUIDUtilities.generate();

            expect(await repositoryOf().sum('quantity', { where: { batch } })).toBe(0);
            expect(await repositoryOf().average('quantity', { where: { batch } })).toBeUndefined();
            expect(await repositoryOf().minimum('quantity', { where: { batch } })).toBeUndefined();
            expect(await repositoryOf().maximum('soldAt', { where: { batch } })).toBeUndefined();
        });

        it('leaves out the rows that hold no value', async () => {
            const batch: string = await storeSales();

            expect(await repositoryOf().average('discount', { where: { batch } })).toBe(15);
            expect(await repositoryOf().sum('discount', { where: { batch } })).toBe(30);
        });

        it('answers per group, one row each with the values it was grouped by', async () => {
            const batch: string = await storeSales();

            const sums: { region: string, sum: number }[] = await repositoryOf().sum('quantity', { where: { batch }, groupBy: ['region'] });
            const latest: { region: string, product: string, maximum: Date | undefined }[] = await repositoryOf().maximum('soldAt', {
                where: { batch },
                groupBy: ['region', 'product']
            });

            expect([...sums].sort((a, b) => a.region.localeCompare(b.region))).toEqual([
                { region: 'north', sum: 6 },
                { region: 'south', sum: 14 }
            ]);
            expect(latest
                .map(l => [l.region, l.product, l.maximum?.toISOString()])
                .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))).toEqual([
                ['north', 'coffee', '2026-03-01T00:00:00.000Z'],
                ['north', 'tea', '2026-01-01T00:00:00.000Z'],
                ['south', 'tea', '2026-04-01T00:00:00.000Z']
            ]);
        });

        it('counts per group', async () => {
            const batch: string = await storeSales();

            const counts: { product: string, count: number }[] = await repositoryOf().count({ where: { batch }, groupBy: ['product'] });

            expect([...counts].sort((a, b) => a.product.localeCompare(b.product))).toEqual([
                { product: 'coffee', count: 1 },
                { product: 'tea', count: 3 }
            ]);
        });

        it('adds up only the rows the caller may see', async () => {
            const batch: string = await storeSales();
            visibleRegion = 'south';

            expect(await repositoryOf().sum('quantity', { where: { batch } })).toBe(14);
            expect(await repositoryOf().count({ where: { batch }, groupBy: ['region'] })).toEqual([{ region: 'south', count: 2 }]);
        });

        it('refuses to add up what holds no number', async () => {
            const batch: string = await storeSales();

            // @ts-expect-error - a sum is taken of a number
            const summingText: Promise<number> = repositoryOf().sum('region', { where: { batch } });

            await expect(summingText).rejects.toThrow('Sale.region holds no number, so it has no sum.');
        });
    });
}