import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { ChangeSetEntity } from '../../change-sets/models/change-set-entity.model.ts';
import { ChangeSet } from '../../change-sets/models/change-set.model.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../entity/models/relation.type.ts';
import { Newable } from '../../types/newable.type.ts';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * What deleting a row does with the rows that point at it, where no relation removes them along with
 * it. In memory, which answers the way valkey does; postgres answers through its foreign keys.
 */

/**
 * An entity recording change sets, deleted for good.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class EvalLedger extends ChangeSetEntity {
    /**
     * What it is called.
     */
    @Property.string()
    name!: string;
}

/**
 * An owner whose rows are not removed along with it.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class EvalShelf extends BaseEntity {
    /**
     * Inserted and updated along with the shelf, never removed with it.
     */
    @Property.oneToMany({ target: () => EvalBook, inverseSide: 'shelf', cascade: ['insert', 'update'] })
    books!: EvalBook[];
}

/**
 * A row pointing at a shelf.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class EvalBook extends BaseEntity {
    /**
     * The shelf.
     */
    @Property.manyToOne({ target: () => EvalShelf, joinColumn: 'shelfId', inverseSide: 'books' })
    shelf!: Relation<EvalShelf>;

    /**
     * The key that relation is stored as.
     */
    @Property.string({ format: 'uuid' })
    shelfId!: string;
}

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, EvalLedger, EvalShelf, EvalBook]
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describe('evaluation/01-data-layer', () => {
    describe('M45 - deleting a row that records change sets', () => {
        it('deletes its change sets along with it', async () => {
            const ledger: EvalLedger = await inject(dataSourceClass)
                .getRepository(EvalLedger)
                .create({ name: 'gone' });

            await inject(dataSourceClass)
                .getRepository(EvalLedger)
                .deleteById(ledger.id);

            expect(await inject(dataSourceClass)
                .getRepository(ChangeSet)
                .count({ where: { changeSetEntityId: ledger.id } })).toBe(0);
        });
    });

    describe('M46 - deleting a row that rows point at without removing them', () => {
        it('refuses the delete, as a foreign key does', async () => {
            const shelf: EvalShelf = await inject(dataSourceClass)
                .getRepository(EvalShelf)
                .create({ books: [{}] });

            await expect(inject(dataSourceClass)
                .getRepository(EvalShelf)
                .deleteById(shelf.id)).rejects.toThrow();
        });
    });
});