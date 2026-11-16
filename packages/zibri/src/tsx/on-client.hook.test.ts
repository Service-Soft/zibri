import { describe, expect, it } from '@jest/globals';

import { onClient } from './on-client.hook';

describe('onClient', () => {
    it('runs nothing on the server', () => {
        let ran: boolean = false;

        onClient(() => {
            ran = true;
        });

        expect(ran).toBe(false);
    });

    // the typecheck runs these: what a callback may return
    it('takes a callback returning nothing, a promise, or a cleanup', () => {
        onClient(() => undefined);
        onClient(async () => {
            await Promise.resolve();
        });
        onClient(() => {
            const timer: ReturnType<typeof setInterval> = setInterval(() => undefined, 1000);
            return () => clearInterval(timer);
        });
        // @ts-expect-error a callback returns nothing, a promise, or a cleanup
        onClient(() => 'done');

        expect(true).toBe(true);
    });
});