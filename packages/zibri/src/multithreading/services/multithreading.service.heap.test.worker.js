// Fixture: reports the heap the thread it runs on was given, as v8 sees it from inside and as node
// states its limits. Compiled, for the reason multithreading.service.test.worker.js gives.
const v8 = require('node:v8');
const { resourceLimits } = require('node:worker_threads');
const { reportCompletion } = require('../../../dist/cjs/multithreading/services/worker/helpers.js');

const MEGABYTE = 1024 * 1024;

reportCompletion({ heapLimitMb: v8.getHeapStatistics().heap_size_limit / MEGABYTE, limits: resourceLimits });