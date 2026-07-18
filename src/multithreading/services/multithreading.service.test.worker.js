const { workerData } = require('node:worker_threads');
const { reportCompletion } = require('./worker/helpers');

// eslint-disable-next-line jsdoc/require-jsdoc
function fib(n) {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}

const res = fib(workerData.amount);

reportCompletion(res);