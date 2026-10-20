import { threadId } from 'node:worker_threads';

import { reportCompletion } from './worker/helpers.ts';

// Fixture: reports which thread it ran on, so a test can tell whether the worker it landed on is
// the same one as last time or a replacement.
reportCompletion(threadId);