import { workerData } from 'node:worker_threads';

import { reportCompletion } from './worker/helpers';

// eslint-disable-next-line jsdoc/require-jsdoc
function fib(n: number): number {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}

// eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
const res: number = fib(workerData.amount);

reportCompletion(res);