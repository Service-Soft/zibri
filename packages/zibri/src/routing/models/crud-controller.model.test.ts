import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { PaginationResult } from '../../data-source/models/pagination-result.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { IntersectionClass } from '../../entity/intersection-class.model';
import { OmitClass } from '../../entity/omit-class.model';
import { PickClass } from '../../entity/pick-class.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Controller } from '../decorators/controller.decorator';
import { Get } from '../decorators/get.decorator';
import { CrudController } from './crud-controller.model';

@Entity({ tenant: 'shared', allowOrphan: true })
class CrudNote extends BaseEntity {
    @Property.number({ format: 'integer' })
    position!: number;
}

class CrudNoteData {
    @Property.number({ format: 'integer' })
    position!: number;
}

@Controller('/notes')
class NoteController extends CrudController(CrudNote, CrudNoteData, CrudNoteData) {}

@Controller('/wide-notes')
class WideNoteController extends CrudController(CrudNote, CrudNoteData, CrudNoteData, { maxLimit: 500 }) {}

class NoteMetrics {
    @Get('/dashboard')
    dashboard(): { notes: string } {
        return { notes: 'counted' };
    }
}

// as the documentation combines one: its kept routes read the repository the crud controller resolves
@Controller('/composed-notes')
class ComposedNoteController extends IntersectionClass(
        OmitClass(CrudController(CrudNote, CrudNoteData, CrudNoteData), ['deleteById']),
        PickClass(NoteMetrics, ['dashboard'])
    ) {}

describe('CrudController', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [NoteController, WideNoteController, ComposedNoteController],
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, CrudNote], repositories: defaultTestServerRepositories })]
        });
        baseUrl = await server.start();
        await inject(repositoryTokenFor(CrudNote)).createAll(Array.from({ length: 501 }, (_, i) => ({ position: i })));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Reads a page of notes.
     * @param path - The route, with its query.
     * @returns The response.
     */
    async function get(path: string): Promise<Response> {
        return await fetch(`${baseUrl}${path}`);
    }

    it('reads a page of at most 100 notes', async () => {
        const res: Response = await get('/notes?page=2&limit=100');

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const page: PaginationResult<CrudNote> = await res.json();
        expect(page.items).toHaveLength(100);
        expect(page.totalAmount).toBe(501);
        expect((await get('/notes?page=1&limit=101')).status).toBe(400);
    });

    it('reads a page as large as the maxLimit it was given', async () => {
        expect((await get('/wide-notes?page=1&limit=500')).status).toBe(200);
        expect((await get('/wide-notes?page=1&limit=501')).status).toBe(400);
    });

    it('serves the routes it keeps when built into another class with OmitClass and IntersectionClass', async () => {
        const created: Response = await fetch(`${baseUrl}/composed-notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ position: 1000 })
        });
        expect(created.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const note: CrudNote = await created.json();

        expect((await get('/composed-notes?page=1&limit=10')).status).toBe(200);
        const read: Response = await get(`/composed-notes/${note.id}`);
        expect(read.status).toBe(200);
        expect(await read.json()).toEqual(note);
        expect((await fetch(`${baseUrl}/composed-notes/${note.id}`, { method: 'DELETE' })).status).toBe(405);
        expect(await (await get('/composed-notes/dashboard')).json()).toEqual({ notes: 'counted' });
    });

    it.each([
        ['a page of 0', 'page=0&limit=10'],
        ['a negative page', 'page=-1&limit=10'],
        ['a page that is a fraction', 'page=1.5&limit=10'],
        ['a limit of 0', 'page=1&limit=0'],
        ['a negative limit', 'page=1&limit=-10'],
        ['a limit that is a fraction', 'page=1&limit=2.5']
    ])('answers %s with a 400', async (_, query) => {
        expect((await get(`/notes?${query}`)).status).toBe(400);
    });
});