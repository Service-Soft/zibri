import { describe, expect, it, jest } from '@jest/globals';

import { logToConsole } from './log-to-console.function';
import { BaseLoggerTransportConfig } from './logger-transport.model';
import { errorToLoggedError } from '../error-to-logged-error.function';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';

function createLog(level: LogLevel, overrides: Partial<Log> = {}): Log {
    return {
        id: 'id',
        application: 'Task tracker',
        createdAt: new Date(),
        cleanupAt: new Date(),
        message: 'the message',
        level,
        context: { origin: 'origin.ts' },
        ...overrides
    };
}

const config: BaseLoggerTransportConfig = { name: 'ConsoleLoggerTransport', level: LogLevel.DEBUG, register: 'directly' };

describe('logToConsole', () => {
    it('logs a DEBUG message with console.debug', async () => {
        const spy: jest.SpiedFunction<typeof console.debug> = jest.spyOn(console, 'debug').mockImplementation(() => undefined);

        await logToConsole([createLog(LogLevel.DEBUG)], config);

        expect(spy).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('origin.ts'));
        expect(spy).toHaveBeenCalledWith('the message');
        spy.mockRestore();
    });

    it('logs an INFO message with console.info', async () => {
        const spy: jest.SpiedFunction<typeof console.info> = jest.spyOn(console, 'info').mockImplementation(() => undefined);

        await logToConsole([createLog(LogLevel.INFO)], config);

        expect(spy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'the message');
        spy.mockRestore();
    });

    it('logs a WARN message with console.warn', async () => {
        const spy: jest.SpiedFunction<typeof console.warn> = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        await logToConsole([createLog(LogLevel.WARN)], config);

        expect(spy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'the message');
        spy.mockRestore();
    });

    it('logs an ERROR message with console.error, including each error paragraph', async () => {
        const spy: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await logToConsole([
            createLog(LogLevel.ERROR, {
                context: { origin: 'origin.ts', error: { name: 'Error', paragraphs: ['paragraph 1', 'paragraph 2'], stackTrace: [] } }
            })
        ], config);

        expect(spy).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('origin.ts'));
        expect(spy).toHaveBeenCalledWith('paragraph 1');
        expect(spy).toHaveBeenCalledWith('paragraph 2');
        expect(spy).not.toHaveBeenCalledWith('stack trace:');
        spy.mockRestore();
    });

    it('logs the stack trace of an error after its paragraphs, once', async () => {
        const spy: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const error: Error = new Error('the database is down');

        await logToConsole([createLog(LogLevel.ERROR, { context: { origin: 'origin.ts', error: errorToLoggedError(error) } })], config);

        expect(spy.mock.calls.slice(1)).toEqual([
            ['the database is down'],
            ['stack trace:'],
            ...error.stack?.split('\n').map(line => [`    ${line}`]) ?? []
        ]);
        spy.mockRestore();
    });

    it('logs a CRITICAL message with console.error, including each error paragraph', async () => {
        const spy: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await logToConsole([
            createLog(LogLevel.CRITICAL, {
                context: { origin: 'origin.ts', error: { name: 'Error', paragraphs: ['boom'], stackTrace: [] } }
            })
        ], config);

        expect(spy).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('origin.ts'));
        expect(spy).toHaveBeenCalledWith('boom');
        spy.mockRestore();
    });

    it('does not throw for ERROR/CRITICAL logs without an attached error', () => {
        const spy: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => logToConsole([createLog(LogLevel.ERROR)], config)).not.toThrow();

        spy.mockRestore();
    });
});