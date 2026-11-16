// Fixture: a process started under perf, as jest is by scripts/profile-benchmarks.mjs and a measured backup process is
// by its suite, which records a while of work through the control in its environment and tells the test once it did.
import { PerfRecordingUtilities } from './perf-recording.utilities';

/**
 * How long the recorded work keeps the main thread busy, many samples of perf.
 */
const BUSY_MS: number = 300;

void (async () => {
    const returned: number = await PerfRecordingUtilities.recordIfAsked(async () => {
        const until: number = performance.now() + BUSY_MS;
        while (performance.now() < until) {
            // the main thread working, for perf to sample
        }
        return await Promise.resolve(42);
    });
    process.send?.({ returned });
    process.disconnect?.();
})();