import path from 'node:path';

// With coverage taken from v8, Jest's own process keeps what every test file reports until the run
// is done, and only then merges it. What a file reports carries the original and the transformed
// source of every module it loaded, so a file that loads the framework adds the framework's sources
// to that process once more, unless the runner hands it a copy the run holds already
// (src/__testing__/deduplicating-coverage.test-runner.ts).
//
// This prints, after every file, how much source the run holds so far, each copy counted once, and
// how much heap Jest's process uses. When a coverage run runs out of memory, the slope says what grows.
//
//   cd packages/zibri && npx jest <pattern> --coverage --reporters=default --reporters='<rootDir>/../scripts/coverage-memory.reporter.mjs'

const MEGABYTE = 1024 * 1024;

export default class CoverageMemoryReporter {
    #files = 0;

    #sourceBytes = 0;

    #counted = new WeakSet();

    onTestResult(test, testResult) {
        this.#files++;
        for (const { codeTransformResult } of testResult.v8Coverage ?? []) {
            if (codeTransformResult == undefined || this.#counted.has(codeTransformResult)) {
                continue;
            }
            this.#counted.add(codeTransformResult);
            this.#sourceBytes += codeTransformResult.code.length + codeTransformResult.originalCode.length;
        }
        const heap = Math.round(process.memoryUsage().heapUsed / MEGABYTE);
        const sources = Math.round(this.#sourceBytes / MEGABYTE);
        const testFile = path.relative(process.cwd(), test.path);
        process.stderr.write(`coverage memory: ${this.#files} files, ${sources} MB of sources, ${heap} MB heap - ${testFile}\n`);
    }
}