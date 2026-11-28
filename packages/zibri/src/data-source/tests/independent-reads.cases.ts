import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about the entities two reads of one row hand out:
 * each read its own, so a caller changing what it read in place changes neither the row nor what
 * anybody else read. A file per data source runs them.
 */

/**
 * Where a reading was taken, an object stored in a column of its own.
 */
export class ReadingPlace {
    @Property.string()
    room!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Reading extends BaseEntity {
    @Property.date()
    takenAt!: Date;

    @Property.object({ cls: () => ReadingPlace })
    place!: ReadingPlace;

    @Property.array({ items: { type: 'string' } })
    tags!: string[];

    @Property.number({ format: 'bignumber' })
    value!: BigNumber;
}

/**
 * Defines the cases for one data source.
 * @param dataSourceName - The name of the data source, for the test names.
 * @param repositoryOf - Resolves the repository of the readings, once the server runs.
 */
export function describeIndependentReads(dataSourceName: string, repositoryOf: () => Repository<Reading>): void {
    describe(`two reads of one row, on ${dataSourceName}`, () => {
        it('hand out entities of their own, which a caller can change without changing the other', async () => {
            const { id } = await repositoryOf().create({
                takenAt: new Date('2026-01-01T00:00:00Z'),
                place: { room: 'kitchen' },
                tags: ['a'],
                value: NumberUtilities.new(1.5)
            });
            const first: Reading = await repositoryOf().findById(id);

            first.takenAt.setUTCFullYear(2000);
            first.place.room = 'cellar';
            first.tags.push('b');
            const second: Reading = await repositoryOf().findById(id);

            expect(second.takenAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
            expect(second.place.room).toBe('kitchen');
            expect(second.tags).toEqual(['a']);
            expect(second.value.toString()).toBe('1.5');
        });
    });
}