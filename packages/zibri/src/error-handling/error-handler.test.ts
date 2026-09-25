import assert from 'node:assert';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { NotFoundError } from './errors/not-found.error';
import { TooManyRequestsError } from './errors/too-many-requests.error';
import { InternalError } from './internal-error.model';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { $ts } from '../localization/translate.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { FailedRateLimitResult } from '../rate-limiting/rate-limit-result.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';

@Controller('/error-cases')
class ErrorCasesController {
    @Get('/not-found')
    notFound(): never {
        throw new NotFoundError($ts`nothing here`);
    }

    @Get('/internal')
    internal(): never {
        throw new InternalError('something broke internally');
    }

    @Get('/throw-non-error')
    // eslint-disable-next-line typescript/require-await
    async throwNonError(): Promise<never> {
        // eslint-disable-next-line typescript/only-throw-error
        throw 'a plain string, not an Error instance';
    }

    @Get('/rate-limited')
    rateLimited(): never {
        const rateLimitResult: FailedRateLimitResult = {
            allowed: false,
            limit: 10,
            remaining: 0,
            resetsAtMs: Date.now() + 60_000,
            retryAtMs: Date.now() + 5000
        };
        throw new TooManyRequestsError($ts`slow down`, rateLimitResult);
    }
}

describe('errorHandler', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [ErrorCasesController] });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns a JSON error response with status, name, message and paragraphs', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/not-found`);
        expect(res.status).toBe(404);
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toContain('application/json');

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { status: number, name: string, message: string, paragraphs: string[] } = await res.json();
        expect(body.status).toBe(404);
        expect(body.name).toBe('NotFoundError');
        expect(body.paragraphs).toEqual(['nothing here']);
    });

    it('converts a non-HttpError into a 500 internal server error response', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/internal`);
        expect(res.status).toBe(500);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { status: number, name: string } = await res.json();
        expect(body.status).toBe(500);
        expect(body.name).toBe('InternalServerError');
    });

    it('logs via logger.critical when the thrown value is not an Error instance', async () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript/typedef
        const criticalSpy = jest.spyOn(logger, 'critical');

        const res: Response = await fetch(`${baseUrl}/error-cases/throw-non-error`);

        expect(res.status).toBe(500);
        expect(criticalSpy).toHaveBeenCalled();
    });

    it('logs the error that was actually thrown, not a wrapper around it', async () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript/typedef
        const errorSpy = jest.spyOn(logger, 'error');

        await fetch(`${baseUrl}/error-cases/internal`);

        expect(errorSpy).toHaveBeenCalled();

        // the message and the stack are the two fields an aggregator groups on. Handing it a
        // GlobalError made every 5xx in the application identical, and blanking that wrapper's stack
        // left nothing to fingerprint either
        const [firstCall] = errorSpy.mock.calls;
        assert(firstCall, 'the error was never logged');
        const logged: Error = firstCall[0];
        expect(logged.name).not.toBe('GlobalError');
        expect(logged.stack).toBeTruthy();
    });

    it('does not raise the error level for an external (http) error', async () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript/typedef
        const errorSpy = jest.spyOn(logger, 'error');
        // eslint-disable-next-line typescript/typedef
        const warnSpy = jest.spyOn(logger, 'warn');

        await fetch(`${baseUrl}/error-cases/not-found`);

        // a client error is not a defect. The security relevant ones reach the record through the
        // audit trail, which carries a reason a detection rule can key on; a 404 for a missing icon
        // belongs in an access log and on neither of these levels
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('sets rate-limit headers when the error is a TooManyRequestsError with a rateLimitResult', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/rate-limited`);
        expect(res.status).toBe(429);
        expect(res.headers.get(KnownHeader.X_RATE_LIMIT_LIMIT)).toBe('10');
        expect(res.headers.get(KnownHeader.X_RATE_LIMIT_REMAINING)).toBe('0');
        expect(res.headers.get(KnownHeader.RETRY_AFTER)).not.toBeNull();
        expect(res.headers.get(KnownHeader.X_RATE_LIMIT_RESET)).not.toBeNull();
    });

    it('does not set rate-limit headers for a normal error', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/not-found`);
        expect(res.headers.get(KnownHeader.X_RATE_LIMIT_LIMIT)).toBeNull();
    });

    it('answers with an xml document when the client prefers xml', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/not-found`, {
            headers: { Accept: `${MimeType.XML}, ${MimeType.JSON};q=0.5` }
        });
        expect(res.status).toBe(404);
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toContain(MimeType.XML);
        expect(res.headers.get(KnownHeader.VARY)?.toLowerCase()).toContain('accept');

        const xml: string = await res.text();
        expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><Error>/);
        expect(xml).toContain('<status>404</status>');
        expect(xml).toContain('<name>NotFoundError</name>');
        expect(xml).toContain('<paragraph>nothing here</paragraph>');
    });

    it('answers with json when the client accepts anything', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/not-found`, {
            headers: { Accept: '*/*' }
        });
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toContain(MimeType.JSON);
    });

    it('answers with the format the client names first among those it weighs equally', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/not-found`, {
            headers: { Accept: `${MimeType.XML}, ${MimeType.JSON}` }
        });
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toContain(MimeType.XML);
    });

    it('falls back to JSON when the client accepts html but no error page template is configured', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/not-found`, {
            headers: { Accept: 'text/html' }
        });
        expect(res.status).toBe(404);
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toContain('application/json');
    });
});