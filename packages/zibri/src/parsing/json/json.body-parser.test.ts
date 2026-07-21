import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Property } from '../../entity/decorators/property.decorator';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Post } from '../../routing/decorators/post.decorator';

class SmallBody {
    @Property.string()
    name!: string;
}

@Controller('/json-body')
class JsonBodyController {
    @Post('/small')
    small(
        @Body(SmallBody, { baseMaxSize: '20b' })
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
}

describe('JsonBodyParser', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [JsonBodyController] });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('parses a valid JSON body', async () => {
        const res: Response = await fetch(`${baseUrl}/json-body/small`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'a' })
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ name: 'a' });
    });

    it('rejects a body whose Content-Length header exceeds maxSize', async () => {
        const res: Response = await fetch(`${baseUrl}/json-body/small`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'a'.repeat(100) })
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
            body: JSON.stringify([{ name: 'a' }, { name: 'b' }])
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
});