/* eslint-disable unicorn/no-null */
import { beforeAll, describe, expect, it } from 'vitest';

import { WhereFilterEvaluator } from './where-filter.evaluator.ts';
import { initDiContainer } from '../../../di/init-di-container.function.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../../entity/models/relation.type.ts';
import { Where } from '../../models/where/where-filter.model.ts';

@Entity({ tenant: 'shared', allowOrphan: true })
class EvaluatorCategory extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => EvaluatorProduct, inverseSide: 'category' })
    products!: EvaluatorProduct[];
}

@Entity({ tenant: 'shared', allowOrphan: true })
class EvaluatorReview extends BaseEntity {
    @Property.number()
    rating!: number;

    @Property.string()
    comment!: string;
}

class EvaluatorMetadata {
    @Property.string()
    color!: string;

    @Property.number()
    weight!: number;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class EvaluatorProduct extends BaseEntity {
    @Property.string({ required: false })
    name: string | undefined | null;

    @Property.number({ required: false })
    price: number | undefined | null;

    @Property.boolean({ required: false })
    inStock: boolean | undefined | null;

    @Property.date({ required: false })
    createdAt: Date | undefined | null;

    @Property.array({ items: { type: 'string' }, required: false })
    tags: string[] | undefined | null;

    @Property.object({ cls: () => EvaluatorMetadata, required: false })
    metadata: EvaluatorMetadata | undefined | null;

    @Property.manyToOne({ target: () => EvaluatorCategory, inverseSide: 'products', joinColumn: 'categoryId' })
    category!: Relation<EvaluatorCategory>;

    @Property.string({ format: 'uuid' })
    categoryId!: string;

    @Property.array({ items: { type: 'object', cls: () => EvaluatorReview }, required: false })
    reviews: EvaluatorReview[] | undefined | null;
}

const evaluator: WhereFilterEvaluator = new WhereFilterEvaluator();

function product(data: Partial<EvaluatorProduct>): EvaluatorProduct {
    return { id: 'id', categoryId: 'category-id', ...data } as EvaluatorProduct;
}

function matches(item: Partial<EvaluatorProduct>, filter: Where<EvaluatorProduct>): boolean {
    return evaluator.matches(product(item), filter, EvaluatorProduct);
}

describe('WhereFilterEvaluator', () => {
    // text is ordered by the application's locale, which is a registered option rather than a
    // constant - so comparing text at all needs the container the application reads it from
    beforeAll(() => {
        initDiContainer();
    });

    describe('string', () => {
        it('equals', () => {
            expect(matches({ name: 'Alpha' }, { name: 'Alpha' })).toBe(true);
            expect(matches({ name: 'Beta' }, { name: 'Alpha' })).toBe(false);
        });

        it('not', () => {
            expect(matches({ name: 'Beta' }, { name: { not: 'Alpha' } })).toBe(true);
            expect(matches({ name: 'Alpha' }, { name: { not: 'Alpha' } })).toBe(false);
        });

        it('not matches a null value, which is not the value named', () => {
            expect(matches({ name: null }, { name: { not: 'Alpha' } })).toBe(true);
        });

        it('not null matches everything that is set', () => {
            expect(matches({ name: 'Alpha' }, { name: { not: null } })).toBe(true);
            expect(matches({ name: null }, { name: { not: null } })).toBe(false);
        });

        it('oneOf', () => {
            expect(matches({ name: 'Alpha' }, { name: { oneOf: ['Alpha', 'Beta'] } })).toBe(true);
            expect(matches({ name: 'Gamma' }, { name: { oneOf: ['Alpha', 'Beta'] } })).toBe(false);
        });

        it('notOneOf', () => {
            expect(matches({ name: 'Gamma' }, { name: { notOneOf: ['Alpha'] } })).toBe(true);
            expect(matches({ name: 'Alpha' }, { name: { notOneOf: ['Alpha'] } })).toBe(false);
        });

        it('like', () => {
            expect(matches({ name: 'Alpha' }, { name: { like: 'Al%' } })).toBe(true);
            expect(matches({ name: 'Beta' }, { name: { like: 'Al%' } })).toBe(false);
            expect(matches({ name: 'Alpha' }, { name: { like: 'al%' } })).toBe(false);
        });

        it('like supports the single character wildcard', () => {
            // cspell:disable-next-line
            expect(matches({ name: 'Alpha' }, { name: { like: 'Alph_' } })).toBe(true);
            // cspell:disable-next-line
            expect(matches({ name: 'Alphaa' }, { name: { like: 'Alph_' } })).toBe(false);
        });

        it('like escapes regex special characters', () => {
            expect(matches({ name: 'a.c' }, { name: { like: 'a.c' } })).toBe(true);
            expect(matches({ name: 'abc' }, { name: { like: 'a.c' } })).toBe(false);
        });

        it('iLike', () => {
            expect(matches({ name: 'Alpha' }, { name: { iLike: 'al%' } })).toBe(true);
            expect(matches({ name: 'Beta' }, { name: { iLike: 'al%' } })).toBe(false);
        });

        it('fuzzyLike matches typos', () => {
            // cspell:disable-next-line
            expect(matches({ name: 'Alpha' }, { name: { fuzzyLike: { value: 'Alpah' } } })).toBe(true);
            // cspell:disable-next-line
            expect(matches({ name: 'Zebra' }, { name: { fuzzyLike: { value: 'Alpah' } } })).toBe(false);
        });

        it('fuzzyLike respects minSimilarity', () => {
            // cspell:disable-next-line
            expect(matches({ name: 'Alpha' }, { name: { fuzzyLike: { value: 'Alpah', minSimilarity: 99 } } })).toBe(false);
            expect(matches({ name: 'Alpha' }, { name: { fuzzyLike: { value: 'Alpha', minSimilarity: 99 } } })).toBe(true);
        });

        it('null', () => {
            expect(matches({ name: null }, { name: null })).toBe(true);
            expect(matches({ name: 'Alpha' }, { name: null })).toBe(false);
        });

        // several patterns are a value that is like every one of them, which one pattern cannot say
        it('requires every pattern of a like that names several', () => {
            expect(matches({ name: 'rent 2026' }, { name: { like: ['rent%', '%2026'] } })).toBe(true);
            expect(matches({ name: 'rent 2025' }, { name: { like: ['rent%', '%2026'] } })).toBe(false);
            expect(matches({ name: 'power 2026' }, { name: { like: ['rent%', '%2026'] } })).toBe(false);
        });

        it('requires every pattern of an iLike and of a fuzzyLike that name several', () => {
            expect(matches({ name: 'Rent 2026' }, { name: { iLike: ['rent%', '%2026'] } })).toBe(true);
            expect(matches({ name: 'Rent 2025' }, { name: { iLike: ['rent%', '%2026'] } })).toBe(false);
            // cspell:disable-next-line
            expect(matches({ name: 'Alpha' }, { name: { fuzzyLike: [{ value: 'Alpah' }, { value: 'Alpha' }] } })).toBe(true);
            // cspell:disable-next-line
            expect(matches({ name: 'Alpha' }, { name: { fuzzyLike: [{ value: 'Alpah' }, { value: 'Zebra' }] } })).toBe(false);
        });

        // the application orders text, so a comparison made here answers what the same comparison
        // answers in a database whose columns carry that order
        it('orders text alphabetically rather than by the bytes it is written with', () => {
            // 'B' is the lower byte and the later letter, which is the whole difference between
            // ordering text and ordering what it is stored as
            expect(matches({ name: 'Bravo' }, { name: { after: 'alpha' } })).toBe(true);
            expect(matches({ name: 'alpha' }, { name: { after: 'Bravo' } })).toBe(false);
            // case decides only between two texts that are otherwise the same, and lowercase first
            expect(matches({ name: 'Alpha' }, { name: { after: 'alpha' } })).toBe(true);
        });

        it('combines multiple operators with and', () => {
            expect(matches({ name: 'Alpha42' }, { name: { iLike: '%42', not: '42' } })).toBe(true);
            expect(matches({ name: '42' }, { name: { iLike: '%42', not: '42' } })).toBe(false);
        });

        it('treats an array of filters as or', () => {
            const filter: Where<EvaluatorProduct> = { name: [{ iLike: '%42', not: '42' }, '43'] };
            expect(matches({ name: 'Alpha42' }, filter)).toBe(true);
            expect(matches({ name: '43' }, filter)).toBe(true);
            expect(matches({ name: '42' }, filter)).toBe(false);
        });
    });

    describe('number', () => {
        it('equals and comparisons', () => {
            expect(matches({ price: 10 }, { price: 10 })).toBe(true);
            expect(matches({ price: 20 }, { price: { greaterThan: 10 } })).toBe(true);
            expect(matches({ price: 10 }, { price: { greaterThan: 10 } })).toBe(false);
            expect(matches({ price: 10 }, { price: { greaterThanEquals: 10 } })).toBe(true);
            expect(matches({ price: 5 }, { price: { lesserThan: 10 } })).toBe(true);
            expect(matches({ price: 10 }, { price: { lesserThanEquals: 10 } })).toBe(true);
        });

        it('comparisons never match null, mirroring sql', () => {
            expect(matches({ price: null }, { price: { greaterThan: 10 } })).toBe(false);
            expect(matches({ price: null }, { price: { lesserThan: 10 } })).toBe(false);
        });

        it('null', () => {
            expect(matches({ price: null }, { price: null })).toBe(true);
            expect(matches({ price: 10 }, { price: null })).toBe(false);
        });
    });

    describe('boolean', () => {
        it('equals', () => {
            expect(matches({ inStock: true }, { inStock: true })).toBe(true);
            expect(matches({ inStock: false }, { inStock: true })).toBe(false);
        });

        it('not', () => {
            expect(matches({ inStock: false }, { inStock: { not: true } })).toBe(true);
        });

        it('null', () => {
            expect(matches({ inStock: null }, { inStock: null })).toBe(true);
        });
    });

    describe('date', () => {
        const early: Date = new Date('2020-01-01T00:00:00.000Z');
        const late: Date = new Date('2024-01-01T00:00:00.000Z');

        it('after and before', () => {
            expect(matches({ createdAt: late }, { createdAt: { after: early } })).toBe(true);
            expect(matches({ createdAt: early }, { createdAt: { after: early } })).toBe(false);
            expect(matches({ createdAt: early }, { createdAt: { before: late } })).toBe(true);
            expect(matches({ createdAt: early }, { createdAt: { afterOrOn: early } })).toBe(true);
            expect(matches({ createdAt: late }, { createdAt: { beforeOrOn: late } })).toBe(true);
        });

        it('equals', () => {
            expect(matches({ createdAt: early }, { createdAt: new Date(early) })).toBe(true);
            expect(matches({ createdAt: late }, { createdAt: new Date(early) })).toBe(false);
        });

        it('compares dates that have been read back as iso strings', () => {
            const item: EvaluatorProduct = product({});
            (item as unknown as Record<string, unknown>)['createdAt'] = early.toISOString();
            expect(evaluator.matches(item, { createdAt: early }, EvaluatorProduct)).toBe(true);
            expect(evaluator.matches(item, { createdAt: { before: late } }, EvaluatorProduct)).toBe(true);
        });

        it('null', () => {
            expect(matches({ createdAt: null }, { createdAt: null })).toBe(true);
        });
    });

    describe('array of primitives', () => {
        it('equals an exact array', () => {
            expect(matches({ tags: ['tag1', 'tag2'] }, { tags: ['tag1', 'tag2'] })).toBe(true);
            expect(matches({ tags: ['tag2', 'tag1'] }, { tags: ['tag1', 'tag2'] })).toBe(false);
            expect(matches({ tags: ['tag1'] }, { tags: ['tag1', 'tag2'] })).toBe(false);
        });

        it('includes all of the given items', () => {
            expect(matches({ tags: ['tag1', 'tag2'] }, { tags: { includes: ['tag1'] } })).toBe(true);
            expect(matches({ tags: ['tag3'] }, { tags: { includes: ['tag1'] } })).toBe(false);
            expect(matches({ tags: ['tag1'] }, { tags: { includes: ['tag1', 'tag2'] } })).toBe(false);
        });

        it('isIncludedIn the given items', () => {
            expect(matches({ tags: ['tag1', 'tag2'] }, { tags: { isIncludedIn: ['tag1', 'tag2', 'extra'] } })).toBe(true);
            expect(matches({ tags: ['tag3'] }, { tags: { isIncludedIn: ['tag1', 'tag2', 'extra'] } })).toBe(false);
        });

        it('length operators', () => {
            expect(matches({ tags: ['a', 'b'] }, { tags: { length: 2 } })).toBe(true);
            expect(matches({ tags: ['a', 'b'] }, { tags: { lengthGreaterThan: 1 } })).toBe(true);
            expect(matches({ tags: ['a', 'b'] }, { tags: { lengthGreaterThanEquals: 2 } })).toBe(true);
            expect(matches({ tags: ['a', 'b'] }, { tags: { lengthLesserThan: 3 } })).toBe(true);
            expect(matches({ tags: ['a', 'b'] }, { tags: { lengthLesserThanEquals: 2 } })).toBe(true);
            expect(matches({ tags: ['a', 'b'] }, { tags: { length: 3 } })).toBe(false);
        });

        it('null', () => {
            expect(matches({ tags: null }, { tags: null })).toBe(true);
        });
    });

    describe('embedded object', () => {
        it('is (exact match)', () => {
            expect(matches({ metadata: { color: 'red', weight: 100 } }, { metadata: { is: { color: 'red', weight: 100 } } })).toBe(true);
            expect(matches({ metadata: { color: 'blue', weight: 200 } }, { metadata: { is: { color: 'red', weight: 100 } } })).toBe(false);
        });

        it('where (nested filter)', () => {
            expect(matches({ metadata: { color: 'red', weight: 100 } }, { metadata: { where: { color: 'red' } } })).toBe(true);
            expect(matches({ metadata: { color: 'blue', weight: 200 } }, { metadata: { where: { color: 'red' } } })).toBe(false);
        });

        it('where supports nested operators', () => {
            expect(matches({ metadata: { color: 'red', weight: 100 } }, { metadata: { where: { weight: { greaterThan: 50 } } } })).toBe(true);
            expect(matches({ metadata: { color: 'red', weight: 10 } }, { metadata: { where: { weight: { greaterThan: 50 } } } })).toBe(false);
        });

        it('not', () => {
            expect(matches({ metadata: { color: 'blue', weight: 200 } }, { metadata: { not: { color: 'red', weight: 100 } } })).toBe(true);
            expect(matches({ metadata: { color: 'red', weight: 100 } }, { metadata: { not: { color: 'red', weight: 100 } } })).toBe(false);
        });

        it('oneOf and notOneOf', () => {
            const oneOf: Where<EvaluatorProduct> = { metadata: { oneOf: [{ color: 'red', weight: 100 }, { color: 'blue', weight: 200 }] } };
            expect(matches({ metadata: { color: 'blue', weight: 200 } }, oneOf)).toBe(true);
            expect(matches({ metadata: { color: 'green', weight: 1 } }, oneOf)).toBe(false);
            expect(matches({ metadata: { color: 'blue', weight: 200 } }, { metadata: { notOneOf: [{ color: 'red', weight: 100 }] } })).toBe(true);
        });

        it('is null', () => {
            expect(matches({ metadata: null }, { metadata: { is: null } })).toBe(true);
            expect(matches({ metadata: { color: 'red', weight: 100 } }, { metadata: { is: null } })).toBe(false);
        });
    });

    describe('array of objects', () => {
        it('where matches when at least one item matches', () => {
            const item: Partial<EvaluatorProduct> = {
                reviews: [
                    { id: 'r1', rating: 1, comment: 'bad' },
                    { id: 'r2', rating: 5, comment: 'good' }
                ]
            };
            expect(matches(item, { reviews: { where: { rating: 5 } } })).toBe(true);
            expect(matches(item, { reviews: { where: { rating: 3 } } })).toBe(false);
            expect(matches(item, { reviews: { where: { rating: { greaterThan: 4 } } } })).toBe(true);
        });

        it('length operators', () => {
            const item: Partial<EvaluatorProduct> = {
                reviews: [{ id: 'r1', rating: 1, comment: 'bad' }]
            };
            expect(matches(item, { reviews: { length: 1 } })).toBe(true);
            expect(matches(item, { reviews: { lengthGreaterThan: 1 } })).toBe(false);
        });

        it('null', () => {
            expect(matches({ reviews: null }, { reviews: null })).toBe(true);
        });
    });

    describe('relations', () => {
        it('filters by a resolved to one relation', () => {
            const food: EvaluatorCategory = { id: 'c1', name: 'Food' } as EvaluatorCategory;
            const toys: EvaluatorCategory = { id: 'c2', name: 'Toys' } as EvaluatorCategory;
            expect(matches({ category: food }, { category: { where: { name: 'Food' } } })).toBe(true);
            expect(matches({ category: toys }, { category: { where: { name: 'Food' } } })).toBe(false);
        });

        it('unwraps a full entity when filtering with is', () => {
            const food: EvaluatorCategory = { id: 'c1', name: 'Food' } as EvaluatorCategory;
            const item: EvaluatorProduct = product({ category: food });
            (item as unknown as Record<string, unknown>)['category'] = 'c1';
            expect(evaluator.matches(item, { category: { is: food } }, EvaluatorProduct)).toBe(true);
        });

        it('filters by a resolved to many relation', () => {
            const category: EvaluatorCategory = {
                id: 'c1',
                name: 'Food',
                products: [product({ name: 'Kibble' }), product({ name: 'Ball' })]
            };
            expect(evaluator.matches(category, { products: { where: { name: 'Ball' } } }, EvaluatorCategory)).toBe(true);
            expect(evaluator.matches(category, { products: { where: { name: 'Bone' } } }, EvaluatorCategory)).toBe(false);
            expect(evaluator.matches(category, { products: { length: 2 } }, EvaluatorCategory)).toBe(true);
        });
    });

    describe('filter composition', () => {
        it('combines multiple properties with and', () => {
            expect(matches({ name: 'Alpha', price: 10 }, { name: 'Alpha', price: 10 })).toBe(true);
            expect(matches({ name: 'Alpha', price: 20 }, { name: 'Alpha', price: 10 })).toBe(false);
        });

        it('combines a top level array of filters with or', () => {
            const filter: Where<EvaluatorProduct> = [{ name: 'Alpha' }, { price: 20 }];
            expect(matches({ name: 'Alpha', price: 1 }, filter)).toBe(true);
            expect(matches({ name: 'Beta', price: 20 }, filter)).toBe(true);
            expect(matches({ name: 'Beta', price: 1 }, filter)).toBe(false);
        });

        it('ignores properties that are explicitly undefined', () => {
            expect(matches({ name: 'Alpha' }, { name: 'Alpha', price: undefined })).toBe(true);
        });

        it('matches everything for an empty filter', () => {
            expect(matches({ name: 'Alpha' }, {})).toBe(true);
        });

        it('throws for an unknown filter key', () => {
            expect(() => matches({ name: 'Alpha' }, { name: { unknownKey: 'x' } } as unknown as Where<EvaluatorProduct>))
                .toThrow(/Unknown key "unknownKey"/);
        });

        it('throws for an empty filter object on a property', () => {
            expect(() => matches({ name: 'Alpha' }, { name: {} }))
                .toThrow(/Empty where filter/);
        });
    });
});