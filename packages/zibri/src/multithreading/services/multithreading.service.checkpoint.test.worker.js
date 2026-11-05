// Fixture: a job that stores a checkpoint after every step and goes on until it is taken away, and that
// reports what it resumed from once it is started again after a stored checkpoint.
//
// Compiled rather than TypeScript for the reason the other commonjs fixture is.
const { setTimeout: sleep } = require('node:timers/promises');

const {
    getThreadJobCheckpoint,
    getThreadJobId,
    getThreadJobIdempotencyKey,
    reportCheckpoint,
    reportCompletion
} = require('../../../dist/cjs/multithreading/services/worker/helpers.js');

// eslint-disable-next-line jsdoc/require-jsdoc
async function run() {
    const resumed = getThreadJobCheckpoint();
    if (resumed != undefined) {
        // long enough for the test to read the row while the resumed run is going
        await sleep(1000);
        reportCompletion({ resumed, jobId: getThreadJobId(), idempotencyKey: getThreadJobIdempotencyKey('mail') });
        return;
    }
    for (let next = 1; ; next++) {
        // never 100. A checkpoint refused because the job was taken over rejects, and ends this run
        await reportCheckpoint(Math.min(next * 10, 90), { next });
        await sleep(100);
    }
}

void run();