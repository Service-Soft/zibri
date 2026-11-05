// Fixture: a job that never ends on its own, reporting progress as it goes - the shape of a job still
// running on an instance whose claim on it was taken away.
//
// Compiled rather than TypeScript for the reason the other commonjs fixture is.
const { reportProgress } = require('../../../dist/cjs/multithreading/services/worker/helpers.js');

let progress = 1;
// never 100, which would complete the job
setInterval(() => reportProgress(Math.min(progress++, 99)), 100);