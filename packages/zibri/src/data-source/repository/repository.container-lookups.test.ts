import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Repository } from './repository';
import { TestTimeouts } from '../../__testing__/constants';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../../__testing__/test-server/start-test-server.function';
import { DefaultTestServerUserRepository } from '../../__testing__/test-server/user-repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { DiContainer } from '../../di/di-container';
import { getDiTokenName } from '../../di/get-di-token-name.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';

@Entity({ tenant: 'shared' })
class Note extends BaseEntity {
    @Property.string()
    text!: string;
}

let server: StartedTestServer;
let notes: Repository<Note>;
let users: DefaultTestServerUserRepository;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Note], repositories: defaultTestServerRepositories })]
    });
    notes = inject(repositoryTokenFor(Note));
    users = inject(DefaultTestServerUserRepository);
    // the first call of each kind resolves what the repository keeps
    await notes.deleteById((await notes.create({ text: 'warm up' })).id);
    await users.create({ email: 'warm-up@example.com', roles: [Roles.USER] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

/**
 * Runs some work and names the tokens it resolved from the container.
 * @param work - The work.
 * @returns The names of the tokens, in the order they were resolved.
 */
async function resolveTokensResolvedBy(work: () => Promise<unknown>): Promise<string[]> {
    const injects: jest.SpiedFunction<typeof DiContainer.prototype.inject> = jest.spyOn(DiContainer.prototype, 'inject');
    try {
        await work();
        return injects.mock.calls.map(([token]) => getDiTokenName(token));
    }
    finally {
        injects.mockRestore();
    }
}

// a write resolved its services from the container per call. A repository keeps what it
// needs once it has it, and an observer is given what it needs when it is registered
describe('what a write resolves from the container', () => {
    it('resolves nothing for a delete of a row of an entity nobody observes', async () => {
        const note: Note = await notes.create({ text: 'to delete' });

        expect(await resolveTokensResolvedBy(async () => await notes.deleteById(note.id))).toEqual([]);
    });

    it('resolves nothing for a bulk delete either', async () => {
        await notes.create({ text: 'bulk' });

        expect(await resolveTokensResolvedBy(async () => await notes.deleteAll({ text: 'bulk' }))).toEqual([]);
    });

    it('resolves nothing for a write to users, whose roles are checked', async () => {
        expect(await resolveTokensResolvedBy(async () => await users.create({ email: 'ada@example.com', roles: [Roles.USER] }))).toEqual([]);
    });
});