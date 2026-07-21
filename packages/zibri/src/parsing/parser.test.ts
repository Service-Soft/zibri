import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Property } from '../entity/decorators/property.decorator';
import { Body } from '../routing/decorators/body.decorator';
import { Controller } from '../routing/decorators/controller.decorator';
import { Post } from '../routing/decorators/post.decorator';

class ParserTestBody {
    @Property.string()
    name!: string;
}

@Controller('/parser-test')
class ParserTestController {
    @Post('/')
    create(
        @Body(ParserTestBody)
        body: ParserTestBody
    ): ParserTestBody {
        return body;
    }
}

describe('Parser — parseBody content-type dispatch', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [ParserTestController] });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('parses a request with a matching, well-known content-type', async () => {
        const res: Response = await fetch(`${baseUrl}/parser-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'a' })
        });
        expect(res.status).toBe(200);
    });

    it('rejects an unsupported/unknown content-type with 415', async () => {
        const res: Response = await fetch(`${baseUrl}/parser-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-totally-made-up' },
            body: JSON.stringify({ name: 'a' })
        });
        expect(res.status).toBe(415);
    });

    it('rejects a well-known but mismatched content-type (route expects json) with 415', async () => {
        const res: Response = await fetch(`${baseUrl}/parser-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: 'name=a'
        });
        expect(res.status).toBe(415);
    });

    it('parses correctly when the content-type header includes parameters like charset', async () => {
        const res: Response = await fetch(`${baseUrl}/parser-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ name: 'a' })
        });
        expect(res.status).toBe(200);
    });
});