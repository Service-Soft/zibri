import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { type LoggerInterface } from '../logging/logger.interface';

let server: StartedTestServer | undefined;
let baseUrl: string;
let warn: jest.SpiedFunction<LoggerInterface['warn']>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE, useValue: undefined })]
    });
    warn = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    warn?.mockRestore();
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// every error answered to a browser wrote three warnings, so a
// scan of unknown urls filled the log with them
describe('an application without an error page', () => {
    it('says so once, and answers a browser with the error as json', async () => {
        for (let i: number = 0; i < 20; i++) {
            const res: Response = await fetch(`${baseUrl}/unknown-${i}`, { headers: { [KnownHeader.ACCEPT]: MimeType.HTML } });
            expect(res.status).toBe(404);
            expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toMatch(/^application\/json/);
        }

        const aboutTheTemplate: unknown[][] = warn.mock.calls.filter(([message]) => String(message).includes('ERROR_PAGE_TEMPLATE'));
        expect(aboutTheTemplate).toHaveLength(1);
    });
});