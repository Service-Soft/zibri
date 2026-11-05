import TestRunner, { TestEvents, UnsubscribeFn } from 'jest-runner';

/**
 * What a test file reports once it ran.
 */
type TestFileResult = TestEvents['test-file-success'][1];

/**
 * The sources a test file reports for one module it loaded, when it ran with coverage.
 */
type ModuleSources = NonNullable<NonNullable<TestFileResult['v8Coverage']>[number]['codeTransformResult']>;

/**
 * An event of the runner, with what it carries.
 */
type TestRunnerEvent = {
    /**
     * The event.
     */
    name: keyof TestEvents,
    /**
     * What it carries.
     */
    data: TestEvents[keyof TestEvents]
};

/**
 * The event that carries the result of a test file.
 */
type TestFileSuccessEvent = {
    /**
     * The event.
     */
    name: 'test-file-success',
    /**
     * The test file, and its result.
     */
    data: TestEvents['test-file-success']
};

/**
 * Whether an event of the runner is the result of a test file.
 * @param event - The event.
 * @returns Whether it is that result.
 */
function isTestFileSuccess(event: TestRunnerEvent): event is TestFileSuccessEvent {
    return event.name === 'test-file-success';
}

/**
 * Jest's own runner, holding each source a coverage run collects only once.
 *
 * With coverage taken from v8, every test file reports the original and the transformed source of
 * each module it loaded, and Jest's process keeps all of them until the run is done.
 * `scripts/coverage-memory.reporter.mjs` measures what that adds up to.
 */
export default class DeduplicatingCoverageTestRunner extends TestRunner {
    private readonly sourcesByModule: Map<string, ModuleSources> = new Map();

    override on<Name extends keyof TestEvents>(
        eventName: Name,
        listener: (eventData: TestEvents[Name]) => void | Promise<void>
    ): UnsubscribeFn {
        return super.on(eventName, async eventData => {
            const event: TestRunnerEvent = { name: eventName, data: eventData };
            if (isTestFileSuccess(event)) {
                this.shareSources(event.data[1]);
            }
            await listener(eventData);
        });
    }

    // in place, before any reporter sees the result: the aggregated results hold the same object.
    // Every result keeps sources, the copy kept first, rather than only the first result: jest turns
    // some results into failures before the coverage reporter sees them, and a module whose sources
    // came only with one of those was converted without its source map
    private shareSources(testFileResult: TestFileResult): void {
        for (const coverage of testFileResult.v8Coverage ?? []) {
            const sources: ModuleSources | undefined = coverage.codeTransformResult;
            if (sources == undefined) {
                continue;
            }
            const kept: ModuleSources | undefined = this.sourcesByModule.get(coverage.result.url);
            if (kept == undefined) {
                this.sourcesByModule.set(coverage.result.url, sources);
                continue;
            }
            if (kept.code === sources.code && kept.originalCode === sources.originalCode && kept.sourceMapPath === sources.sourceMapPath) {
                coverage.codeTransformResult = kept;
            }
        }
    }
}