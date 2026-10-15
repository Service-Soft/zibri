import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { HttpStatus } from './http-status.enum';
import { JsonResponse } from './json-response.model';
import { KnownHeader } from './known-header.enum';
import { MimeType } from './mime-type.enum';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Property } from '../entity/decorators/property.decorator';
import { Response } from '../open-api/decorators/response.decorator';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Post } from '../routing/decorators/post.decorator';

const VERSION: string = 'W/"1"';

class Resource {
    @Property.string()
    id!: string;
}

@Controller('/resources')
class ResourceController {
    @Response.object(Resource, { mimeTypes: [MimeType.JSON_SCIM, MimeType.JSON] })
    @Get()
    find(): JsonResponse<Resource> {
        return JsonResponse.of({ id: 'a' }, { headers: { [KnownHeader.ETAG]: VERSION } });
    }

    @Response.object(Resource, { status: HttpStatus.CREATED })
    @Post()
    create(): JsonResponse<Resource> {
        return JsonResponse.of({ id: 'b' }, { headers: { [KnownHeader.LOCATION]: 'https://example.com/resources/b', [KnownHeader.ETAG]: VERSION } });
    }
}

describe('JsonResponse', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    /**
     * Asks for the resource again, unless it still has the given etag.
     * @param etag - The etag the caller holds.
     * @returns The answer.
     */
    async function revalidate(etag: string): Promise<globalThis.Response> {
        // the cache control a client revalidating sends. Without one, fetch adds `no-cache` to a
        // request carrying If-None-Match, which a server has to answer in full
        return await fetch(`${baseUrl}/resources`, { headers: { [KnownHeader.CACHE_CONTROL]: 'max-age=0', [KnownHeader.IF_NONE_MATCH]: etag } });
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

    it('answers with its body and headers, in the status and json type of the route', async () => {
        const created: globalThis.Response = await fetch(`${baseUrl}/resources`, { method: 'POST' });

        expect(created.status).toBe(HttpStatus.CREATED);
        expect(created.headers.get(KnownHeader.LOCATION)).toBe('https://example.com/resources/b');
        expect(created.headers.get(KnownHeader.ETAG)).toBe(VERSION);
        expect(await created.json()).toEqual({ id: 'b' });

        const found: globalThis.Response = await fetch(`${baseUrl}/resources`, { headers: { [KnownHeader.ACCEPT]: MimeType.JSON } });
        expect(found.headers.get(KnownHeader.CONTENT_TYPE)).toMatch(/^application\/json/);
        expect(await found.json()).toEqual({ id: 'a' });
    });

    it('answers a GET whose If-None-Match names its etag with 304 and no body', async () => {
        const unchanged: globalThis.Response = await revalidate(VERSION);
        expect(unchanged.status).toBe(HttpStatus.NOT_MODIFIED);
        expect(await unchanged.text()).toBe('');

        expect((await revalidate('W/"0"')).status).toBe(HttpStatus.OK);
    });
});