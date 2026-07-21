import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { ErrorUtilities } from './error.utilities';
import { HttpError } from './errors/http.error';
import { InternalServerError } from './errors/internal-server.error';
import { NotFoundError } from './errors/not-found.error';
import { InternalError } from './internal-error.model';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { $ts } from '../localization/translate.function';

describe('ErrorUtilities', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    describe('toHttpError', () => {
        it('returns the value unchanged when it is already an HttpError', () => {
            const error: NotFoundError = new NotFoundError($ts`not found`);
            expect(ErrorUtilities.toHttpError(error)).toBe(error);
        });

        it('wraps a non HttpError value in a new InternalServerError', () => {
            const result: HttpError = ErrorUtilities.toHttpError(new InternalError('boom'));
            expect(result).toBeInstanceOf(InternalServerError);
        });

        it('wraps a non-error value in a new InternalServerError', () => {
            const result: HttpError = ErrorUtilities.toHttpError('just a string');
            expect(result).toBeInstanceOf(InternalServerError);
        });
    });

    describe('isHttpError', () => {
        it('returns true for an HttpError instance', () => {
            expect(ErrorUtilities.isHttpError(new NotFoundError($ts`not found`))).toBe(true);
        });

        it('returns false for a non HttpError error', () => {
            expect(ErrorUtilities.isHttpError(new InternalError('boom'))).toBe(false);
        });

        it('returns false for a non-error value', () => {
            expect(ErrorUtilities.isHttpError({ message: 'not an error' })).toBe(false);
        });
    });

    describe('isExternalError', () => {
        it('returns true for an ExternalError instance (eg. HttpError)', () => {
            expect(ErrorUtilities.isExternalError(new NotFoundError($ts`not found`))).toBe(true);
        });

        it('returns false for an InternalError', () => {
            expect(ErrorUtilities.isExternalError(new InternalError('boom'))).toBe(false);
        });

        it('returns false for a plain Error', () => {
            expect(ErrorUtilities.isExternalError(new Error('boom'))).toBe(false);
        });
    });

    describe('isError', () => {
        it('returns true for an Error instance', () => {
            expect(ErrorUtilities.isError(new Error('boom'))).toBe(true);
        });

        it('returns true for subclasses of Error', () => {
            expect(ErrorUtilities.isError(new InternalError('boom'))).toBe(true);
        });

        it('returns false for a non-error value', () => {
            expect(ErrorUtilities.isError('boom')).toBe(false);
            expect(ErrorUtilities.isError(undefined)).toBe(false);
            expect(ErrorUtilities.isError({ message: 'boom' })).toBe(false);
        });
    });

    describe('unknownToErrorString', () => {
        it('returns the message of an Error instance', () => {
            expect(ErrorUtilities.unknownToErrorString(new Error('something broke'))).toBe('something broke');
        });

        it('json-stringifies a non-error value', () => {
            expect(ErrorUtilities.unknownToErrorString({ code: 42 })).toBe('{"code":42}');
        });

        it('json-stringifies a primitive value', () => {
            expect(ErrorUtilities.unknownToErrorString('just a string')).toBe('"just a string"');
        });
    });
});