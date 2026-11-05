import { describe, expect, it } from '@jest/globals';

import { LogBuffer } from './log-buffer';
import { LogLevel } from './log-level.enum';
import { Log } from './log.model';

/**
 * The drop policy, which is the whole point of the buffer.
 *
 * Pure logic over plain objects, so it is tested directly rather than through a running server -
 * driving "the queue is full and a critical error arrives" through a real log transport would prove
 * less while taking a container to do it.
 */

let nextId: number = 0;

function log(level: LogLevel, message: string = `message ${nextId}`): Log {
    const res: Log = new Log();
    res.id = `${nextId++}`;
    res.level = level;
    res.message = message;
    res.context = { origin: 'log-buffer.test.ts' };
    res.createdAt = new Date();
    res.cleanupAt = new Date();
    return res;
}

function levelsIn(buffer: LogBuffer): LogLevel[] {
    return buffer.takeAll().map(l => l.level);
}

describe('LogBuffer', () => {
    it('holds everything while there is room', () => {
        const buffer: LogBuffer = new LogBuffer(3);
        buffer.add(log(LogLevel.INFO));
        buffer.add(log(LogLevel.WARN));

        expect(buffer.size).toBe(2);
        expect(buffer.takeDropped()).toBe(0);
    });

    it('returns entries oldest first', () => {
        const buffer: LogBuffer = new LogBuffer(3);
        buffer.add(log(LogLevel.INFO, 'first'));
        buffer.add(log(LogLevel.INFO, 'second'));

        expect(buffer.takeAll().map(l => l.message)).toEqual(['first', 'second']);
    });

    it('empties itself when taken from', () => {
        const buffer: LogBuffer = new LogBuffer(2);
        buffer.add(log(LogLevel.INFO));
        buffer.takeAll();

        expect(buffer.size).toBe(0);
        expect(buffer.takeAll()).toEqual([]);
    });

    it('drops a debug line rather than an error it cannot fit beside', () => {
        const buffer: LogBuffer = new LogBuffer(2);
        buffer.add(log(LogLevel.ERROR, 'kept'));
        buffer.add(log(LogLevel.ERROR, 'also kept'));

        buffer.add(log(LogLevel.DEBUG, 'not important enough'));

        // the incoming entry is the least important thing in play, so it never gets in
        expect(buffer.takeDropped()).toBe(1);
        expect(levelsIn(buffer)).toEqual([LogLevel.ERROR, LogLevel.ERROR]);
    });

    it('makes room for an error by dropping the least important entry held', () => {
        const buffer: LogBuffer = new LogBuffer(2);
        buffer.add(log(LogLevel.DEBUG, 'evicted'));
        buffer.add(log(LogLevel.WARN, 'kept'));

        buffer.add(log(LogLevel.ERROR, 'kept too'));

        expect(buffer.takeDropped()).toBe(1);
        expect(levelsIn(buffer)).toEqual([LogLevel.WARN, LogLevel.ERROR]);
    });

    it('drops the oldest of the least important level, not just any of them', () => {
        const buffer: LogBuffer = new LogBuffer(3);
        buffer.add(log(LogLevel.INFO, 'oldest info'));
        buffer.add(log(LogLevel.INFO, 'newer info'));
        buffer.add(log(LogLevel.ERROR, 'error'));

        buffer.add(log(LogLevel.CRITICAL, 'critical'));

        expect(buffer.takeAll().map(l => l.message)).toEqual(['newer info', 'error', 'critical']);
    });

    it('drops the oldest when everything held is the same level as the newcomer', () => {
        const buffer: LogBuffer = new LogBuffer(2);
        buffer.add(log(LogLevel.ERROR, 'oldest'));
        buffer.add(log(LogLevel.ERROR, 'middle'));

        buffer.add(log(LogLevel.ERROR, 'newest'));

        // during an incident the newest occurrences describe what is happening now, and plenty of
        // the older ones have already been written
        expect(buffer.takeDropped()).toBe(1);
        expect(buffer.takeAll().map(l => l.message)).toEqual(['middle', 'newest']);
    });

    it('keeps a critical entry even when the queue is full of errors', () => {
        const buffer: LogBuffer = new LogBuffer(2);
        buffer.add(log(LogLevel.ERROR, 'evicted'));
        buffer.add(log(LogLevel.ERROR, 'kept'));

        buffer.add(log(LogLevel.CRITICAL, 'critical'));

        expect(buffer.takeAll().map(l => l.message)).toEqual(['kept', 'critical']);
    });

    it('counts every drop and reports each one only once', () => {
        const buffer: LogBuffer = new LogBuffer(1);
        buffer.add(log(LogLevel.ERROR));
        buffer.add(log(LogLevel.DEBUG));
        buffer.add(log(LogLevel.DEBUG));

        expect(buffer.takeDropped()).toBe(2);
        // taken, so the next report starts from nothing rather than counting them again
        expect(buffer.takeDropped()).toBe(0);
    });

    it('never grows past its capacity, whatever arrives', () => {
        const buffer: LogBuffer = new LogBuffer(4);
        const levels: [LogLevel, ...LogLevel[]] = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.CRITICAL];

        for (let i: number = 0; i < 500; i++) {
            buffer.add(log(levels[i % levels.length] ?? levels[0]));
            expect(buffer.size).toBeLessThanOrEqual(4);
        }

        // the point of the whole class: the producer never made the consumer's problem worse
        expect(buffer.size).toBe(4);
    });
});