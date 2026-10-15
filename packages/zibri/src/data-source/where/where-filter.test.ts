/* eslint-disable unicorn/no-null */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { DeepPartial } from '../../types/deep-partial.type';
import { WhereFilter } from '../models/where/where-filter.model';
import { Repository } from '../repository/repository';

// ---------- Test entities ----------

@Entity({ tenant: 'shared' })
class Category extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Product, inverseSide: 'category' })
    products!: Product[];
}

@Entity({ tenant: 'shared' })
class Review extends BaseEntity { // used as an object type for array-of-objects
    @Property.number()
    rating!: number;

    @Property.string()
    comment!: string;
}

class Metadata { // plain object embedded inside Product
    @Property.string()
    color!: string;

    @Property.number()
    weight!: number;
}

@Entity({ tenant: 'shared' })
class Product extends BaseEntity {
    @Property.string({ required: false })
    name: string | undefined | null;

    @Property.number({ required: false })
    price: number | undefined | null;

    @Property.boolean({ required: false })
    inStock: boolean | undefined | null;

    @Property.date({ default: () => new Date(), required: false })
    createdAt: Date | undefined | null;

    @Property.array({ items: { type: 'string' }, required: false })
    tags: string[] | undefined | null;

    @Property.object({ cls: () => Metadata, required: false })
    metadata: Metadata | undefined | null;

    @Property.manyToOne({ target: () => Category, inverseSide: 'products', joinColumn: 'categoryId' })
    category!: Category;

    @Property.string({ format: 'uuid' })
    categoryId!: string;

    @Property.array({ items: { type: 'object', cls: () => Review }, required: false })
    reviews: Review[] | undefined | null;
}

let server: StartedTestServer;
let productRepo: Repository<Product>;
let categoryRepo: Repository<Category>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, Product, Category, Review]
            })
        ]
    });
    productRepo = inject(repositoryTokenFor(Product));
    categoryRepo = inject(repositoryTokenFor(Category));
}, 15000);

afterAll(async () => {
    await server.shutdown();
}, 15000);

beforeEach(async () => {
    await productRepo.deleteAll({});
    await categoryRepo.deleteAll({});
});

// ---------- Helper to create test data ----------
// one product out per product in, in order - said in the type so that destructuring the result gives
// products rather than products that might be missing
async function seedProducts<T extends DeepPartial<Product>[]>(...products: [...T]): Promise<{ [K in keyof T]: Product }> {
    for (const p of products) {
        if (p.category) {
            const cat: Category = await categoryRepo.create(p.category);
            p.categoryId = cat.id;
        }
    }
    const defaultCategory: Category = (await categoryRepo.findAllPaginated(1, 1)).items.at(0) ?? await categoryRepo.create({ name: 'default' });
    const created: Product[] = await Promise.all(
        products.map(p => productRepo.create({ tags: [], reviews: [], inStock: true, categoryId: defaultCategory.id, ...p }))
    );
    return created as { [K in keyof T]: Product };
}

// ---------- Tests ----------
describe('Where filters', () => {

    // =================== STRING ===================
    describe('string', () => {
        let prodA: Product;
        let prodB: Product;

        beforeEach(async () => {
            [prodA, prodB] = await seedProducts(
                { name: 'Alpha', price: 10 },
                { name: 'Beta', price: 20 }
            );
        });

        it('equals', async () => {
            const res: Product[] = await productRepo.findAll({ where: { name: 'Alpha' } });
            expect(res.map(p => p.id)).toEqual([prodA.id]);
        });

        it('not', async () => {
            const res: Product[] = await productRepo.findAll({ where: { name: { not: 'Alpha' } } });
            expect(res.map(p => p.id).sort()).toEqual([prodB.id].sort());
        });

        it('oneOf', async () => {
            const res: Product[] = await productRepo.findAll({ where: { name: { oneOf: ['Alpha', 'Beta'] } } });
            expect(res.map(p => p.id).sort()).toEqual([prodA.id, prodB.id].sort());
        });

        it('notOneOf', async () => {
            const res: Product[] = await productRepo.findAll({ where: { name: { notOneOf: ['Alpha'] } } });
            expect(res.map(p => p.id)).toEqual([prodB.id]);
        });

        it('like', async () => {
            const res: Product[] = await productRepo.findAll({ where: { name: { like: 'Al%' } } });
            expect(res.map(p => p.id)).toEqual([prodA.id]);
        });

        it('iLike', async () => {
            const res: Product[] = await productRepo.findAll({ where: { name: { iLike: 'al%' } } });
            expect(res.map(p => p.id)).toEqual([prodA.id]);
        });

        it('fuzzyLike', async () => {
            // eslint-disable-next-line cspell/spellchecker
            // "Alpha" and "Beta" are seeded. A fuzzy search for "Alpah" (typo) should still match.
            const res: Product[] = await productRepo.findAll({
                // eslint-disable-next-line cspell/spellchecker
                where: { name: { fuzzyLike: { value: 'Alpah', minSimilarity: 30 } } }
            });
            expect(res.map(p => p.id)).toEqual([prodA.id]);
        });

        it('fuzzyLike with low similarity returns nothing', async () => {
            const res: Product[] = await productRepo.findAll({
                where: { name: { fuzzyLike: { value: 'Zzzz', minSimilarity: 90 } } }
            });
            expect(res).toHaveLength(0);
        });

        it('null', async () => {
            await productRepo.updateById(prodA.id, { name: null }); // set to null
            const res: Product[] = await productRepo.findAll({ where: { name: null } });
            expect(res.map(p => p.id)).toEqual([prodA.id]);
        });
    });

    // =================== NUMBER ===================
    describe('number', () => {
        let cheap: Product;
        let mid: Product;
        let expensive: Product;

        beforeEach(async () => {
            [cheap, mid, expensive] = await seedProducts(
                { name: 'c', price: 10 },
                { name: 'm', price: 50 },
                { name: 'e', price: 100 }
            );
        });

        it('equals', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: 50 } });
            expect(res.map(p => p.id)).toEqual([mid.id]);
        });

        it('not', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { not: 50 } } });
            expect(res.map(p => p.id).sort()).toEqual([cheap.id, expensive.id].sort());
        });

        it('oneOf', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { oneOf: [10, 100] } } });
            expect(res.map(p => p.id).sort()).toEqual([cheap.id, expensive.id].sort());
        });

        it('notOneOf', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { notOneOf: [10, 100] } } });
            expect(res.map(p => p.id)).toEqual([mid.id]);
        });

        it('greaterThan', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { greaterThan: 50 } } });
            expect(res.map(p => p.id)).toEqual([expensive.id]);
        });

        it('greaterThanEquals', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { greaterThanEquals: 50 } } });
            expect(res.map(p => p.id).sort()).toEqual([mid.id, expensive.id].sort());
        });

        it('lesserThan', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { lesserThan: 50 } } });
            expect(res.map(p => p.id)).toEqual([cheap.id]);
        });

        it('lesserThanEquals', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { lesserThanEquals: 50 } } });
            expect(res.map(p => p.id).sort()).toEqual([cheap.id, mid.id].sort());
        });

        it('null', async () => {
            await productRepo.updateById(cheap.id, { price: null });
            const res: Product[] = await productRepo.findAll({ where: { price: null } });
            expect(res.map(p => p.id)).toEqual([cheap.id]);
        });
    });

    // =================== BOOLEAN ===================
    describe('boolean', () => {
        let inStock: Product;
        let outOfStock: Product;

        beforeEach(async () => {
            [inStock, outOfStock] = await seedProducts(
                { name: 'a', price: 1, inStock: true },
                { name: 'b', price: 2, inStock: false }
            );
        });

        it('true', async () => {
            const res: Product[] = await productRepo.findAll({ where: { inStock: true } });
            expect(res.map(p => p.id)).toEqual([inStock.id]);
        });

        it('false', async () => {
            const res: Product[] = await productRepo.findAll({ where: { inStock: false } });
            expect(res.map(p => p.id)).toEqual([outOfStock.id]);
        });

        it('null', async () => {
            await productRepo.updateById(inStock.id, { inStock: null });
            const res: Product[] = await productRepo.findAll({ where: { inStock: null } });
            expect(res.map(p => p.id)).toEqual([inStock.id]);
        });
    });

    // =================== DATE ===================
    describe('date', () => {
        let early: Product;
        let late: Product;
        const earlyCreatedAt: Date = new Date('2025-01-01');
        const lateCreatedAt: Date = new Date('2026-01-01');

        beforeEach(async () => {
            [early, late] = await seedProducts(
                { name: 'early', price: 1, createdAt: earlyCreatedAt },
                { name: 'late', price: 2, createdAt: lateCreatedAt }
            );
        });

        it('equals', async () => {
            const res: Product[] = await productRepo.findAll({ where: { createdAt: early.createdAt } });
            expect(res.map(p => p.id)).toEqual([early.id]);
        });

        it('not', async () => {
            const res: Product[] = await productRepo.findAll({ where: { createdAt: { not: early.createdAt } } });
            expect(res.map(p => p.id)).toEqual([late.id]);
        });

        it('oneOf', async () => {
            const res: Product[] = await productRepo.findAll({ where: { createdAt: { oneOf: [earlyCreatedAt, lateCreatedAt] } } });
            expect(res.map(p => p.id).sort()).toEqual([early.id, late.id].sort());
        });

        it('notOneOf', async () => {
            const res: Product[] = await productRepo.findAll({ where: { createdAt: { notOneOf: [earlyCreatedAt] } } });
            expect(res.map(p => p.id)).toEqual([late.id]);
        });

        it('after', async () => {
            const res: Product[] = await productRepo.findAll({ where: { createdAt: { after: earlyCreatedAt } } });
            expect(res.map(p => p.id)).toEqual([late.id]);
        });

        it('before', async () => {
            const res: Product[] = await productRepo.findAll({ where: { createdAt: { before: lateCreatedAt } } });
            expect(res.map(p => p.id)).toEqual([early.id]);
        });

        it('null', async () => {
            await productRepo.updateById(early.id, { createdAt: null });
            const res: Product[] = await productRepo.findAll({ where: { createdAt: null } });
            expect(res.map(p => p.id)).toEqual([early.id]);
        });
    });

    // =================== ARRAY (of strings) ===================
    describe('array (string)', () => {
        let prodA: Product;

        beforeEach(async () => {
            [prodA] = await seedProducts(
                { name: 'a', price: 1, tags: ['tag1', 'tag2'] },
                { name: 'b', price: 2, tags: ['tag3'] }
            );
        });

        it('equals (exact array)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { tags: ['tag1', 'tag2'] } });
            expect(res.map(p => p.id)).toEqual([prodA.id]);
        });

        it('includes (contains all specified items)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { tags: { includes: ['tag1'] } } });
            expect(res.map(p => p.id)).toEqual([prodA.id]);
        });

        it('isIncludedIn (all items of the property are subset of given list)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { tags: { isIncludedIn: ['tag1', 'tag2', 'extra'] } } });
            expect(res.map(p => p.id)).toEqual([prodA.id]); // prodA's tags are subset
            // prodB has ['tag3'] which is not subset of ['tag1','tag2','extra'] -> not returned
        });

        it('null', async () => {
            await productRepo.updateById(prodA.id, { tags: null });
            const res: Product[] = await productRepo.findAll({ where: { tags: null } });
            expect(res.map(p => p.id)).toEqual([prodA.id]);
        });
    });

    // =================== OBJECT (embedded) ===================
    describe('object (Metadata)', () => {
        let prodRed: Product;
        let prodBlue: Product;

        beforeEach(async () => {
            [prodRed, prodBlue] = await seedProducts(
                { name: 'red', price: 1, metadata: { color: 'red', weight: 100 } },
                { name: 'blue', price: 2, metadata: { color: 'blue', weight: 200 } }
            );
        });

        it('equals (exact match)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { metadata: { is: { color: 'red', weight: 100 } } } });
            expect(res.map(p => p.id)).toEqual([prodRed.id]);
        });

        it('where (nested filter)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { metadata: { where: { color: 'red' } } } });
            // Should treat the nested where as filtering on the JSON's properties
            // That depends on how TypeORM handles JSON columns; we assume the framework maps it correctly.
            // In a strict behavioral test, we just validate the result.
            expect(res.map(p => p.id)).toEqual([prodRed.id]);
        });

        it('not', async () => {
            const res: Product[] = await productRepo.findAll({ where: { metadata: { not: { color: 'red', weight: 100 } } } });
            expect(res.map(p => p.id)).toEqual([prodBlue.id]);
        });

        it('oneOf', async () => {
            const res: Product[] = await productRepo.findAll({ where: { metadata: { oneOf: [{ color: 'red', weight: 100 }, { color: 'blue', weight: 200 }] } } });
            expect(res.map(p => p.id).sort()).toEqual([prodRed.id, prodBlue.id].sort());
        });

        it('notOneOf', async () => {
            const res: Product[] = await productRepo.findAll({ where: { metadata: { notOneOf: [{ color: 'red', weight: 100 }] } } });
            expect(res.map(p => p.id)).toEqual([prodBlue.id]);
        });

        it('null', async () => {
            await productRepo.updateById(prodRed.id, { metadata: null });
            const res: Product[] = await productRepo.findAll({ where: { metadata: { is: null } } });
            expect(res.map(p => p.id)).toEqual([prodRed.id]);
        });
    });

    // =================== RELATION (Category) ===================
    describe('relation (Category)', () => {
        let catFood: Category;
        let catToys: Category;
        let prodFood: Product;

        beforeEach(async () => {
            catFood = await categoryRepo.create({ name: 'Food' });
            catToys = await categoryRepo.create({ name: 'Toys' });
            [prodFood] = await seedProducts(
                { name: 'Kibble', price: 5, category: catFood },
                { name: 'Ball', price: 3, category: catToys }
            );
        });

        it('filter by relation property (where on nested object)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { category: { where: { name: 'Food' } } } });
            expect(res.map(p => p.id)).toEqual([prodFood.id]);
        });

        it('filter by relation id (equals with id)', async () => {
            // `equals` on a relation should filter by the primary key of the related entity
            const res: Product[] = await productRepo.findAll({ where: { category: { is: catFood } } });
            expect(res.map(p => p.id)).toEqual([prodFood.id]);
        });
    });

    // =================== ARRAY OF OBJECTS (Review[]) ===================
    describe('array of objects', () => {
        let prodA: Product;
        let prodB: Product;

        beforeEach(async () => {
            [prodA, prodB] = await seedProducts(
                { name: 'a', price: 1, reviews: [{ rating: 5, comment: 'Great' }, { rating: 4, comment: 'Good' }] },
                { name: 'b', price: 2, reviews: [{ rating: 2, comment: 'Bad' }] }
            );
        });

        it('includes (contains all specified objects)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { reviews: { where: [{ rating: 5, comment: 'Great' }] } } });
            expect(res.map(p => p.id)).toEqual([prodA.id]);
        });

        it('isIncludedIn (all items of the array are subset of given list)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { reviews: { where: [{ rating: 5, comment: 'Great' }, { rating: 4, comment: 'Good' }, { rating: 2, comment: 'Bad' }] } } });
            expect(res.map(p => p.id).sort()).toEqual([prodA.id, prodB.id].sort());
        });

        it('null', async () => {
            await productRepo.updateById(prodA.id, { reviews: null });
            const res: Product[] = await productRepo.findAll({ where: { reviews: null } });
            expect(res.map(p => p.id)).toEqual([prodA.id]);
        });
    });

    // =================== OR (array of filters) ===================
    describe('OR combination', () => {
        let prodA: Product;
        let prodB: Product;
        let prodC: Product;

        beforeEach(async () => {
            [prodA, prodB, prodC] = await seedProducts(
                { name: 'A', price: 1 },
                { name: 'B', price: 2 },
                { name: 'C', price: 3 }
            );
        });

        it('returns entities matching any of the filters', async () => {
            const filters: WhereFilter<Product>[] = [
                { name: 'A' },
                { price: 3 }
            ];
            const res: Product[] = await productRepo.findAll({ where: filters });
            expect(res.map(p => p.id).sort()).toEqual([prodA.id, prodC.id].sort());
        });

        it('multiple complex filters', async () => {
            const filters: WhereFilter<Product>[] = [
                { name: { like: 'A' }, price: 1 },
                { name: { like: 'B' }, price: { greaterThan: 1 } }
            ];
            const res: Product[] = await productRepo.findAll({ where: filters });
            expect(res.map(p => p.id).sort()).toEqual([prodA.id, prodB.id].sort());
        });
    });

    // =================== MULTIPLE CONDITIONS ON A SINGLE COLUMN (AND) ===================
    // Multiple keys inside a single filter object are combined with AND, so all of them
    // have to match for the entity to be returned.
    describe('multiple conditions on a single column', () => {
        let cheap: Product;
        let mid: Product;
        let expensive: Product;
        const cheapCreatedAt: Date = new Date('2025-01-01');
        const midCreatedAt: Date = new Date('2025-06-01');
        const expensiveCreatedAt: Date = new Date('2026-01-01');

        beforeEach(async () => {
            [cheap, mid, expensive] = await seedProducts(
                { name: 'Alpha', price: 10, createdAt: cheapCreatedAt, metadata: { color: 'red', weight: 100 } },
                { name: 'Alpine', price: 50, createdAt: midCreatedAt, metadata: { color: 'red', weight: 200 } },
                { name: 'Beta', price: 100, createdAt: expensiveCreatedAt, metadata: { color: 'blue', weight: 300 } }
            );
        });

        it('number range (greaterThan + lesserThan)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { greaterThan: 10, lesserThan: 100 } } });
            expect(res.map(p => p.id)).toEqual([mid.id]);
        });

        it('number range including the bounds (greaterThanEquals + lesserThanEquals)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { greaterThanEquals: 10, lesserThanEquals: 50 } } });
            expect(res.map(p => p.id).sort()).toEqual([cheap.id, mid.id].sort());
        });

        it('number range combined with an exclusion (greaterThanEquals + notOneOf)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { greaterThanEquals: 10, notOneOf: [50] } } });
            expect(res.map(p => p.id).sort()).toEqual([cheap.id, expensive.id].sort());
        });

        it('mutually exclusive conditions return nothing (proves AND, not OR)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { lesserThan: 10, greaterThan: 100 } } });
            expect(res).toHaveLength(0);
        });

        it('string (like + not)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { name: { like: 'Al%', not: 'Alpha' } } });
            expect(res.map(p => p.id)).toEqual([mid.id]);
        });

        it('string (iLike + notOneOf)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { name: { iLike: 'al%', notOneOf: ['Alpine'] } } });
            expect(res.map(p => p.id)).toEqual([cheap.id]);
        });

        it('date range (after + before)', async () => {
            const res: Product[] = await productRepo.findAll({ where: { createdAt: { after: cheapCreatedAt, before: expensiveCreatedAt } } });
            expect(res.map(p => p.id)).toEqual([mid.id]);
        });

        it('oneOf combined with a range', async () => {
            const res: Product[] = await productRepo.findAll({ where: { price: { oneOf: [10, 50, 100], greaterThan: 10, lesserThan: 100 } } });
            expect(res.map(p => p.id)).toEqual([mid.id]);
        });

        it('inside a nested object filter (JSONB)', async () => {
            const res: Product[] = await productRepo.findAll({
                where: { metadata: { where: { weight: { greaterThan: 100, lesserThanEquals: 200 } } } }
            });
            expect(res.map(p => p.id)).toEqual([mid.id]);
        });

        it('multiple columns each with multiple conditions', async () => {
            const res: Product[] = await productRepo.findAll({
                where: {
                    name: { like: 'Al%', not: 'Alpha' },
                    price: { greaterThan: 10, lesserThan: 100 }
                }
            });
            expect(res.map(p => p.id)).toEqual([mid.id]);
        });

        it('combined with OR across filters', async () => {
            const filters: WhereFilter<Product>[] = [
                { price: { greaterThan: 10, lesserThan: 100 } },
                { name: { like: 'B%', not: 'Bravo' } }
            ];
            const res: Product[] = await productRepo.findAll({ where: filters });
            expect(res.map(p => p.id).sort()).toEqual([mid.id, expensive.id].sort());
        });
    });

    // =================== INVALID FILTERS (defensive InternalError checks) ===================
    // These filters are shaped to violate WhereFilter's own compile-time types (eg. a string where
    // "oneOf" must be an array), simulating what an untyped caller (eg. a raw HTTP JSON body) could
    // send at runtime — hence the `as unknown as WhereFilter<Product>` casts, which are load-bearing
    // here rather than a typing shortcut.
    describe('invalid filters throw InternalError instead of silently misbehaving', () => {
        beforeEach(async () => {
            await seedProducts({ name: 'Alpha', price: 10, tags: ['tag1'], metadata: { color: 'red', weight: 100 } });
        });

        it('oneOf on a string field must be an array', async () => {
            const where: WhereFilter<Product> = { name: { oneOf: 'not-an-array' } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow('needs to be an array');
        });

        it('notOneOf on a string field must be an array', async () => {
            const where: WhereFilter<Product> = { name: { notOneOf: 'not-an-array' } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow('needs to be an array');
        });

        it('includes on an array field must be an array', async () => {
            const where: WhereFilter<Product> = { tags: { includes: 'not-an-array' } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow('needs to be an array');
        });

        it('isIncludedIn on an array field must be an array', async () => {
            const where: WhereFilter<Product> = { tags: { isIncludedIn: 'not-an-array' } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow('needs to be an array');
        });

        it('"where" is rejected on a property without nested metadata (eg. a plain string)', async () => {
            const where: WhereFilter<Product> = { name: { where: { anything: true } } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow('not supported on this property without nested metadata');
        });

        it('rejects an empty where filter object', async () => {
            const where: WhereFilter<Product> = { name: {} } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow('Empty where filter');
        });

        it('rejects an unknown filter key', async () => {
            const where: WhereFilter<Product> = { name: { bogusOperator: 'x' } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow(/Unknown key/);
        });

        it('"where" on an array of primitives (not objects) is rejected', async () => {
            const where: WhereFilter<Product> = { tags: { where: [{ anything: true }] } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow('requires an array of objects');
        });

        it('fuzzyLike on a plain string column requires an object with a "value" property', async () => {
            const where: WhereFilter<Product> = { name: { fuzzyLike: 'not-an-object' } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow('fuzzyLike expects an object');
        });

        // ---- JSONB-nested variants (go through the postgres-specific JSONB operator handlers) ----

        it('oneOf inside a JSONB nested filter must be an array', async () => {
            const where: WhereFilter<Product> = { metadata: { where: { color: { oneOf: 'not-an-array' } } } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow(/must be an array/);
        });

        it('notOneOf inside a JSONB nested filter must be an array', async () => {
            const where: WhereFilter<Product> = { metadata: { where: { color: { notOneOf: 'not-an-array' } } } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow(/must be an array/);
        });

        it('includes inside a JSONB nested filter must be an array', async () => {
            const where: WhereFilter<Product> = { metadata: { where: { color: { includes: 'not-an-array' } } } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow(/must be an array/);
        });

        it('isIncludedIn inside a JSONB nested filter must be an array', async () => {
            const where: WhereFilter<Product> = { metadata: { where: { color: { isIncludedIn: 'not-an-array' } } } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow(/must be an array/);
        });

        it('fuzzyLike inside a JSONB nested filter requires an object with a "value" property', async () => {
            const where: WhereFilter<Product> = { metadata: { where: { color: { fuzzyLike: 'not-an-object' } } } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow('fuzzyLike expects an object');
        });

        it('rejects an unknown operator inside a JSONB nested filter', async () => {
            const where: WhereFilter<Product> = { metadata: { where: { color: { bogusOperator: 'x' } } } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow(/Unknown JSONB filter operator/);
        });

        it('"where" on a non-object, non-array JSONB field is rejected', async () => {
            const where: WhereFilter<Product> = { metadata: { where: { weight: { where: { anything: true } } } } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow(/non-object, non-array JSONB field/);
        });

        it('rejects a JSONB filter value that cannot be bound', async () => {
            // there is no such thing as a sql literal here any more - values are bound - so what is
            // refused is a value no column could hold rather than one that could not be escaped
            const where: WhereFilter<Product> = { metadata: { where: { color: { oneOf: [{ nested: true }] } } } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow(/Cannot use a value of type "object"/);
        });

        it('rejects a JSONB filter value of an unsupported runtime type (eg. a function)', async () => {
            const where: WhereFilter<Product> = { metadata: { where: { color: (() => undefined) as unknown as string } } } as unknown as WhereFilter<Product>;
            await expect(productRepo.findAll({ where })).rejects.toThrow(/Unexpected JSONB filter value/);
        });
    });
});