import { beforeEach, describe, expect, it } from 'vitest';

import { LogLevel } from './log-level.enum.ts';
import { Log } from './log.model.ts';
import { Logger } from './logger.ts';
import { BaseLoggerTransportConfig, LoggerTransport } from './transport/logger-transport.model.ts';
import { DiContainer } from '../di/di-container.ts';
import { initDiContainer } from '../di/init-di-container.function.ts';
import { Ms } from '../utilities/ms.ts';

/**
 * How the logger hands work to its transports.
 *
 * The logger buffers, so it already holds a batch by the time anything is written - and used to
 * unpack it and call every transport once per entry. That is one INSERT per log line on the db
 * transport and one queued mail per line on the email one, which is what
 * evaluation/04-infrastructure-subsystems.md 3.3 and 3.4 are about.
 *
 * Driven through the real Logger against transports that record what they were handed. No server
 * and no container: what is being asserted is the shape of the call, and the buffer is in process.
 */

/**
 * A transport that writes down each call it received, rather than the entries across all of them.
 */
type RecordingTransport = {
    /**
     * The transport to register.
     */
    transport: LoggerTransport<BaseLoggerTransportConfig>,
    /**
     * One entry per call, holding the batch that call was given.
     */
    calls: Log[][]
};

function recordingTransport(level: LogLevel = LogLevel.DEBUG): RecordingTransport {
    const calls: Log[][] = [];
    const transport: LoggerTransport<BaseLoggerTransportConfig> = LoggerTransport.create<BaseLoggerTransportConfig>(
        { level, name: 'RecordingTransport', register: 'directly' },
        (logs: Log[]) => {
            calls.push([...logs]);
        }
    );
    return { transport, calls };
}

function loggerWith(transports: LoggerTransport<BaseLoggerTransportConfig>[]): Logger {
    const cleanupAfterMs: Record<LogLevel, number> = {
        [LogLevel.DEBUG]: Ms.DAY,
        [LogLevel.INFO]: Ms.DAY,
        [LogLevel.WARN]: Ms.DAY,
        [LogLevel.ERROR]: Ms.DAY,
        [LogLevel.CRITICAL]: Ms.DAY
    };
    // the real default, so what is asserted is the batching a deployment actually gets rather than
    // one this test arranged
    return new Logger(transports, cleanupAfterMs, 10000, Ms.SECOND);
}

beforeEach(() => {
    DiContainer.reset();
    initDiContainer();
});

describe('Logger batching', () => {

    it('hands a transport everything queued in one call', async () => {
        const { transport, calls }: RecordingTransport = recordingTransport();
        const logger: Logger = loggerWith([transport]);

        for (let i: number = 0; i < 50; i++) {
            logger.info(`entry ${i}`);
        }
        await logger.flush();

        // the entries all arrive, however they were split up
        expect(calls.flat()).toHaveLength(50);
        // and they arrive together. One call per entry is 50 INSERTs where one statement would do,
        // and 50 queued mails where one digest would do - the logger holds the whole batch already
        expect(calls).toHaveLength(1);
        expect(calls[0]).toHaveLength(50);
    }, 15000);

    it('lets entries gather before writing them', async () => {
        const { transport, calls }: RecordingTransport = recordingTransport();
        const logger: Logger = loggerWith([transport]);

        // one entry, then the rest a tick later - which is the shape the access log produces, one
        // line per request rather than a burst
        logger.info('first request');
        await new Promise<void>(resolve => setImmediate(resolve));
        logger.info('second request');
        logger.info('third request');
        await logger.flush();

        // draining the instant an entry arrives writes the first one alone every time, so an
        // application logging one line per request gets one write per request and the batch buys
        // nothing on the one path it was built for. The interval is what makes them share a write
        expect(calls).toHaveLength(1);
        expect(calls[0]).toHaveLength(3);
    }, 15000);

    it('keeps the entries in the order they were logged', async () => {
        const { transport, calls }: RecordingTransport = recordingTransport();
        const logger: Logger = loggerWith([transport]);

        logger.info('first');
        logger.info('second');
        logger.info('third');
        await logger.flush();

        // a batch is only useful if it still says what happened when. The buffer holds entries
        // oldest first and nothing in the batching may reorder them
        expect(calls.flat().map(l => l.message)).toEqual(['first', 'second', 'third']);
    }, 15000);

    it('gives each transport only the entries its level admits', async () => {
        const everything: RecordingTransport = recordingTransport(LogLevel.DEBUG);
        const errorsOnly: RecordingTransport = recordingTransport(LogLevel.ERROR);
        const logger: Logger = loggerWith([everything.transport, errorsOnly.transport]);

        logger.info('routine');
        logger.error(new Error('broken'));
        await logger.flush();

        // the level filter used to run per entry, which is the one thing a batch could quietly
        // lose - a transport configured for errors must not be handed the info lines just because
        // they shared a drain
        expect(everything.calls.flat()).toHaveLength(2);
        expect(errorsOnly.calls.flat().map(l => l.message)).toEqual(['broken']);
    }, 15000);

    it('does not call a transport at all when the batch holds nothing for it', async () => {
        const errorsOnly: RecordingTransport = recordingTransport(LogLevel.ERROR);
        const everything: RecordingTransport = recordingTransport(LogLevel.DEBUG);
        const logger: Logger = loggerWith([everything.transport, errorsOnly.transport]);

        logger.info('routine');
        await logger.flush();

        // an empty batch is a round trip that buys nothing - the db transport would open a
        // transaction to write no rows, and the email one would send a digest of nothing
        expect(errorsOnly.calls).toHaveLength(0);
        expect(everything.calls).toHaveLength(1);
    }, 15000);

    it('carries on with the other transports when one of them throws', async () => {
        const working: RecordingTransport = recordingTransport();
        const failing: LoggerTransport<BaseLoggerTransportConfig> = LoggerTransport.create<BaseLoggerTransportConfig>(
            { level: LogLevel.DEBUG, name: 'FailingTransport', register: 'directly' },
            () => {
                throw new Error('the aggregator is down');
            }
        );
        const logger: Logger = loggerWith([failing, working.transport]);

        logger.info('still worth writing');
        await expect(logger.flush()).resolves.not.toThrow();

        // batching must not make one broken transport lose the batch for the others. It was already
        // true per entry and has to stay true per batch, which is a bigger blast radius
        expect(working.calls.flat().map(l => l.message)).toEqual(['still worth writing']);
    }, 15000);
});