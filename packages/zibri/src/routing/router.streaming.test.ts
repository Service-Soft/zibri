import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { HttpResponse } from '../http/http-response.model';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';

/**
 * Server-sent events written the way creating-endpoints.md shows it: from the handler, onto the
 * response of the request, with the handler returning once the headers are out.
 */
@Controller('/progress')
class ProgressController {
    @Get('/', { timeoutInMs: 50 })
    stream(): void {
        const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (ctx?.type !== 'http-request') {
            return;
        }
        const res: HttpResponse = ctx.response;
        res.writeHead(HttpStatus.OK, { [KnownHeader.CONTENT_TYPE]: MimeType.EVENT_STREAM });
        let step: number = 0;
        const timer: NodeJS.Timeout = setInterval(() => {
            step++;
            res.write(`data: ${step}\n\n`);
            if (step === 3) {
                clearInterval(timer);
                res.end();
            }
        }, 30);
        res.on('close', () => clearInterval(timer));
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({
        controllers: [ProgressController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// part of evaluation round 2, 03 §H12: the docs spoke of server-sent events, and no page said how a
// handler sends them
describe('a response a handler streams itself', () => {
    it('reaches the client whole, past the handler\'s deadline', async () => {
        const res: Response = await fetch(`${baseUrl}/progress`);

        expect(res.status).toBe(HttpStatus.OK);
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toBe(MimeType.EVENT_STREAM);
        await expect(res.text()).resolves.toBe('data: 1\n\ndata: 2\n\ndata: 3\n\n');
    });
});