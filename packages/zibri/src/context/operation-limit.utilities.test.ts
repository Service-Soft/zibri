import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { AlsUtilities } from './als.utilities.ts';
import { OperationLimitUtilities } from './operation-limit.utilities.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';

describe('OperationLimitUtilities', () => {
    it('fires the signal of the work once it has run out of time', async () => {
        const aborted: unknown = await OperationLimitUtilities.runWithin(20, 'The work', async () => {
            await sleep(60);
            // eslint-disable-next-line typescript/no-unsafe-return
            return AlsUtilities.findCurrentSignal()?.reason;
        });

        expect(aborted).toBeInstanceOf(InternalError);
        expect(String(aborted)).toContain('The work took longer than the 20ms it was given.');
    });

    it('never lets an inner limit outlast an outer one', async () => {
        // the inner limit is longer, and started inside the outer one: it still ends with it, or a
        // call made inside another call would get to run past the time the outer one was given
        const aborted: boolean | undefined = await OperationLimitUtilities.runWithin(20, 'The outer work', async () => {
            return await OperationLimitUtilities.runWithin(1000, 'The inner work', async () => {
                await sleep(60);
                return AlsUtilities.findCurrentSignal()?.aborted;
            });
        });

        expect(aborted).toBe(true);
    });

    it('lifts the time limit without a deadline of its own for 0', async () => {
        const limit: unknown = await OperationLimitUtilities.runWithin(0, 'The work', async () => {
            return await Promise.resolve(AlsUtilities.findCurrentOperationLimit());
        });

        expect(limit).toEqual({ timeoutInMs: 0, signal: undefined });
    });

    it.each([
        ['a negative timeout', -1],
        ['a fraction', 1.5]
    ])('refuses %s', async (_, timeoutInMs) => {
        await expect(OperationLimitUtilities.runWithin(timeoutInMs, 'The work', async () => await Promise.resolve()))
            .rejects.toThrow('a timeout has to be a whole number of milliseconds');
    });
});