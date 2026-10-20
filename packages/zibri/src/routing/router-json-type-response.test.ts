import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator.ts';
import { Get } from './decorators/get.decorator.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { KnownHeader } from '../http/known-header.enum.ts';
import { MimeType } from '../http/mime-type.enum.ts';
import { Response } from '../open-api/decorators/response.decorator.ts';

class Resource {
    @Property.string()
    id!: string;
}

@Controller('/resources')
class ResourceController {
    @Response.object(Resource, { mimeTypes: [MimeType.JSON_SCIM, MimeType.JSON] })
    @Get()
    find(): Resource {
        return { id: 'a' };
    }
}

describe('Router - answering with a json type of its own', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    /**
     * Calls the route, accepting the given types.
     * @param accept - The accept header, if any.
     * @returns The answer.
     */
    async function find(accept: string | undefined): Promise<globalThis.Response> {
        return await fetch(`${baseUrl}/resources`, { headers: accept == undefined ? {} : { [KnownHeader.ACCEPT]: accept } });
    }

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [ResourceController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })]
        });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('answers in the json type the request accepts, as json', async () => {
        const scim: globalThis.Response = await find('application/scim+json');
        expect(scim.headers.get(KnownHeader.CONTENT_TYPE)).toMatch(/^application\/scim\+json/);
        expect(await scim.json()).toEqual({ id: 'a' });

        const json: globalThis.Response = await find('application/json');
        expect(json.headers.get(KnownHeader.CONTENT_TYPE)).toMatch(/^application\/json/);
        expect(await json.json()).toEqual({ id: 'a' });
    });

    it('answers in the first type the route names when the request names none', async () => {
        expect((await find(undefined)).headers.get(KnownHeader.CONTENT_TYPE)).toMatch(/^application\/scim\+json/);
    });

    it('answers 406 when the request accepts none of them', async () => {
        expect((await find('application/xml')).status).toBe(406);
    });
});