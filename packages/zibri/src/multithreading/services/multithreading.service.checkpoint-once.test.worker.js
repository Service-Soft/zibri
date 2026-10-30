// Fixture: a job that stores one checkpoint halfway and completes, reporting the checkpoint it was
// started with, if any, and the idempotency key of the work after its checkpoint.
//
// Compiled rather than TypeScript for the reason the other commonjs fixture is.
const {
    getThreadJobCheckpoint,
    getThreadJobIdempotencyKey,
    reportCheckpoint,
    reportCompletion
} = require('../../../dist/cjs/multithreading/services/worker/helpers.js');

// eslint-disable-next-line jsdoc/require-jsdoc
async function run() {
    const resumed = getThreadJobCheckpoint();
    if (resumed == undefined) {
        await reportCheckpoint(50, { half: 'done' });
    }
    reportCompletion({ resumed: resumed ?? null, idempotencyKey: getThreadJobIdempotencyKey('mail') });
}

void run();