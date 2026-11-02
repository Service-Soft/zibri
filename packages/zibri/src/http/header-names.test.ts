import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { CorsOrigin } from './cors.middleware';
import { KnownHeader } from './known-header.enum';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider } from '../di/models/di-provider.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Param } from '../routing/decorators/param.decorator';

/**
 * An origin written the way a domain is often configured, with capitals.
 */
const configuredOrigin: CorsOrigin = 'https://App.example.com';

@Controller('/header-names')
class HeaderNamesController {
    // the example creating-endpoints.md gives
    @Get('/agent')
    agent(@Param.header('User-Agent') agent: string): string {
        return agent;
    }

    @Get('/plain')
    plain(): string {
        return 'plain';
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({
        controllers: [HeaderNamesController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.VERSION_HEADER, useValue: 'X-Version' })],
        security: { cors: { origins: [configuredOrigin] } }
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// node hands every header name over lowercased, and a name was
// looked up as it was written, so a header declared or configured with capitals was never found
describe('a header named with capitals', () => {
    it('is handed to the parameter that declares it', async () => {
        const res: Response = await fetch(`${baseUrl}/header-names/agent`, { headers: { [KnownHeader.USER_AGENT]: 'zibri-test' } });

        expect(res.status).toBe(200);
        await expect(res.text()).resolves.toContain('zibri-test');
    });

    it('is read as the version a request asks for', async () => {
        expect((await fetch(`${baseUrl}/header-names/plain`)).status).toBe(200);
        const res: Response = await fetch(`${baseUrl}/header-names/plain`, { headers: { 'X-Version': '9.9.9' } });

        // a version that does not exist is refused, which is what shows the header was read
        expect(res.status).toBe(400);
    });

    it('lets a configured origin with capitals match the origin a browser sends, which is lowercase', async () => {
        const res: Response = await fetch(`${baseUrl}/header-names/plain`, { headers: { [KnownHeader.ORIGIN]: 'https://app.example.com' } });

        // the browser compares the answer with what it sent
        expect(res.headers.get(KnownHeader.ACCESS_CONTROL_ALLOW_ORIGIN)).toBe('https://app.example.com');
    });
});