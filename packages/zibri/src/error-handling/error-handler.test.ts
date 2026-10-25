import assert from 'node:assert';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { ErrorResponseBody } from './error-response-body.model';
import { CustomBodyHttpError } from './errors/custom-body-http.error';
import { NotFoundError } from './errors/not-found.error';
import { TooManyRequestsError } from './errors/too-many-requests.error';
import { InternalError } from './internal-error.model';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { Property } from '../entity/decorators/property.decorator';
import { TestTimeouts } from '../__testing__/constants';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { HttpStatus } from '../http/http-status.enum';
import { JsonMimeType } from '../http/json-mime-type.type';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { $ts } from '../localization/translate.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { FailedRateLimitResult } from '../rate-limiting/rate-limit-result.model';
import { Body } from '../routing/decorators/body.decorator';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Post } from '../routing/decorators/post.decorator';
import { ValidationProblem } from '../validation/validation-problem.model';

/**
 * An error of a protocol that says what its errors look like.
 */
class ProtocolError extends CustomBodyHttpError {
    readonly body: unknown = { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '409', scimType: 'uniqueness' };
    readonly mimeTypes: JsonMimeType[] = [MimeType.JSON_SCIM, MimeType.JSON];

    constructor() {
        super($ts`taken`, HttpStatus.CONFLICT, $ts`Conflict`, undefined);
        this.name = 'ProtocolError';
    }
}

class TaskCreateData {
    @Property.string({ maxLength: 5 })
    title!: string;

    @Property.number({ min: 1 })
    estimate!: number;
}

@Controller('/error-cases')
class ErrorCasesController {
    @Post('/tasks')
    createTask(
        @Body(TaskCreateData)
        data: TaskCreateData
    ): TaskCreateData {
        return data;
    }

    @Get('/protocol')
    protocol(): never {
        throw new ProtocolError();
    }

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
        // in memory: nothing here reads a table, and the suite runs without a container
        server = await startTestServer({
            controllers: [ErrorCasesController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

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

    it('answers a validation error with every problem, each under its key and with its code', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/tasks`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JSON.stringify({ title: 'Write the docs', estimate: 0, owner: 'Ada' })
        });
        expect(res.status).toBe(400);

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: ErrorResponseBody = await res.json();
        expect(body.name).toBe('ValidationError');
        // the order the properties were validated in is no promise, so compared as a set
        const problems: Omit<ValidationProblem, 'message'>[] = (body.problems ?? []).map(({ key, code }) => ({ key, code }));
        expect(problems).toHaveLength(3);
        expect(problems).toEqual(expect.arrayContaining([
            { key: 'title', code: 'maxLength' },
            { key: 'estimate', code: 'min' },
            { key: 'owner', code: 'unknownKey' }
        ]));
        expect(body.problems?.find(p => p.key === 'title')?.message).toBe('needs to be at most 5 characters long');
    });

    it('lists the problems of a validation error in an xml answer as well', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/tasks`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, [KnownHeader.ACCEPT]: MimeType.XML },
            body: JSON.stringify({ title: 'Docs', estimate: 0 })
        });
        expect(res.status).toBe(400);

        const xml: string = await res.text();
        expect(xml).toContain('<problem><key>estimate</key><code>min</code><message>needs to be at least 1</message></problem>');
    });

    it('answers an error with a body of its own with that body, in the json type the request accepts', async () => {
        const res: Response = await fetch(`${baseUrl}/error-cases/protocol`);
        expect(res.status).toBe(409);
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toMatch(/^application\/scim\+json/);
        expect(await res.json()).toEqual({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '409', scimType: 'uniqueness' });

        const json: Response = await fetch(`${baseUrl}/error-cases/protocol`, { headers: { [KnownHeader.ACCEPT]: MimeType.JSON } });
        expect(json.headers.get(KnownHeader.CONTENT_TYPE)).toMatch(/^application\/json/);
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