// Fixture: an es module worker file, rather than the TypeScript and commonjs ones every other
// fixture here is. Loading one and running one again are both different, and neither difference is
// visible from a file that is neither.
//
// The helpers are imported from the build rather than from source, because source is TypeScript and
// a plain JavaScript file must not need a TypeScript loader to run.
import { workerData } from 'node:worker_threads';

import { reportCompletion } from '../../../dist/multithreading/services/worker/helpers.js';

reportCompletion(workerData.amount * 2);