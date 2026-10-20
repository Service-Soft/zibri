import { once } from 'node:events';
import { connect, Socket } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { HttpServerLimits } from './http-server-limits.model.ts';
import { HttpStatus } from './http-status.enum.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { defineProvider, DiProvider } from '../di/models/di-provider.model.ts';
import { Controller } from '../routing/decorators/controller.decorator.ts';
import { Get } from '../routing/decorators/get.decorator.ts';

@Controller('/limits')
class LimitsController {
    @Get('/')
    read(): { ok: boolean } {
        return { ok: true };
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

/**
 * Limits small enough to reach with a handful of headers.
 */
const ownLimits: HttpServerLimits = {
    requestInMs: 60000,
    headersInMs: 15000,
    keepAliveInMs: 5000,
    handlerInMs: 30000,
    maxHeaderCount: 10,
    maxHeaderSizeInBytes: 2048
};

/**
 * The header lines of a request: the host, a connection closed after the answer, and fillers up to
 * the count.
 * @param count - How many headers the request carries, the host and the connection included.
 * @param valueLength - How long the value of each filler is.
 * @returns The header lines.
 */
function headersOf(count: number, valueLength: number = 1): string[] {
    const fillers: string[] = Array.from({ length: count - 2 }, (_, i) => `X-Filler-${i}: ${'v'.repeat(valueLength)}`);
    return ['Host: 127.0.0.1', 'Connection: close', ...fillers];
}

/**
 * Sends a request with exactly the given header lines, which a client library would add to.
 * @param baseUrl - Where the application listens.
 * @param headers - The header lines.
 * @returns The status the request was answered with.
 */
async function resolveStatus(baseUrl: string, headers: string[]): Promise<number> {
    const socket: Socket = connect(Number(new URL(baseUrl).port), '127.0.0.1');
    await once(socket, 'connect');
    let response: string = '';
    socket.on('data', (chunk: Buffer) => {
        response += chunk.toString('utf8');
    });
    const closed: Promise<unknown[]> = once(socket, 'close');
    socket.write(`GET /limits HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`);
    await closed;
    return Number(response.split(' ')[1]);
}

describe('the headers a request may carry, by default', () => {
    let server: StartedTestServer | undefined;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [LimitsController], dataSources: [dataSourceClass] });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('serves a request with a hundred headers', async () => {
        expect(await resolveStatus(baseUrl, headersOf(100))).toBe(HttpStatus.OK);
    });

    it('refuses a request with more than a hundred headers with 431, rather than dropping the rest', async () => {
        expect(await resolveStatus(baseUrl, headersOf(101))).toBe(HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE);
    });
});

describe('the headers a request may carry, as the application limits them', () => {
    let server: StartedTestServer | undefined;
    let baseUrl: string;

    beforeAll(async () => {
        const providers: DiProvider<unknown>[] = [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS, useValue: ownLimits })
        ];
        server = await startTestServer({ controllers: [LimitsController], dataSources: [dataSourceClass], providers });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('serves a request with as many headers as the limit allows', async () => {
        expect(await resolveStatus(baseUrl, headersOf(10))).toBe(HttpStatus.OK);
    });

    it('refuses a request with one header more with 431', async () => {
        expect(await resolveStatus(baseUrl, headersOf(11))).toBe(HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE);
    });

    it('serves headers inside the size it allows, and refuses larger ones with 431', async () => {
        expect(await resolveStatus(baseUrl, headersOf(4, 100))).toBe(HttpStatus.OK);
        expect(await resolveStatus(baseUrl, headersOf(4, 1000))).toBe(HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE);
    });
});

describe('the header limits an application may give', () => {
    it('refuses to start with a header count or size that is not a whole number of at least one', async () => {
        for (const limits of [{ ...ownLimits, maxHeaderCount: 0 }, { ...ownLimits, maxHeaderSizeInBytes: 1.5 }]) {
            const providers: DiProvider<unknown>[] = [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS, useValue: limits })
            ];
            await expect(startTestServer({ controllers: [LimitsController], dataSources: [dataSourceClass], providers }))
                .rejects.toThrow(/has to be a whole number of at least 1/);
        }
    }, 15000);
});