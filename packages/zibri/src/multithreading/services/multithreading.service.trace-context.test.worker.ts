// Fixture: completes with the trace context the job was handed, so the test can compare it with the
// span the job was recorded as.
import { getThreadJobTraceContext, reportCompletion } from './worker/helpers.ts';

reportCompletion(getThreadJobTraceContext());