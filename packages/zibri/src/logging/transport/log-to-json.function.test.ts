import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { BaseLoggerTransportConfig, LoggerTransport } from './logger-transport.model';
import { HttpMethod } from '../../http/http-method.enum';
import { LogRequestContext } from '../log-context.model';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';

/**
 * An entry as the logger hands it to a transport.
 * @param level - Its level.
 * @param overrides - What differs from the default entry.
 * @returns The entry.
 */
function createLog(level: LogLevel, overrides: Partial<Log> = {}): Log {
    return {
        id: 'id',
        tenantId: 'team-1',
        createdAt: new Date('2026-10-28T09:30:00.000Z'),
        cleanupAt: new Date('2026-11-04T09:30:00.000Z'),
        message: 'the message',
        level,
        context: { origin: 'src/services/project.service.ts' },
        ...overrides
    };
}

describe('LoggerTransport.json', () => {
    let written: string[];
    let write: jest.SpiedFunction<typeof process.stdout.write>;

    beforeEach(() => {
        written = [];
        write = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
            written.push(String(chunk));
            return true;
        });
    });

    afterEach(() => {
        write.mockRestore();
    });

    it('writes one JSON object per entry and line, with the level, message, trace and origin', async () => {
        const transport: LoggerTransport<BaseLoggerTransportConfig> = LoggerTransport.json(LogLevel.INFO);
        const request: LogRequestContext = {
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            spanId: '00f067aa0ba902b7',
            method: HttpMethod.GET,
            url: '/projects',
            status: 200,
            userAgent: 'curl/8.10.1',
            clientIp: '203.0.113.7'
        };

        await transport.send([
            createLog(LogLevel.INFO, {
                message: 'GET /projects 200',
                context: { origin: 'src/services/project.service.ts', request }
            }),
            createLog(LogLevel.ERROR, {
                message: 'the database is down',
                context: { origin: 'src/services/project.service.ts', error: { name: 'Error', paragraphs: ['the database is down'], stackTrace: [] } }
            })
        ], transport.config);

        const lines: string[] = written.join('').split('\n');
        expect(lines.pop()).toBe('');
        expect(lines.map(line => JSON.parse(line) as unknown)).toEqual([
            {
                id: 'id',
                time: '2026-10-28T09:30:00.000Z',
                level: 'info',
                message: 'GET /projects 200',
                tenantId: 'team-1',
                traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
                spanId: '00f067aa0ba902b7',
                origin: 'src/services/project.service.ts',
                request
            },
            {
                id: 'id',
                time: '2026-10-28T09:30:00.000Z',
                level: 'error',
                message: 'the database is down',
                tenantId: 'team-1',
                origin: 'src/services/project.service.ts',
                error: { name: 'Error', paragraphs: ['the database is down'], stackTrace: [] }
            }
        ]);
    });

    it('keeps a message with line breaks on one line', async () => {
        const transport: LoggerTransport<BaseLoggerTransportConfig> = LoggerTransport.json(LogLevel.INFO);

        await transport.send([createLog(LogLevel.WARN, { message: 'first\nsecond' })], transport.config);

        expect(written.join('').split('\n')).toHaveLength(2);
        expect(JSON.parse(written.join('')) as unknown).toMatchObject({ level: 'warn', message: 'first\nsecond' });
    });
});