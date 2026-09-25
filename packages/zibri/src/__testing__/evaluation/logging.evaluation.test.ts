import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { DiContainer } from '../../di/di-container';
import { initDiContainer } from '../../di/init-di-container.function';
import { inject } from '../../di/inject.function';
import { LoggerInterface } from '../../logging/logger.interface';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 3.2.
 *
 * The logger derives an "origin" string by materializing a V8 stack trace on every call and
 * indexing line 3 of it. Both consequences are observable in-process: the cost, and the fact that
 * a routine production tuning breaks logging outright. No source inspection, no containers.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ./README.md for why.
 */

let logger: LoggerInterface;
const originalStackTraceLimit: number = Error.stackTraceLimit;

beforeAll(() => {
    // the logger is a plain DI provider, so the container is all it needs
    DiContainer.reset();
    initDiContainer();
    logger = inject(ZIBRI_DI_TOKENS.LOGGER);
});

afterAll(() => {
    Error.stackTraceLimit = originalStackTraceLimit;
});

describe('evaluation/04-infrastructure-subsystems 3.2 - logging cost and robustness', () => {

    it('keeps working when stack trace capture is turned off', () => {
        // sanity first: if this throws, the rest of the file is measuring the wrong thing
        logger.info('evaluation baseline');

        Error.stackTraceLimit = 0;
        try {
            // `(new Error().stack ?? '').split('\n')[3]` is undefined once the limit is 0, and the
            // very next line calls .match on it. Setting stackTraceLimit to 0 is a normal
            // production tuning, and it makes every single log call throw a TypeError.
            expect(() => logger.info('evaluation with stack traces disabled')).not.toThrow();
        }
        finally {
            Error.stackTraceLimit = originalStackTraceLimit;
        }
    }, 15000);

    it('does not pay for a stack trace on every call', () => {
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

        // warm both paths, so neither measurement is paying for the first compile of what it runs
        let sink: string | undefined = undefined;
        perCallMicroseconds(() => {
            sink = new Error('evaluation stack capture').stack;
        });
        perCallMicroseconds(i => logger.info(`evaluation warmup ${i}`));
        expect(sink).toBeDefined();

        // the yardstick is measured here rather than written down: materializing a stack means
        // formatting every frame into text, and what that costs depends entirely on the machine. A
        // fixed microsecond bar can only ever be right for the machine it was written on - this one
        // was, and then failed on a busier one while the finding it guards stayed closed.
        const captureCost: number = perCallMicroseconds(() => {
            sink = new Error('evaluation stack capture').stack;
        });
        const logCost: number = perCallMicroseconds(i => logger.info(`evaluation throughput ${i}`));

        // a log call does a good deal besides: it formats a message, decides on a level, and hands
        // the entry to every transport. So it is allowed to cost more than a bare stack capture -
        // what it must not cost is *multiples* of one, which is what paying for a formatted stack on
        // top of all that looked like. It was around twice this bar when the finding was written.
        expect(logCost).toBeLessThan(captureCost * 2);
    }, 60000);
});