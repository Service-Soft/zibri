import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { type Relation } from 'typeorm';

import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
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

    @Property.manyToMany({ target: () => Post, inverseSide: 'categories', joinTable: false })
    posts!: Post[];
}

@Entity()
class Comment extends BaseEntity {
    @Property.string()
    text!: string;

    @Property.manyToOne({ target: () => Post, inverseSide: 'comments', joinColumn: 'postId' })
    post!: Relation<Post>;

    @Property.string({ format: 'uuid' })
    postId!: string;
}

class Review {
    @Property.number()
    rating!: number;

    @Property.string()
    comment!: string;
}

class Metadata {
    @Property.array({ items: { type: 'string' }, required: false })
    notes: string[] | null | undefined;

    @Property.array({ items: { type: 'object', cls: () => Review }, required: false })
    reviews: Review[] | null | undefined;
}

@Entity()
class Post extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.array({ items: { type: 'string' }, required: false })
    tags: string[] | null | undefined;

    @Property.object({ cls: () => Metadata, required: false })
    metadata: Metadata | null | undefined;

    @Property.oneToMany({ target: () => Comment, inverseSide: 'post' })
    comments!: Comment[];

    @Property.manyToMany({ target: () => Category, inverseSide: 'posts', joinTable: true })
    categories!: Category[];
}

let server: StartedTestServer;
let postRepo: Repository<Post>;
let commentRepo: Repository<Comment>;
let categoryRepo: Repository<Category>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, Post, Comment, Category]
            })
        ]
    });
    postRepo = inject(repositoryTokenFor(Post));
    commentRepo = inject(repositoryTokenFor(Comment));
    categoryRepo = inject(repositoryTokenFor(Category));
}, 15000);

afterAll(async () => {
    await server.shutdown();
});

beforeEach(async () => {
    await postRepo.deleteAll({});
    await commentRepo.deleteAll({});
    await categoryRepo.deleteAll({});
});

// Helper
async function seed(posts: DeepPartial<Post>[]): Promise<Post[]> {
    const result: Post[] = [];
    for (const p of posts) {
        const post: Post = await postRepo.create({
            title: p.title ?? 'Untitled',
            tags: p.tags ?? [],
            metadata: p.metadata ?? { notes: [], reviews: [] },
            ...p
        });
        result.push(post);
    }
    return result;
}

// ---------- Tests ----------
describe('Array length filters', () => {

    // =================== Native array (tags) ===================
    describe('native array (tags)', () => {
        let postA: Post;
        let postB: Post;

        beforeEach(async () => {
            [postA, postB] = await seed([
                { title: 'A', tags: ['a', 'b', 'c'] },
                { title: 'B', tags: ['d'] }
            ]);
        });

        it('length equals', async () => {
            const res: Post[] = await postRepo.findAll({ where: { tags: { length: 3 } } });
            expect(res.map(p => p.id)).toEqual([postA.id]);
        });

        it('lengthGreaterThan', async () => {
            const res: Post[] = await postRepo.findAll({ where: { tags: { lengthGreaterThan: 1 } } });
            expect(res.map(p => p.id)).toEqual([postA.id]);
        });

        it('lengthLesserThanEquals', async () => {
            const res: Post[] = await postRepo.findAll({ where: { tags: { lengthLesserThanEquals: 1 } } });
            expect(res.map(p => p.id)).toEqual([postB.id]);
        });
    });

    // =================== JSONB scalar array (metadata.notes) ===================
    describe('JSONB scalar array (metadata.notes)', () => {
        let postA: Post;

        beforeEach(async () => {
            [postA] = await seed([
                { title: 'A', metadata: { notes: ['n1', 'n2', 'n3'], reviews: [] } },
                { title: 'B', metadata: { notes: ['n4'], reviews: [] } }
            ]);
        });

        it('length equals', async () => {
            const res: Post[] = await postRepo.findAll({
                where: { metadata: { where: { notes: { length: 3 } } } }
            });
            expect(res.map(p => p.id)).toEqual([postA.id]);
        });

        it('lengthGreaterThanEquals', async () => {
            const res: Post[] = await postRepo.findAll({
                where: { metadata: { where: { notes: { lengthGreaterThanEquals: 2 } } } }
            });
            expect(res.map(p => p.id)).toEqual([postA.id]);
        });
    });

    // =================== JSONB object array (metadata.reviews) ===================
    describe('JSONB object array (metadata.reviews)', () => {
        let postA: Post;

        beforeEach(async () => {
            [postA] = await seed([
                {
                    title: 'A',
                    metadata: {
                        notes: [],
                        reviews: [
                            { rating: 5, comment: 'Great' },
                            { rating: 4, comment: 'Good' },
                            { rating: 3, comment: 'Okay' }
                        ]
                    }
                },
                {
                    title: 'B',
                    metadata: {
                        notes: [],
                        reviews: [{ rating: 1, comment: 'Bad' }]
                    }
                }
            ]);
        });

        it('length equals', async () => {
            const res: Post[] = await postRepo.findAll({
                where: { metadata: { where: { reviews: { length: 3 } } } }
            });
            expect(res.map(p => p.id)).toEqual([postA.id]);
        });

        it('combined with element filter (where)', async () => {
            // Posts with at least 2 reviews where one of them has rating >= 4
            const res: Post[] = await postRepo.findAll({
                where: {
                    metadata: {
                        where: {
                            reviews: {
                                lengthGreaterThanEquals: 2,
                                where: { rating: { greaterThanEquals: 4 } }
                            }
                        }
                    }
                }
            });
            expect(res.map(p => p.id)).toEqual([postA.id]);
        });
    });

    // =================== One-to-many relation (comments) ===================
    describe('one-to-many (comments)', () => {
        let postA: Post;
        let postB: Post;

        beforeEach(async () => {
            [postA, postB] = await seed([
                { title: 'A' },
                { title: 'B' }
            ]);
            await commentRepo.create({ text: 'c1', postId: postA.id });
            await commentRepo.create({ text: 'c2', postId: postA.id });
            await commentRepo.create({ text: 'c3', postId: postB.id });
        });

        it('length equals', async () => {
            const res: Post[] = await postRepo.findAll({ where: { comments: { length: 2 } } });
            expect(res.map(p => p.id)).toEqual([postA.id]);
        });

        it('lengthGreaterThan', async () => {
            const res: Post[] = await postRepo.findAll({ where: { comments: { lengthGreaterThan: 0 } } });
            expect(res.map(p => p.id).sort()).toEqual([postA.id, postB.id].sort());
        });

        it('combined with element filter (where)', async () => {
            const res: Post[] = await postRepo.findAll({
                where: {
                    comments: {
                        lengthGreaterThanEquals: 1,
                        where: { text: 'c1' }
                    }
                }
            });
            expect(res.map(p => p.id)).toEqual([postA.id]);
        });
    });

    // =================== Many-to-many relation (categories) ===================
    describe('many-to-many (categories)', () => {
        let postA: Post;
        let postB: Post;
        let cat1: Category;
        let cat2: Category;
        let cat3: Category;

        beforeEach(async () => {
            [postA, postB] = await seed([
                { title: 'A' },
                { title: 'B' }
            ]);
            cat1 = await categoryRepo.create({ name: 'Cat1' });
            cat2 = await categoryRepo.create({ name: 'Cat2' });
            cat3 = await categoryRepo.create({ name: 'Cat3' });

            // Associate categories directly using repository or raw query if needed.
            // We'll use the Post entity's category collection. Since it's many-to-many with join table,
            // we can update the post with the categories array.
            await postRepo.updateById(postA.id, { categories: [cat1, cat2] });
            await postRepo.updateById(postB.id, { categories: [cat3] });
        });

        it('length equals', async () => {
            const res: Post[] = await postRepo.findAll({ where: { categories: { length: 2 } } });
            expect(res.map(p => p.id)).toEqual([postA.id]);
        });

        it('lengthLesserThan', async () => {
            const res: Post[] = await postRepo.findAll({ where: { categories: { lengthLesserThan: 2 } } });
            expect(res.map(p => p.id)).toEqual([postB.id]);
        });

        it('combined with element filter (includes)', async () => {
            // Note: includes on many-to-many might not be directly supported; we'll assume similar semantics.
            // This test will verify that length + includes works.
            const res: Post[] = await postRepo.findAll({
                where: {
                    categories: {
                        length: 2,
                        includes: [cat1, cat2] // exact entity object, which should be unwrapped to id via existing logic
                    }
                }
            });
            expect(res.map(p => p.id)).toEqual([postA.id]);
        });
    });

    // =================== OR combination with length ===================
    describe('OR combination', () => {
        let postA: Post;
        let postB: Post;

        beforeEach(async () => {
            [postA, postB] = await seed([
                { title: 'A', tags: ['a', 'b'] },
                { title: 'B', tags: ['c', 'd', 'e'] }
            ]);
        });

        it('length OR another condition', async () => {
            const res: Post[] = await postRepo.findAll({
                where: [
                    { tags: { length: 2 } },
                    { title: 'B' }
                ]
            });
            expect(res.map(p => p.id).sort()).toEqual([postA.id, postB.id].sort());
        });
    });
});