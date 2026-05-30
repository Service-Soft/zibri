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

// ---------- Entity definitions for deeply nested structure ----------
class Address {
    @Property.string()
    street!: string;

    @Property.string()
    city!: string;

    @Property.string({ required: false })
    type?: string | null; // 'home', 'work', etc.
}

class PersonalData {
    @Property.string()
    favoriteColor!: string;

    @Property.number()
    height!: number;

    @Property.array({ items: { type: 'object', cls: () => Address }, required: false })
    addresses: Address[] | undefined | null;
}

@Entity()
class Customer extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => PersonalData, required: false })
    personalData: PersonalData | undefined | null;

    @Property.string({ required: false })
    notes: string | null | undefined;
}

class Tag {
    @Property.string()
    key!: string;

    @Property.string()
    value!: string;
}

class Item {
    @Property.string()
    name!: string;

    @Property.array({ items: { type: 'object', cls: () => Tag }, required: false })
    tags: Tag[] | undefined | null;
}

@Entity()
class Container extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.array({ items: { type: 'object', cls: () => Item }, required: false })
    items: Item[] | undefined | null;
}

let server: StartedTestServer;
let customerRepo: Repository<Customer>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, Customer, Container]
            })
        ]
    });
    customerRepo = inject(repositoryTokenFor(Customer));
}, 15000);

afterAll(async () => {
    await server.shutdown();
});

beforeEach(async () => {
    await customerRepo.deleteAll({});
});

// Seed helpers
async function seedCustomers(...data: Partial<Customer>[]): Promise<Customer[]> {
    return Promise.all(data.map(d => customerRepo.create(d)));
}

describe('Where filters – deeply nested (object → array → object)', () => {
    let alice: Customer;
    let bob: Customer;

    beforeEach(async () => {
        [alice, bob] = await seedCustomers(
            {
                name: 'Alice',
                personalData: {
                    favoriteColor: 'blue',
                    height: 165,
                    addresses: [
                        { street: '123 Main St', city: 'Springfield', type: 'home' },
                        { street: '456 Work Ave', city: 'Springfield', type: 'work' }
                    ]
                }
            },
            {
                name: 'Bob',
                personalData: {
                    favoriteColor: 'red',
                    height: 180,
                    // eslint-disable-next-line cspell/spellchecker
                    addresses: [{ street: '789 Oak Rd', city: 'Shelbyville', type: 'home' }]
                }
            }
        );
    });

    // ===== Top-level simple field =====
    it('top-level string equals', async () => {
        const res: Customer[] = await customerRepo.findAll({ where: { name: 'Alice' } });
        expect(res.map(c => c.id)).toEqual([alice.id]);
    });

    // ===== Nested object (PersonalData) =====
    it('nested object field equals', async () => {
        const res: Customer[] = await customerRepo.findAll({
            where: { personalData: { where: { favoriteColor: 'blue' } } }
        });
        expect(res.map(c => c.id)).toEqual([alice.id]);
    });

    it('nested object field not equal', async () => {
        const res: Customer[] = await customerRepo.findAll({
            where: { personalData: { where: { favoriteColor: { not: 'blue' } } } }
        });
        expect(res.map(c => c.id)).toEqual([bob.id]);
    });

    it('nested object field oneOf', async () => {
        const res: Customer[] = await customerRepo.findAll({
            where: { personalData: { where: { favoriteColor: { oneOf: ['blue', 'green'] } } } }
        });
        expect(res.map(c => c.id)).toEqual([alice.id]);
    });

    it('nested object field greaterThan on number', async () => {
        const res: Customer[] = await customerRepo.findAll({
            where: { personalData: { where: { height: { greaterThan: 170 } } } }
        });
        expect(res.map(c => c.id)).toEqual([bob.id]);
    });

    // ===== Array of objects (Addresses) exact match =====
    it('exact array match (shorthand)', async () => {
        // Works due to recent fix: plain array = exact match via @> & <@
        const res: Customer[] = await customerRepo.findAll({
            where: {
                personalData: {
                    where: {
                        addresses: [
                            { street: '123 Main St', city: 'Springfield', type: 'home' },
                            { street: '456 Work Ave', city: 'Springfield', type: 'work' }
                        ]
                    }
                }
            }
        });
        expect(res.map(c => c.id)).toEqual([alice.id]);
    });

    // ===== Array of objects: includes (contains) – requires feature, skip for now =====
    it('array includes (contains all specified objects)', async () => {
        const res: Customer[] = await customerRepo.findAll({
            where: {
                personalData: {
                    where: {
                        addresses: { includes: [{ street: '123 Main St', city: 'Springfield' }] }
                    }
                }
            }
        });
        expect(res.map(c => c.id)).toEqual([alice.id]);
    });

    // ===== Array of objects: nested where on items (if supported) =====
    it('array item where filter', async () => {
        const res: Customer[] = await customerRepo.findAll({
            where: {
                personalData: {
                    where: {
                        addresses: { where: { street: '456 Work Ave' } }
                    }
                }
            }
        });
        expect(res.map(c => c.id)).toEqual([alice.id]);
    });

    // ===== Array size / null =====
    it('array is null', async () => {
        await customerRepo.updateById(alice.id, { personalData: { ...alice.personalData, addresses: null } });
        const res: Customer[] = await customerRepo.findAll({
            where: { personalData: { where: { addresses: null } } }
        });
        expect(res.map(c => c.id)).toEqual([alice.id]);
    });

    // ===== Entire nested object is null =====
    it('nested object is null', async () => {
        await customerRepo.updateById(bob.id, { personalData: null });
        const res: Customer[] = await customerRepo.findAll({
            where: { personalData: { is: null } }
        });
        expect(res.map(c => c.id)).toEqual([bob.id]);
    });

    // ===== OR combination with nested filters =====
    it('OR with nested object conditions', async () => {
        const filters: WhereFilter<Customer>[] = [
            { personalData: { where: { favoriteColor: 'blue' } } },
            { personalData: { where: { height: 180 } } }
        ];
        const res: Customer[] = await customerRepo.findAll({ where: filters });
        expect(res.map(c => c.id).sort()).toEqual([alice.id, bob.id].sort());
    });

    // ===== Array of objects with nested array of objects =====
    describe('Container with Item → Tag (array → object → array)', () => {
        let container: Container;
        let container2: Container;
        let containerRepo: Repository<Container>;

        beforeAll(() => {
            containerRepo = inject(repositoryTokenFor(Container));
        });

        beforeEach(async () => {
            await containerRepo.deleteAll({});
            [container, container2] = await Promise.all([
                containerRepo.create({
                    title: 'Container A',
                    items: [
                        {
                            name: 'Item 1',
                            tags: [
                                { key: 'color', value: 'red' },
                                { key: 'size', value: 'large' }
                            ]
                        },
                        {
                            name: 'Item 2',
                            tags: [{ key: 'color', value: 'blue' }]
                        }
                    ]
                }),
                containerRepo.create({
                    title: 'Container B',
                    items: [
                        {
                            name: 'Item 3',
                            tags: [{ key: 'color', value: 'green' }]
                        }
                    ]
                })
            ]);
        });

        it('filters by nested array of objects using where on array', async () => {
        // Find containers that have an item with a tag where key = 'size'
            const res: Container[] = await containerRepo.findAll({
                where: {
                    items: {
                        where: {
                            tags: {
                                where: { key: 'size' }
                            }
                        }
                    }
                }
            });
            expect(res.map(c => c.id)).toEqual([container.id]);
        });

        it('filters by nested array of objects using includes', async () => {
        // Find containers that have an item that includes both specified tags (exact object match)
            const res: Container[] = await containerRepo.findAll({
                where: {
                    items: {
                        where: {
                            tags: {
                                includes: [{ key: 'color', value: 'red' }, { key: 'size', value: 'large' }]
                            }
                        }
                    }
                }
            });
            expect(res.map(c => c.id)).toEqual([container.id]);
        });

        it('filters by nested array of objects using isIncludedIn', async () => {
            // Container A's Item 2 tags is a subset of the given list
            const res: Container[] = await containerRepo.findAll({
                where: {
                    items: {
                        where: {
                            tags: {
                                isIncludedIn: [{ key: 'color', value: 'blue' }, { key: 'extra', value: 'something' }]
                            }
                        }
                    }
                }
            });
            expect(res.map(c => c.id)).toEqual([container.id]);
        });

        it('filters by exact array match on nested array', async () => {
        // Find containers where an item has exactly the tags [{ key: 'color', value: 'green' }]
            const res: Container[] = await containerRepo.findAll({
                where: {
                    items: {
                        where: {
                            tags: [{ key: 'color', value: 'green' }]
                        }
                    }
                }
            });
            expect(res.map(c => c.id)).toEqual([container2.id]);
        });

        it('fuzzyLike on title', async () => {
            const res: Container[] = await containerRepo.findAll({
                where: { title: { fuzzyLike: { value: 'Cont', minSimilarity: 30 } } }
            });
            expect(res.map(c => c.id)).toEqual(expect.arrayContaining([container.id, container2.id]));
        });
    });
});