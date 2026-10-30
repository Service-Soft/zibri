import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Repository } from './repository';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { scopeFor } from '../../entity/models/entity-scope.model';
import { SoftDeleteEntity } from '../change-sets/models/soft-delete-entity.model';

/**
 * How often the scope of an entity is asked. A scope may read what it needs from the data source
 * - the memberships of a row that belongs to several users - so every time it is asked can be a
 * round trip, and a call asks it once, whatever it does and however many rows it writes.
 */

let evaluations: number = 0;

@Entity({
    tenant: 'shared',
    allowOrphan: true,
    scope: {
        restrictedTo: scopeFor<CountedNote>(() => {
            evaluations++;
            return undefined;
        })
    }
})
class CountedNote extends BaseEntity {
    @Property.string()
    text!: string;
}

/**
 * The same, soft deleting, so each call runs through the change set and soft delete repositories
 * before it reaches the steps the base repository takes.
 */
@Entity({
    tenant: 'shared',
    allowOrphan: true,
    scope: {
        restrictedTo: scopeFor<CountedArchivedNote>(() => {
            evaluations++;
            return undefined;
        })
    }
})
class CountedArchivedNote extends SoftDeleteEntity {
    @Property.string()
    text!: string;
}

let server: StartedTestServer | undefined;
let notes: Repository<CountedNote>;
let archivedNotes: Repository<CountedArchivedNote>;

/**
 * Runs a call and counts how often it asked the scope.
 * @param call - The call.
 * @returns How often the scope was asked.
 */
async function countEvaluations(call: () => Promise<unknown>): Promise<number> {
    evaluations = 0;
    await call();
    return evaluations;
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, CountedNote, CountedArchivedNote],
                repositories: defaultTestServerRepositories
            })
        ]
    });
    notes = inject(repositoryTokenFor(CountedNote));
    archivedNotes = inject(repositoryTokenFor(CountedArchivedNote));
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// 01 §D7: the scope was asked once per row of a batch, and up to three times by a single update
describe('the scope of an entity', () => {
    let existing: CountedNote;

    beforeEach(async () => {
        existing = await notes.create({ text: 'existing' });
    });

    it('is asked once by each call, however many rows it writes', async () => {
        const counts: Record<string, number> = {
            create: await countEvaluations(async () => await notes.create({ text: 'one' })),
            createAll: await countEvaluations(async () => await notes.createAll(Array.from({ length: 50 }, (_, i) => ({ text: `row ${i}` })))),
            findById: await countEvaluations(async () => await notes.findById(existing.id)),
            findAll: await countEvaluations(async () => await notes.findAll({ where: { text: 'existing' } })),
            exists: await countEvaluations(async () => await notes.exists({ where: { id: existing.id } })),
            updateById: await countEvaluations(async () => await notes.updateById(existing.id, { text: 'changed' })),
            updateAll: await countEvaluations(async () => await notes.updateAll({ text: 'row 1' }, { text: 'changed' })),
            deleteById: await countEvaluations(async () => await notes.deleteById(existing.id)),
            deleteAll: await countEvaluations(async () => await notes.deleteAll({ text: 'row 2' }))
        };

        expect(counts).toEqual({
            create: 1,
            createAll: 1,
            findById: 1,
            findAll: 1,
            exists: 1,
            updateById: 1,
            updateAll: 1,
            deleteById: 1,
            deleteAll: 1
        });
    });

    it('is asked once by each call of a repository that soft deletes', async () => {
        const archived: CountedArchivedNote = await archivedNotes.create({ text: 'archived' });

        const counts: Record<string, number> = {
            createAll: await countEvaluations(async () => await archivedNotes.createAll(Array.from({ length: 20 }, (_, i) => ({ text: `row ${i}` })))),
            updateById: await countEvaluations(async () => await archivedNotes.updateById(archived.id, { text: 'changed' })),
            updateAll: await countEvaluations(async () => await archivedNotes.updateAll({ text: 'row 1' }, { text: 'changed' })),
            deleteById: await countEvaluations(async () => await archivedNotes.deleteById(archived.id))
        };

        expect(counts).toEqual({ createAll: 1, updateById: 1, updateAll: 1, deleteById: 1 });
    });
});