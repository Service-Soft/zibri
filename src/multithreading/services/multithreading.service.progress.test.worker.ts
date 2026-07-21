// Fixture: reports progress via reportProgress(), then completes after a short delay —
// used to assert that ThreadJobEntity.progress reflects an in-flight progress report.
import { reportCompletion, reportProgress } from './worker/helpers';

reportProgress(50);
setTimeout(() => reportCompletion('done'), 500);