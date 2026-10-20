/* eslint-disable unicorn/no-null */
import { beforeAll, describe, expect, it } from 'vitest';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { Repository } from '../repository/repository.ts';

/**
 * The cases every data source answers the same way about `not`, `oneOf`, `notOneOf` and `notLike` on a
 * property that holds no value. A file per data source runs them against a repository of its own.
 */

/**
 * What a tag carries beside its own columns, stored as one json value.
 */
export class TagDetails {
    /**
     * A color, when the tag has one.
     */
    @Property.string({ required: false })
    color?: string | null;
}

/**
 * A tag, which may or may not have a label.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Tag extends BaseEntity {
    /**
     * Groups the tags of one run, so the cases do not read rows of another.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    /**
     * The label, when the tag has one.
     */
    @Property.string({ required: false })
    label?: string | null;

    /**
     * What it carries beside its own columns.
     */
    @Property.object({ cls: () => TagDetails })
    details!: TagDetails;
}

/**
 * A filter on a text property by what it must be, or must not be.
 */
type EqualityFilter = {
    /**
     * The value the property must not be.
     */
    not: string | null
} | {
    /**
     * The values the property has to be one of.
     */
    oneOf: (string | null)[]
} | {
    /**
     * The values the property must not be one of.
     */
    notOneOf: (string | null)[]
} | {
    /**
     * The pattern the property must not be like.
     */
    notLike: string
};

/**
 * Runs every case against the tags of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param tagsOf - Reads the repository, once the data source is started.
 */
export function describeNullValues(dataSourceName: string, tagsOf: () => Repository<Tag>): void {
    describe(`not, oneOf, notOneOf and notLike on a property holding no value, on ${dataSourceName}`, () => {
        const batch: string = UUIDUtilities.generate();

        /**
         * The labels of the tags a filter on the label finds, in order.
         * @param label - The filter on the label.
         * @returns The labels, with an absent one as null.
         */
        async function labelsWhere(label: EqualityFilter): Promise<(string | null)[]> {
            const found: Tag[] = await tagsOf().findAll({ where: { batch, label } });
            return found.map(t => t.label ?? null).sort();
        }

        /**
         * The colors of the tags a filter on the color finds, in order.
         * @param color - The filter on the color.
         * @returns The colors, with an absent one as null.
         */
        async function colorsWhere(color: EqualityFilter): Promise<(string | null)[]> {
            const found: Tag[] = await tagsOf().findAll({ where: { batch, details: { where: { color } } } });
            return found.map(t => t.details.color ?? null).sort();
        }

        beforeAll(async () => {
            await tagsOf().createAll([
                { batch, label: 'a', details: { color: 'red' } },
                { batch, label: 'b', details: { color: 'blue' } },
                { batch, details: {} }
            ]);
        });

        it('finds a row holding no value when oneOf lists null', async () => {
            expect(await labelsWhere({ oneOf: ['a', null] })).toEqual(['a', null]);
            expect(await labelsWhere({ oneOf: [null] })).toEqual([null]);
        });

        it('finds a row holding no value when notOneOf does not list null', async () => {
            // no value is not 'a'
            expect(await labelsWhere({ notOneOf: ['a'] })).toEqual(['b', null]);
        });

        it('leaves out a row holding no value when notOneOf lists null, and keeps every other', async () => {
            expect(await labelsWhere({ notOneOf: ['a', null] })).toEqual(['b']);
            expect(await labelsWhere({ notOneOf: [null] })).toEqual(['a', 'b']);
        });

        it('finds a row holding no value with not, unless not names null', async () => {
            expect(await labelsWhere({ not: 'a' })).toEqual(['b', null]);
            expect(await labelsWhere({ not: null })).toEqual(['a', 'b']);
        });

        it('finds a row holding no value with notLike, since no value is like nothing', async () => {
            expect(await labelsWhere({ notLike: 'a%' })).toEqual(['b', null]);
            expect(await colorsWhere({ notLike: 'r%' })).toEqual(['blue', null]);
        });

        it('answers the same inside a json value', async () => {
            expect(await colorsWhere({ oneOf: ['red', null] })).toEqual([null, 'red']);
            expect(await colorsWhere({ notOneOf: ['red'] })).toEqual(['blue', null]);
            expect(await colorsWhere({ notOneOf: ['red', null] })).toEqual(['blue']);
            expect(await colorsWhere({ notOneOf: [null] })).toEqual(['blue', 'red']);
            expect(await colorsWhere({ not: 'red' })).toEqual(['blue', null]);
            expect(await colorsWhere({ not: null })).toEqual(['blue', 'red']);
        });
    });
}