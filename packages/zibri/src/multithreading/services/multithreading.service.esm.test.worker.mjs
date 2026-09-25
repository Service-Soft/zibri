// Fixture: an es module worker file, rather than the TypeScript and commonjs ones every other
// fixture here is. Loading one and running one again are both different, and neither difference is
// visible from a file that is neither.
//
// The helpers are imported from the build rather than from source, because source is TypeScript and
// an es module cannot import that - which is the same reason this file exists.
import { workerData } from 'node:worker_threads';

import { reportCompletion } from '../../../dist/cjs/multithreading/services/worker/helpers.js';

reportCompletion(workerData.amount * 2);