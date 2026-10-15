import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Property } from '../../entity/decorators/property.decorator';
import { MimeType } from '../../http/mime-type.enum';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { JsonUtilities } from '../../utilities/json.utilities';

class SmallBody {
    @Property.string()
    name!: string;
}

@Controller('/json-body')
class JsonBodyController {
    @Post('/small')
    small(
        @Body(SmallBody, { maxSize: '20b' })
        body: SmallBody
    ): SmallBody {
        return body;
    }

    @Post('/array')
    array(
        @Body(SmallBody, { isArray: true })
        body: SmallBody[]
    ): SmallBody[] {
        return body;
    }

    @Post('/optional')
    optional(
        @Body(SmallBody, { required: false })
        body: SmallBody | undefined
    ): { received: boolean } {
        return { received: body !== undefined };
    }

    @Post('/scim')
    scim(
        @Body(SmallBody, { type: MimeType.JSON_SCIM })
        body: SmallBody
    ): SmallBody {
        return body;
    }
}

describe('JsonBodyParser', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    /**
     * Posts a body of the given type.
     * @param path - The route below /json-body.
     * @param contentType - The content type the body is sent as.
     * @returns The answer.
     */
    async function postAs(path: string, contentType: string): Promise<Response> {
        return await fetch(`${baseUrl}/json-body${path}`, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body: JsonUtilities.stringify({ name: 'a' })
        });
    }

    beforeAll(async () => {
        // in memory: nothing here reads a table, and the suite runs without a container
        server = await startTestServer({
            controllers: [JsonBodyController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })]
        });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('parses a valid JSON body', async () => {
        const res: Response = await fetch(`${baseUrl}/json-body/small`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ name: 'a' })
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ name: 'a' });
    });

    it('rejects a body whose Content-Length header exceeds maxSize', async () => {
        const res: Response = await fetch(`${baseUrl}/json-body/small`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ name: 'a'.repeat(100) })
        });
        expect(res.status).toBe(413);
    });

    it('rejects malformed JSON with a 400', async () => {
        const res: Response = await fetch(`${baseUrl}/json-body/small`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{not valid json'
        });
        expect(res.status).toBe(400);
    });

    it('parses an array body', async () => {
        const res: Response = await fetch(`${baseUrl}/json-body/array`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify([{ name: 'a' }, { name: 'b' }])
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([{ name: 'a' }, { name: 'b' }]);
    });

    it('treats an empty body as undefined when the body is optional', async () => {
        const res: Response = await fetch(`${baseUrl}/json-body/optional`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ received: false });
    });

    it('rejects a missing body with a 400 when the body is required (default)', async () => {
        const res: Response = await fetch(`${baseUrl}/json-body/small`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        expect(res.status).toBe(400);
    });

    it('reads every json type on a body declared as json', async () => {
        for (const contentType of ['application/scim+json', 'application/merge-patch+json', 'application/ld+json; charset=utf-8']) {
            const res: Response = await postAs('/small', contentType);
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ name: 'a' });
        }
    });

    it('reads only the json type a body names', async () => {
        expect((await postAs('/scim', 'application/scim+json')).status).toBe(200);
        expect((await postAs('/scim', 'application/json')).status).toBe(415);
        expect((await postAs('/scim', 'application/ld+json')).status).toBe(415);
    });

    it('reads no type that is not json as json', async () => {
        expect((await postAs('/small', 'application/xml+json-ish')).status).toBe(415);
        expect((await postAs('/small', 'text/json')).status).toBe(415);
    });
});