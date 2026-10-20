import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { CrudController } from './crud-controller.model.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { PaginationResult } from '../../open-api/pagination-result.model.ts';
import { Controller } from '../decorators/controller.decorator.ts';

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

describe('CrudController', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [NoteController, WideNoteController],
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, CrudNote] })]
        });
        baseUrl = await server.start();
        await inject(repositoryTokenFor(CrudNote)).createAll(Array.from({ length: 501 }, (_, i) => ({ position: i })));
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

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