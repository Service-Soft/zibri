import assert from 'node:assert';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { LogLevel } from './log-level.enum';
import { Log } from './log.model';
import { Logger } from './logger';
import { LoggerInterface } from './logger.interface';
import { BaseLoggerTransportConfig, LoggerTransport } from './transport/logger-transport.model';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { CronService } from '../cron/cron.service';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { InternalError } from '../error-handling/internal-error.model';
import { GlobalRegistry } from '../global/global-registry';
import { HttpMethod } from '../http/http-method.enum';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Ms } from '../utilities/ms';

/**
 * The first entry of the first batch a transport was handed.
 * @param send - The transport's send mock.
 * @returns The entry.
 */
function firstLogHandedTo(
    send: jest.Mock<(logs: Log[], config: BaseLoggerTransportConfig) => void | Promise<void>>
): Log {
    const [firstCall] = send.mock.calls;
    assert(firstCall, 'the transport was never called');
    const [log] = firstCall[0];
    assert(log, 'the transport was called with an empty batch');
    return log;
}

// first, for the reason on startAndStopTestServerWithout
describe('Logger — starting', () => {
    it('refuses to start without Log while a transport writes to the data source, and names it', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([Log], { controllers: [LoggerIntegrationController] });

        await expect(start).rejects.toThrow(/Error initializing Logger[\S\s]*- Log/);
    }, 30000);

    it('starts without Log, and schedules no cleanup for it, when no transport writes to the data source', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([Log], {
            controllers: [LoggerIntegrationController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS, useFactory: () => [LoggerTransport.console(LogLevel.INFO)] }),
                // the real scheduler builds every cron job it is given, so a cleanup job for Log would
                // refuse this boot on its repository - the harness stubs the scheduler otherwise
                defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
            ]
        });

        await expect(start).resolves.toBeUndefined();
    }, 30000);
});

describe('Logger', () => {
    let logger: LoggerInterface;
    let infoTransportSend: jest.Mock<(logs: Log[], config: BaseLoggerTransportConfig) => void | Promise<void>>;
    let warnTransportSend: jest.Mock<(logs: Log[], config: BaseLoggerTransportConfig) => void | Promise<void>>;

    beforeAll(() => {
        initDiContainer();
        GlobalRegistry.markAppAsCreated();

        infoTransportSend = jest.fn();
        warnTransportSend = jest.fn();

        const infoConfig: BaseLoggerTransportConfig = { name: 'InfoTransport', level: LogLevel.INFO, register: 'directly' };
        const warnConfig: BaseLoggerTransportConfig = { name: 'WarnTransport', level: LogLevel.WARN, register: 'directly' };
        const infoTransport: LoggerTransport<BaseLoggerTransportConfig> = LoggerTransport.create(
            infoConfig,
            infoTransportSend as unknown as (logs: Log[], config: BaseLoggerTransportConfig) => void
        );
        const warnTransport: LoggerTransport<BaseLoggerTransportConfig> = LoggerTransport.create(
            warnConfig,
            warnTransportSend as unknown as (logs: Log[], config: BaseLoggerTransportConfig) => void
        );

        logger = new Logger([infoTransport, warnTransport], {
            [LogLevel.DEBUG]: Ms.WEEK,
            [LogLevel.INFO]: Ms.WEEK,
            [LogLevel.WARN]: Ms.WEEK,
            [LogLevel.ERROR]: Ms.WEEK,
            [LogLevel.CRITICAL]: Ms.WEEK
        }, 1000, 100);
    });

    afterAll(() => {
        (GlobalRegistry as unknown as { appData: { state: unknown } })['appData'].state = 'offline';
    });

    afterEach(() => {
        infoTransportSend.mockClear();
        warnTransportSend.mockClear();
    });

    // flushed rather than asserted straight away: entries gather for a moment before they are
    // written, which is what makes a batch a batch. See logger.batching.test.ts.
    it('only calls transports whose configured level is at or below the log level', async () => {
        logger.debug('a debug message');
        await logger.flush();

        expect(infoTransportSend).not.toHaveBeenCalled();
        expect(warnTransportSend).not.toHaveBeenCalled();
    });

    it('calls transports at or below the log level, skipping the ones above it', async () => {
        logger.info('an info message');
        await logger.flush();

        expect(infoTransportSend).toHaveBeenCalledTimes(1);
        expect(warnTransportSend).not.toHaveBeenCalled();
    });

    it('calls both transports for a warn message', async () => {
        logger.warn('a warn message');
        await logger.flush();

        expect(infoTransportSend).toHaveBeenCalledTimes(1);
        expect(warnTransportSend).toHaveBeenCalledTimes(1);
    });

    it('builds a log record with the given message and level', async () => {
        logger.info('hello world');
        await logger.flush();

        const log: Log = firstLogHandedTo(infoTransportSend);
        expect(log.message).toBe('hello world');
        expect(log.level).toBe(LogLevel.INFO);
        expect(log.context.origin).toEqual(expect.any(String));
    });

    it('attaches the error and message from error()', async () => {
        const error: Error = new Error('boom');
        logger.error(error);
        await logger.flush();

        const log: Log = firstLogHandedTo(warnTransportSend);
        expect(log.level).toBe(LogLevel.ERROR);
        expect(log.message).toBe('boom');
        expect(log.context.error?.name).toBe('Error');
        expect(log.context.error?.paragraphs).toContain('boom');
    });

    it('attaches the error and message from critical()', async () => {
        const error: Error = new Error('critical boom');
        logger.critical(error);
        await logger.flush();

        const log: Log = firstLogHandedTo(warnTransportSend);
        expect(log.level).toBe(LogLevel.CRITICAL);
        expect(log.message).toBe('critical boom');
        expect(log.context.error?.paragraphs).toContain('critical boom');
    });

    it('passes through additional context metadata', async () => {
        logger.info('with metadata', { metadata: { userId: 'abc' } });
        await logger.flush();

        const log: Log = firstLogHandedTo(infoTransportSend);
        expect(log.context.metadata).toEqual({ userId: 'abc' });
    });

    it('does not throw and logs to the console when a transport rejects', async () => {
        const consoleErrorSpy: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        warnTransportSend.mockImplementationOnce(() => Promise.reject(new Error('transport failed')));

        // returns immediately now - the entry is queued rather than written, so nothing here could
        // throw even if the transport does
        expect(() => logger.warn('should not throw')).not.toThrow();

        // the failure happens while draining, so it has to be waited for. That the caller never sees
        // it is the point: a broken transport must not surface at whatever line happened to log
        await logger.flush();
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
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('persists a Log row with the error paragraphs and stack trace when a controller throws', async () => {
        const res: Response = await fetch(`${baseUrl}/logger-integration-test/boom`);
        expect(res.status).toBe(500);
        await res.json();

        // the response does not wait for the log to be written, and should not - logging is queued
        // so a request never pays for a slow transport. The row exists once the queue has drained.
        await inject(ZIBRI_DI_TOKENS.LOGGER).flush();

        const logs: Log[] = await logRepository.findAll({ where: { level: LogLevel.ERROR } });
        const relevant: Log | undefined = logs.find(
            l => l.context.error?.paragraphs.some(p => p.includes('something broke in the controller')) ?? false
        );

        expect(relevant).toBeDefined();

        // the error the controller threw, not a wrapper around it. Both of these fields used to
        // describe a GlobalError instead - one name for every 5xx in the application, and a stack the
        // handler had blanked - which is what an aggregator groups and fingerprints on
        expect(relevant?.context.error?.name).toBe('InternalError');
        expect(relevant?.context.error?.stackTrace.some(l => l.includes('LoggerIntegrationController.boom'))).toBe(true);
        expect(relevant?.context.error?.paragraphs.some(p => p.includes('LoggerIntegrationController.boom'))).toBe(true);
        expect(relevant?.context.origin).toEqual(expect.any(String));
        expect(relevant?.context.request?.method).toBe(HttpMethod.GET);
        expect(relevant?.context.request?.url).toContain('/logger-integration-test/boom');
    });
});