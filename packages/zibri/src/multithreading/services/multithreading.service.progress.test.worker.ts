// Fixture: reports progress via reportProgress(), then completes after a short delay —
// used to assert that ThreadJobEntity.progress reflects an in-flight progress report.
import { reportCompletion, reportProgress } from './worker/helpers.ts';

reportProgress(50);
// long enough that the mid flight state is there to be read once the reader gets to it. Half a
// second was the window minus whatever starting this worker cost, and starting a typescript worker
// starts a compiler with it - so on a loaded machine the window closed before it opened.
setTimeout(() => reportCompletion('done'), 2000);