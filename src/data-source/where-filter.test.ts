/* eslint-disable unicorn/no-null */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { WhereFilter } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { DeepPartial } from '../types/deep-partial.type';

// ---------- Test entities ----------

@Entity()
class Category extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Product, inverseSide: 'category' })
    products!: Product[];
}

@Entity()
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

@Entity()
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
});

beforeEach(async () => {
    await productRepo.deleteAll({});
    await categoryRepo.deleteAll({});
});

// ---------- Helper to create test data ----------
async function seedProducts(...products: DeepPartial<Product>[]): Promise<Product[]> {
    for (const p of products) {
        if (p.category) {
            const cat: Category = await categoryRepo.create(p.category);
            p.categoryId = cat.id;
        }
    }
    const defaultCategory: Category = (await categoryRepo.findAllPaginated(1, 1)).items.at(0) ?? await categoryRepo.create({ name: 'default' });
    return Promise.all(products.map(p => productRepo.create({ tags: [], reviews: [], inStock: true, categoryId: defaultCategory.id, ...p })));
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

        // TODO
        // it('null (no category)', async () => {
        //     await productRepo.updateById(prodFood.id, { category: null });
        //     const res: Product[] = await productRepo.findAll({ where: { category: null } });
        //     expect(res.map(p => p.id)).toEqual([prodFood.id]);
        // });
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
});