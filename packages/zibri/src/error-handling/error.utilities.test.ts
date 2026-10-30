import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ErrorUtilities } from './error.utilities';
import { GlobalError } from './errors/global.error';
import { HttpError } from './errors/http.error';
import { InternalServerError } from './errors/internal-server.error';
import { NotFoundError } from './errors/not-found.error';
import { InternalError } from './internal-error.model';
import { TestTimeouts } from '../__testing__/constants';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { $ts } from '../localization/translate.function';
import { LoggerInterface } from '../logging/logger.interface';

describe('ErrorUtilities', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

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

    // 03 §Q8: the http handler and the websocket service each decided this on their own, so a fix
    // to one of them had to be found again in the other
    describe('reportToLog', () => {
        let logger: LoggerInterface;
        let critical: jest.SpiedFunction<LoggerInterface['critical']>;
        let error: jest.SpiedFunction<LoggerInterface['error']>;

        beforeEach(() => {
            logger = inject(ZIBRI_DI_TOKENS.LOGGER);
            critical = jest.spyOn(logger, 'critical').mockImplementation(() => {});
            error = jest.spyOn(logger, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            critical.mockRestore();
            error.mockRestore();
        });

        it('logs a value that is not an error as a critical GlobalError, and reports it as a defect', () => {
            expect(ErrorUtilities.reportToLog('thrown string', logger)).toBe(true);

            expect(critical).toHaveBeenCalledTimes(1);
            expect(critical.mock.calls[0]?.[0]).toBeInstanceOf(GlobalError);
            expect(error).not.toHaveBeenCalled();
        });

        it('logs a server error as it is, never wrapped', () => {
            const thrown: InternalServerError = new InternalServerError($ts`broken`);

            expect(ErrorUtilities.reportToLog(thrown, logger)).toBe(true);
            expect(ErrorUtilities.reportToLog(new Error('plain'), logger)).toBe(true);

            expect(error.mock.calls.map(call => call[0])).toEqual([thrown, expect.any(Error)]);
            expect(critical).not.toHaveBeenCalled();
        });

        it('leaves a client error out of the log, and reports it as no defect', () => {
            expect(ErrorUtilities.reportToLog(new NotFoundError($ts`nothing here`), logger)).toBe(false);

            expect(error).not.toHaveBeenCalled();
            expect(critical).not.toHaveBeenCalled();
        });
    });
});