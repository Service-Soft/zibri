import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { type RouterInterface } from './router.interface';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Property } from '../entity/decorators/property.decorator';
import { HttpMethod } from '../http/http-method.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { Response } from '../open-api/decorators/response.decorator';

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
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('answers in the json type the request accepts, as json', async () => {
        const scim: globalThis.Response = await find('application/scim+json');
        expect(scim.headers.get(KnownHeader.CONTENT_TYPE)).toMatch(/^application\/scim\+json/);
        expect(await scim.json()).toEqual({ id: 'a' });

        const json: globalThis.Response = await find('application/json');
        expect(json.headers.get(KnownHeader.CONTENT_TYPE)).toMatch(/^application\/json/);
        expect(await json.json()).toEqual({ id: 'a' });
    });

    // every client that never thought about the header sends one of these two
    it('answers in the first type the route names when the request names none, or any', async () => {
        const silent: globalThis.Response = await find(undefined);
        const wildcard: globalThis.Response = await find('*/*');

        expect([silent.status, wildcard.status]).toEqual([200, 200]);
        expect(silent.headers.get(KnownHeader.CONTENT_TYPE)).toMatch(/^application\/scim\+json/);
    });

    it('answers 406 when the request accepts none of them', async () => {
        expect((await find('application/xml')).status).toBe(406);
    });

    // refusing here would turn a route whose author never documented a response into one that
    // rejects callers: a documentation gap becoming a runtime failure
    it('leaves a route that declared nothing answerable by anybody', async () => {
        inject<RouterInterface>(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/negotiation/undeclared',
            openApi: { useInOpenApi: false },
            handler: () => ({ declared: false })
        });

        expect((await fetch(`${baseUrl}/negotiation/undeclared`, { headers: { [KnownHeader.ACCEPT]: 'application/xml' } })).status).toBe(200);
    });

    // `@RateLimited({ reserveIfUnavailable: true })` documents the reservation it may answer with, and
    // a route carrying only that has said nothing about what it produces: counting it would let a rate
    // limit switch on content negotiation
    it('does not let a response the framework added decide what a route produces', async () => {
        inject<RouterInterface>(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/negotiation/implicit-only',
            openApi: { useInOpenApi: true, responses: [{ type: 'json', implicit: true }], tags: [] },
            handler: () => ({ declared: false })
        });

        expect((await fetch(`${baseUrl}/negotiation/implicit-only`, { headers: { [KnownHeader.ACCEPT]: 'application/xml' } })).status).toBe(200);
    });
});