import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ValKeyClock } from './val-key-clock.model';
import { Ms } from '../../../utilities/ms';

/**
 * A server clock standing an hour ahead of this process, counting how often it is read.
 */
class ServerClock {
    reads: number = 0;

    readonly aheadInMs: number = Ms.HOUR;

    readonly read: () => Promise<number> = async () => {
        this.reads++;
        return await Promise.resolve(Date.now() + this.aheadInMs);
    };
}

// the valkey data source read the server's clock before every call naming the
// time of the data source, a round trip each
describe('ValKeyClock', () => {
    let server: ServerClock;
    let clock: ValKeyClock;

    beforeEach(() => {
        jest.useFakeTimers();
        server = new ServerClock();
        clock = new ValKeyClock(server.read);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('answers by the server\'s clock, reading it once for many calls', async () => {
        await clock.synchronize();

        jest.advanceTimersByTime(Ms.SECOND * 10);
        const now: Date = await clock.resolveNow();
        await clock.resolveNow();

        expect(now.getTime()).toBe(Date.now() + server.aheadInMs);
        expect(server.reads).toBe(1);
    });

    it('reads the server once for every call asking while a reading is underway', async () => {
        await Promise.all([clock.resolveNow(), clock.resolveNow(), clock.synchronize()]);

        expect(server.reads).toBe(1);
    });

    it('reads the server again once its reading is a minute old', async () => {
        await clock.synchronize();

        jest.advanceTimersByTime(Ms.MINUTE);
        const now: Date = await clock.resolveNow();

        expect(server.reads).toBe(2);
        expect(now.getTime()).toBe(Date.now() + server.aheadInMs);
    });

    it('reads the server again after a reading failed', async () => {
        const failing: ValKeyClock = new ValKeyClock(async () => {
            if (!server.reads++) {
                throw new Error('connection lost');
            }
            return await Promise.resolve(Date.now());
        });

        await expect(failing.resolveNow()).rejects.toThrow('connection lost');
        await expect(failing.resolveNow()).resolves.toEqual(expect.any(Date));
        expect(server.reads).toBe(2);
    });
});