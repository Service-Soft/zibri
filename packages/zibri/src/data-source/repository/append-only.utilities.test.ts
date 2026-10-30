import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
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

/**
 * A visit to a page of a project, which is kept as it happened.
 */
@Entity({ tenant: 'shared', allowOrphan: true, appendOnly: true })
class ProjectVisit extends BaseEntity {
    /**
     * The page visited.
     */
    @Property.string()
    page!: string;
    /**
     * When.
     */
    @Property.date()
    visitedAt!: Date;
}

/**
 * A comment, which its writer edits and deletes.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class EditableComment extends BaseEntity {
    /**
     * What it says.
     */
    @Property.string()
    text!: string;
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, ProjectVisit, EditableComment], repositories: defaultTestServerRepositories })]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('an append only entity', () => {
    it('refuses to change or delete its rows, and prunes the ones a filter matches', async () => {
        const visits: Repository<ProjectVisit> = inject(repositoryTokenFor(ProjectVisit));
        const [old] = await visits.createAll([
            { page: '/projects', visitedAt: new Date(Date.now() - 60_000) },
            { page: '/tasks', visitedAt: new Date() }
        ]);

        await expect(visits.updateById(String(old?.id), { page: '/elsewhere' })).rejects.toThrow('are append only, and are only created');
        await expect(visits.deleteById(String(old?.id))).rejects.toThrow('are append only, and are only created');
        await expect(visits.deleteAll({ page: '/projects' })).rejects.toThrow('are append only, and are only created');

        expect(await visits.prune({ visitedAt: { before: new Date(Date.now() - 30_000) } })).toBe(1);
        expect((await visits.findAll()).map(v => v.page)).toEqual(['/tasks']);
    });

    it('refuses to prune an entity whose rows are deleted', async () => {
        const comments: Repository<EditableComment> = inject(repositoryTokenFor(EditableComment));

        await expect(comments.prune({ text: 'outdated' })).rejects.toThrow('Remove them with deleteAll');
    });
});