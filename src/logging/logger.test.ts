import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { LogLevel } from './log-level.enum';
import { Log } from './log.model';
import { Logger } from './logger';
import { LoggerInterface } from './logger.interface';
import { BaseLoggerTransportConfig, LoggerTransport } from './transport/logger-transport.model';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { GlobalRegistry } from '../global/global-registry';
import { HttpMethod } from '../http/http-method.enum';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Ms } from '../utilities/ms';

describe('Logger', () => {
    let logger: LoggerInterface;
    let infoTransportSend: jest.Mock<(log: Log, config: BaseLoggerTransportConfig) => void | Promise<void>>;
    let warnTransportSend: jest.Mock<(log: Log, config: BaseLoggerTransportConfig) => void | Promise<void>>;

    beforeAll(() => {
        initDiContainer();
        GlobalRegistry.markAppAsCreated();

        infoTransportSend = jest.fn();
        warnTransportSend = jest.fn();

        const infoConfig: BaseLoggerTransportConfig = { name: 'InfoTransport', level: LogLevel.INFO, register: 'directly' };
        const warnConfig: BaseLoggerTransportConfig = { name: 'WarnTransport', level: LogLevel.WARN, register: 'directly' };
        const infoTransport: LoggerTransport<BaseLoggerTransportConfig> = LoggerTransport.create(
            infoConfig,
            infoTransportSend as unknown as (log: Log, config: BaseLoggerTransportConfig) => void
        );
        const warnTransport: LoggerTransport<BaseLoggerTransportConfig> = LoggerTransport.create(
            warnConfig,
            warnTransportSend as unknown as (log: Log, config: BaseLoggerTransportConfig) => void
        );

        logger = new Logger([infoTransport, warnTransport], {
            [LogLevel.DEBUG]: Ms.WEEK,
            [LogLevel.INFO]: Ms.WEEK,
            [LogLevel.WARN]: Ms.WEEK,
            [LogLevel.ERROR]: Ms.WEEK,
            [LogLevel.CRITICAL]: Ms.WEEK
        });
    });

    afterAll(() => {
        (GlobalRegistry as unknown as { appData: { state: unknown } })['appData'].state = 'offline';
    });

    afterEach(() => {
        infoTransportSend.mockClear();
        warnTransportSend.mockClear();
    });

    it('only calls transports whose configured level is at or below the log level', async () => {
        await logger.debug('a debug message');

        expect(infoTransportSend).not.toHaveBeenCalled();
        expect(warnTransportSend).not.toHaveBeenCalled();
    });

    it('calls transports at or below the log level, skipping the ones above it', async () => {
        await logger.info('an info message');

        expect(infoTransportSend).toHaveBeenCalledTimes(1);
        expect(warnTransportSend).not.toHaveBeenCalled();
    });

    it('calls both transports for a warn message', async () => {
        await logger.warn('a warn message');

        expect(infoTransportSend).toHaveBeenCalledTimes(1);
        expect(warnTransportSend).toHaveBeenCalledTimes(1);
    });

    it('builds a log record with the given message and level', async () => {
        await logger.info('hello world');

        const log: Log = infoTransportSend.mock.calls[0][0];
        expect(log.message).toBe('hello world');
        expect(log.level).toBe(LogLevel.INFO);
        expect(log.context.origin).toEqual(expect.any(String));
    });

    it('attaches the error and message from error()', async () => {
        const error: Error = new Error('boom');
        await logger.error(error);

        const log: Log = warnTransportSend.mock.calls[0][0];
        expect(log.level).toBe(LogLevel.ERROR);
        expect(log.message).toBe('boom');
        expect(log.context.error?.name).toBe('Error');
        expect(log.context.error?.paragraphs).toContain('boom');
    });

    it('attaches the error and message from critical()', async () => {
        const error: Error = new Error('critical boom');
        await logger.critical(error);

        const log: Log = warnTransportSend.mock.calls[0][0];
        expect(log.level).toBe(LogLevel.CRITICAL);
        expect(log.message).toBe('critical boom');
        expect(log.context.error?.paragraphs).toContain('critical boom');
    });

    it('passes through additional context metadata', async () => {
        await logger.info('with metadata', { metadata: { userId: 'abc' } });

        const log: Log = infoTransportSend.mock.calls[0][0];
        expect(log.context.metadata).toEqual({ userId: 'abc' });
    });

    it('does not throw and logs to the console when a transport rejects', async () => {
        const consoleErrorSpy: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        warnTransportSend.mockImplementationOnce(() => Promise.reject(new Error('transport failed')));

        await expect(logger.warn('should not throw')).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });
});

// Everything above drives Logger directly with fake transports. This instead exercises the full real
// pipeline end to end, using the framework's default logger config (console + db transports, both
// registered by default): a controller throws → the real global error handler catches it →
// Logger.error() runs → errorToLoggedError() builds the paragraphs/stack → the db transport persists a
// real Log row through Postgres. None of the unit tests above (nor errorToLoggedError's or logToDb's
// own unit tests) can catch a break in how these pieces are actually wired together.
@Controller('/logger-integration-test')
class LoggerIntegrationController {
    @Get('/boom')
    boom(): never {
        throw new InternalError('something broke in the controller');
    }
}

describe('Logger — real error logged end to end through a request', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let logRepository: Repository<Log>;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [LoggerIntegrationController] });
        baseUrl = await server.start();
        logRepository = inject(repositoryTokenFor(Log));
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('persists a Log row with the error paragraphs and stack trace when a controller throws', async () => {
        const res: Response = await fetch(`${baseUrl}/logger-integration-test/boom`);
        expect(res.status).toBe(500);
        await res.json();

        const logs: Log[] = await logRepository.findAll({ where: { level: LogLevel.ERROR } });
        const relevant: Log | undefined = logs.find(
            l => l.context.error?.paragraphs.some(p => p.includes('something broke in the controller')) ?? false
        );

        expect(relevant).toBeDefined();
        expect(relevant?.context.error?.name).toBe('GlobalError');
        expect(relevant?.context.error?.paragraphs.some(p => p.includes('caused by InternalError:'))).toBe(true);
        // the top-level GlobalError's own stack is intentionally cleared by the error handler, but the
        // cause's stack trace (the actual controller frame) is preserved inside the paragraphs
        expect(relevant?.context.error?.paragraphs.some(p => p.includes('LoggerIntegrationController.boom'))).toBe(true);
        expect(relevant?.context.origin).toEqual(expect.any(String));
        expect(relevant?.context.request?.method).toBe(HttpMethod.GET);
        expect(relevant?.context.request?.url).toContain('/logger-integration-test/boom');
    });
});