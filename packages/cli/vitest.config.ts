import { defineConfig } from 'vitest/config';

/**
 * The suites that generate and install a whole project, and run one at a time.
 */
const HEAVY: string = 'src/**/*.heavy.test.ts';

export default defineConfig({
    test: {
        // what a spy recorded while a suite set up stays for its tests to assert on: the parity suites run
        // the generator once, in beforeAll
        clearMocks: false,
        // what the tests write. A generated project carries a test of its own, and it is meant to run
        // inside that project against its own installed framework rather than to be collected as one of
        // this package's suites.
        exclude: ['**/node_modules/**', '**/dist/**', '**/file-output/**'],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'src/__testing__/coverage',
            exclude: [
                '**/node_modules/**',
                '**/dist/**',
                'src/__testing__/**',
                // what the cli writes rather than what it is. A template is copied into a generated project
                // and compiled there, so the lines it does or does not execute belong to that project
                'templates/**'
            ]
        },
        projects: [
            {
                extends: true,
                test: { name: 'normal', include: ['src/**/*.test.ts'], exclude: [HEAVY] }
            },
            {
                extends: true,
                test: { name: 'heavy', include: [HEAVY], fileParallelism: false }
            }
        ]
    }
});
