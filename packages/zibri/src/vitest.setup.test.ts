import { describe, expect, it } from 'vitest';

/**
 * Throws from outside the test's own call stack, where no try/catch or rejected promise reaches it.
 * @returns Once the throw has happened.
 */
async function throwUncaught(): Promise<void> {
    process.nextTick(() => {
        throw new Error('thrown from a nextTick callback');
    });
    await new Promise(resolve => setImmediate(resolve));
}

describe('the uncaught exception guard', () => {
    it.fails('fails the test an uncaught exception was thrown in', async () => {
        await throwUncaught();
        // everything the test itself asserts holds, so only the guard can fail it
        expect(true).toBe(true);
    });

    it.fails('fails it while a handler that rethrows is listening, the way a running application\'s does', async () => {
        // reached, this would end the worker and every test left in the file with it
        const rethrow: (error: Error) => void = (error: Error) => {
            process.off('uncaughtException', rethrow);
            throw error;
        };
        process.on('uncaughtException', rethrow);
        try {
            await throwUncaught();
        }
        finally {
            process.off('uncaughtException', rethrow);
        }
    });

    it('lets the tests after one that threw run', () => {
        expect(process.hasUncaughtExceptionCaptureCallback()).toBe(true);
    });
});
