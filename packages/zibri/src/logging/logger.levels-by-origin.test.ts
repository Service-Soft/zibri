import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { LogLevel } from './log-level.enum';
import { Log } from './log.model';
import { Logger } from './logger';
import { BaseLoggerTransportConfig, LoggerTransport } from './transport/logger-transport.model';
import { initDiContainer } from '../di/init-di-container.function';
import { GlobalRegistry } from '../global/global-registry';
import { Ms } from '../utilities/ms';

/**
 * What a transport was handed.
 */
type Received = {
    /**
     * The messages, in the order they were handed over.
     */
    messages: string[],
    /**
     * The transport.
     */
    transport: LoggerTransport<BaseLoggerTransportConfig>
};

/**
 * A transport that records the messages it is handed.
 * @param level - The level of the transport.
 * @param levelsByOrigin - The levels of some origins.
 * @returns The transport and what it received.
 */
function recordingTransport(level: LogLevel, levelsByOrigin?: Record<string, LogLevel>): Received {
    const messages: string[] = [];
    const transport: LoggerTransport<BaseLoggerTransportConfig> = LoggerTransport.create<BaseLoggerTransportConfig>(
        { name: 'RecordingTransport', level, register: 'directly', levelsByOrigin },
        (logs: Log[]) => {
            messages.push(...logs.map(l => l.message));
        }
    );
    return { messages, transport };
}

/**
 * A logger writing to the given transports.
 * @param transports - The transports.
 * @returns The logger.
 */
function loggerWith(...transports: LoggerTransport<BaseLoggerTransportConfig>[]): Logger {
    return new Logger(transports, {
        [LogLevel.DEBUG]: Ms.WEEK,
        [LogLevel.INFO]: Ms.WEEK,
        [LogLevel.WARN]: Ms.WEEK,
        [LogLevel.ERROR]: Ms.WEEK,
        [LogLevel.CRITICAL]: Ms.WEEK
    }, 1000, 0);
}

beforeAll(() => {
    initDiContainer();
    GlobalRegistry.markAppAsCreated();
});

afterAll(() => {
    (GlobalRegistry as unknown as { appData: { state: unknown } })['appData'].state = 'offline';
});

// the origin of every entry below is this file, the caller of the logger
describe('levels by origin', () => {
    it('finds the origin from every level, however deep the caller is', async () => {
        const quiet: Received = recordingTransport(LogLevel.CRITICAL, { 'logging/logger.levels-by-origin': LogLevel.DEBUG });
        const logger: Logger = loggerWith(quiet.transport);
        const logFromDepth: (depth: number) => void = depth => {
            if (depth > 0) {
                logFromDepth(depth - 1);
                return;
            }
            logger.debug('debug');
            logger.info('info');
            logger.warn('warn');
            logger.error(new Error('error'));
        };

        logFromDepth(20);
        await logger.flush();

        expect(quiet.messages).toEqual(['debug', 'info', 'warn', 'error']);
    });

    it('lets a transport hear more from an origin than its own level admits', async () => {
        const quiet: Received = recordingTransport(LogLevel.WARN, { 'logging/logger.levels-by-origin': LogLevel.DEBUG });
        const logger: Logger = loggerWith(quiet.transport);

        logger.debug('looking up the project');
        await logger.flush();

        expect(quiet.messages).toEqual(['looking up the project']);
    });

    it('lets a transport hear less from an origin than its own level admits', async () => {
        const noisy: Received = recordingTransport(LogLevel.DEBUG, { 'logger.levels-by-origin': LogLevel.ERROR });
        const logger: Logger = loggerWith(noisy.transport);

        logger.info('looking up the project');
        logger.error(new Error('the project is gone'));
        await logger.flush();

        expect(noisy.messages).toEqual(['the project is gone']);
    });

    it('goes by the file whichever extension a key and the origin end in', async () => {
        const quiet: Received = recordingTransport(LogLevel.WARN, { 'logging/logger.levels-by-origin.test.js': LogLevel.DEBUG });
        const logger: Logger = loggerWith(quiet.transport);

        logger.debug('looking up the project');
        await logger.flush();

        expect(quiet.messages).toEqual(['looking up the project']);
    });

    it('takes the longest key the origin contains', async () => {
        const received: Received = recordingTransport(LogLevel.INFO, {
            '/logging/': LogLevel.ERROR,
            '/logging/logger.levels-by-origin': LogLevel.DEBUG
        });
        const logger: Logger = loggerWith(received.transport);

        logger.debug('looking up the project');
        await logger.flush();

        expect(received.messages).toEqual(['looking up the project']);
    });

    it('keeps the level of the transport for an origin no key names', async () => {
        const received: Received = recordingTransport(LogLevel.INFO, { '/services/payment': LogLevel.DEBUG });
        const logger: Logger = loggerWith(received.transport);

        logger.debug('looking up the project');
        logger.info('found the project');
        await logger.flush();

        expect(received.messages).toEqual(['found the project']);
    });

    it('sets the level for one transport only', async () => {
        const terminal: Received = recordingTransport(LogLevel.INFO, { 'logger.levels-by-origin': LogLevel.ERROR });
        const db: Received = recordingTransport(LogLevel.INFO);
        const logger: Logger = loggerWith(terminal.transport, db.transport);

        logger.info('found the project');
        await logger.flush();

        expect(terminal.messages).toEqual([]);
        expect(db.messages).toEqual(['found the project']);
    });

    it('builds no entry when no transport admits it from any origin', () => {
        const received: Received = recordingTransport(LogLevel.WARN, { '/services/payment': LogLevel.INFO });
        const logger: Logger = loggerWith(received.transport);
        const add: jest.SpiedFunction<(log: Log) => void> = jest.spyOn(logger['buffer'], 'add');

        logger.debug('looking up the project');

        expect(add).not.toHaveBeenCalled();
    });
});

// the origin is read from where the logger was called, which a stack trace is the only way to know
describe('the origin of an entry', () => {
    const iterations: number = 2000;

    /**
     * How long a loop takes per iteration, in microseconds.
     * @param fn - The body to run.
     * @returns The microseconds one iteration cost.
     */
    function perCallMicroseconds(fn: (i: number) => void): number {
        const startedAt: bigint = process.hrtime.bigint();
        for (let i: number = 0; i < iterations; i++) {
            fn(i);
        }
        return Number(process.hrtime.bigint() - startedAt) / iterations / 1000;
    }

    // turning stack traces off is a normal production tuning, and an origin read from a trace that is
    // not there made every log call throw
    it('logs while stack traces are turned off', async () => {
        const received: Received = recordingTransport(LogLevel.INFO);
        const logger: Logger = loggerWith(received.transport);
        const limit: number = Error.stackTraceLimit;

        Error.stackTraceLimit = 0;
        try {
            expect(() => logger.info('found the project')).not.toThrow();
        }
        finally {
            Error.stackTraceLimit = limit;
        }
        await logger.flush();

        expect(received.messages).toEqual(['found the project']);
    });

    it('costs a call less than twice what capturing a stack trace does', () => {
        const logger: Logger = loggerWith(recordingTransport(LogLevel.INFO).transport);

        // both warmed first, so neither pays for the first compile of what it runs
        let sink: string | undefined = undefined;
        perCallMicroseconds(() => {
            sink = new Error('a stack').stack;
        });
        perCallMicroseconds(i => logger.info(`warming up ${i}`));
        expect(sink).toBeDefined();

        // measured here rather than written down: what formatting a stack costs depends on the
        // machine, and a fixed bar is only right for the one it was written on. A log call does more
        // than capture a stack, so it may cost more than one - formatting a whole stack on top of the
        // rest cost about twice this bar
        const captureCost: number = perCallMicroseconds(() => {
            sink = new Error('a stack').stack;
        });
        const logCost: number = perCallMicroseconds(i => logger.info(`found project ${i}`));

        expect(logCost).toBeLessThan(captureCost * 2);
    }, 60000);
});