import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Body, Controller, JsonBodyParser, MimeType, Post, Property, Response, StreamBodyParser, ZibriApplicationOptions } from 'zibri';
import { createInMemoryDataSource, defaultTestProviders, StartedTestServer, startTestServer } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';

class UploadReceipt {
    @Property.string()
    content!: string;
}

@Controller('/uploads', { versions: 'all' })
class UploadController {

    @Response.object(UploadReceipt)
    @Post('/')
    async upload(@Body.stream({ maxSize: '1kb' }) body: Readable): Promise<UploadReceipt> {
        return { content: await text(body) };
    }
}

/**
 * An application that lists its body parsers itself: setting `bodyParsers` replaces the built-in
 * ones, so every parser it keeps is one it names - through `zibri`, as any application imports.
 */
const applicationOptions: ZibriApplicationOptions = {
    name: 'uploads',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    controllers: [UploadController],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never',
    dataSources: [createInMemoryDataSource()],
    providers: defaultTestProviders,
    bodyParsers: [JsonBodyParser, StreamBodyParser]
};

describe('StreamBodyParser', () => {
    let server: StartedTestServer | undefined;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({ application: applicationOptions });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('hands a route the body as a stream when the application lists the parser itself', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/uploads`, {
            method: 'POST',
            headers: { 'content-type': MimeType.OCTET_STREAM },
            body: 'a task list'
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toStrictEqual({ content: 'a task list' });
    });
});