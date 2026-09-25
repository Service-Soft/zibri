// Fixture: a commonjs worker file, which is what a compiled worker file is.
//
// The helpers come from the build rather than from source, the same way the es module fixture takes
// them from there: source is TypeScript, and a plain JavaScript file reaching into it would only
// resolve while a TypeScript compiler happens to be hooked into `require` - which is exactly what a
// file like this must not need.
const { workerData } = require('node:worker_threads');
const { reportCompletion } = require('../../../dist/cjs/multithreading/services/worker/helpers.js');

// eslint-disable-next-line jsdoc/require-jsdoc
function fib(n) {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}

const res = fib(workerData.amount);

reportCompletion(res);