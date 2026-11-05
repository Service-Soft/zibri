import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about a condition on the items of a list of
 * values, and about several conditions given for one value. A file per data source runs them against
 * a repository of its own.
 */

/**
 * What a parcel carries beside its own columns, stored as one json value.
 */
export class ParcelDetails {
    /**
     * What kind of parcel it is.
     */
    @Property.string()
    kind!: string;

    /**
     * The customs codes it was cleared under.
     */
    @Property.array({ items: { type: 'string' } })
    codes!: string[];
}

/**
 * A parcel, which is filtered by the values it holds a list of.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Parcel extends BaseEntity {
    /**
     * Groups the parcels of one test, so the cases do not read each other's rows.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    /**
     * What the parcel is called in the cases.
     */
    @Property.string()
    label!: string;

    /**
     * What the parcel is tagged with.
     */
    @Property.array({ items: { type: 'string' }, required: false })
    tags?: string[];

    /**
     * The weights it was measured at.
     */
    @Property.array({ items: { type: 'number' } })
    weights!: number[];

    /**
     * What it carries beside its own columns.
     */
    @Property.object({ cls: () => ParcelDetails })
    details!: ParcelDetails;
}

/**
 * A parcel as it is created, which is the entity without what the framework fills in.
 */
type ParcelData = Omit<Parcel, keyof BaseEntity>;

/**
 * Runs the cases against one data source.
 * @param dataSourceName - The name of the data source, for the test names.
 * @param parcelsOf - The repository to run them against.
 */
export function describeItemWhere(dataSourceName: string, parcelsOf: () => Repository<Parcel>): void {
    /**
     * Creates the given parcels under a batch of their own.
     * @param data - The parcels, without their batch.
     * @returns The batch they were created under.
     */
    async function createBatch(...data: Omit<ParcelData, 'batch'>[]): Promise<string> {
        const batch: string = UUIDUtilities.generate();
        await parcelsOf().createAll(data.map(parcel => ({ ...parcel, batch })));
        return batch;
    }

    /**
     * The labels of the parcels found, in order.
     * @param found - The parcels found.
     * @returns Their labels, sorted.
     */
    function labelsOf(found: Parcel[]): string[] {
        return found.map(p => p.label).sort();
    }

    const box: ParcelDetails = { kind: 'box', codes: ['C1'] };

    describe(`a condition on the items of a list of values, on ${dataSourceName}`, () => {
        it('finds a row when one of its items matches', async () => {
            const batch: string = await createBatch(
                { label: 'a', tags: ['fragile', 'red'], weights: [], details: box },
                { label: 'b', tags: ['blue'], weights: [], details: box }
            );

            const found: Parcel[] = await parcelsOf().findAll({ where: { batch, tags: { where: { like: 're%' } } } });

            expect(labelsOf(found)).toEqual(['a']);
        });

        it('finds a row holding an item outside a list, and leaves out a row holding no items', async () => {
            const batch: string = await createBatch(
                { label: 'inside', tags: ['red'], weights: [], details: box },
                { label: 'partly', tags: ['red', 'green'], weights: [], details: box },
                { label: 'empty', tags: [], weights: [], details: box },
                { label: 'absent', weights: [], details: box }
            );

            const found: Parcel[] = await parcelsOf().findAll({
                where: { batch, tags: { where: { notOneOf: ['red', 'blue'] } } }
            });

            expect(labelsOf(found)).toEqual(['partly']);
        });

        it('compares a number item as a number', async () => {
            const batch: string = await createBatch(
                { label: 'heavy', weights: [2, 10], details: box },
                { label: 'light', weights: [9], details: box }
            );

            const found: Parcel[] = await parcelsOf().findAll({ where: { batch, weights: { where: { greaterThan: 9 } } } });

            expect(labelsOf(found)).toEqual(['heavy']);
        });

        it('reads several conditions on an item as any of them', async () => {
            const batch: string = await createBatch(
                { label: 'a', tags: ['red'], weights: [], details: box },
                { label: 'b', tags: ['blue'], weights: [], details: box },
                { label: 'c', tags: ['green'], weights: [], details: box }
            );

            const found: Parcel[] = await parcelsOf().findAll({
                where: { batch, tags: { where: [{ like: 're%' }, 'blue'] } }
            });

            expect(labelsOf(found)).toEqual(['a', 'b']);
        });

        it('asks the same of a list of values inside a json value', async () => {
            const batch: string = await createBatch(
                { label: 'a', weights: [], details: { kind: 'box', codes: ['C1', 'C2'] } },
                { label: 'b', weights: [], details: { kind: 'box', codes: ['C3'] } },
                { label: 'c', weights: [], details: { kind: 'box', codes: [] } }
            );

            const found: Parcel[] = await parcelsOf().findAll({
                where: { batch, details: { where: { codes: { where: { notOneOf: ['C1', 'C3'] } } } } }
            });

            expect(labelsOf(found)).toEqual(['a']);
        });
    });

    describe(`several conditions given for one value inside a json value, on ${dataSourceName}`, () => {
        it('reads them as any of them', async () => {
            const batch: string = await createBatch(
                { label: 'a', weights: [], details: { kind: 'box', codes: [] } },
                { label: 'b', weights: [], details: { kind: 'tube', codes: [] } },
                { label: 'c', weights: [], details: { kind: 'crate', codes: [] } }
            );

            const found: Parcel[] = await parcelsOf().findAll({
                where: { batch, details: { where: { kind: ['box', { like: 'tu%' }] } } }
            });

            expect(labelsOf(found)).toEqual(['a', 'b']);
        });
    });
}