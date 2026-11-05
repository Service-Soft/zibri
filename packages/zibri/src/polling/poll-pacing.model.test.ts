import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { PollPacing } from './poll-pacing.model';
import { Ms } from '../utilities/ms';

describe('PollPacing', () => {
    let now: number;

    beforeEach(() => {
        now = Date.now();
        jest.useFakeTimers({ now });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /**
     * Moves the clock.
     * @param ms - By how much.
     */
    function advance(ms: number): void {
        now += ms;
        jest.setSystemTime(now);
    }

    /**
     * How long, in whole seconds, until the pacing is due again.
     * @param pacing - The pacing.
     * @returns The seconds.
     */
    function secondsUntilDue(pacing: PollPacing): number {
        let seconds: number = 0;
        while (!pacing.isDue) {
            advance(Ms.SECOND);
            seconds++;
        }
        return seconds;
    }

    it('is due before the first poll', () => {
        expect(new PollPacing(Ms.SECOND * 30).isDue).toBe(true);
    });

    it('waits longer after every poll that found nothing, up to the longest interval', () => {
        const pacing: PollPacing = new PollPacing(Ms.SECOND * 30);
        const waits: number[] = [];
        for (let i: number = 0; i < 8; i++) {
            pacing.recordPoll(false);
            waits.push(secondsUntilDue(pacing));
        }

        // each wait is between half its interval and all of it: 1, 2, 4, 8, 16, then 30 for good
        for (const [i, interval] of [1, 2, 4, 8, 16, 30, 30, 30].entries()) {
            expect(waits[i]).toBeGreaterThanOrEqual(interval / 2);
            expect(waits[i]).toBeLessThanOrEqual(interval);
        }
    });

    it('is due again at once after a poll that found work', () => {
        const pacing: PollPacing = new PollPacing(Ms.SECOND * 30);
        for (let i: number = 0; i < 5; i++) {
            pacing.recordPoll(false);
        }

        pacing.recordPoll(true);

        expect(pacing.isDue).toBe(true);
    });

    it('is due at once when woken, and waits from the start again after that', () => {
        const pacing: PollPacing = new PollPacing(Ms.SECOND * 30);
        for (let i: number = 0; i < 5; i++) {
            pacing.recordPoll(false);
        }

        pacing.wake();
        expect(pacing.isDue).toBe(true);

        pacing.recordPoll(false);
        expect(secondsUntilDue(pacing)).toBeLessThanOrEqual(1);
    });

    it('never waits when it has no longest interval', () => {
        const pacing: PollPacing = new PollPacing(0);

        pacing.recordPoll(false);
        pacing.recordPoll(false);

        expect(pacing.isDue).toBe(true);
    });
});