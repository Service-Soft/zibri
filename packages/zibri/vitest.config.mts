import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The suites that run on their own: they take long, and most of them measure or stress something that
 * suites running beside them would distort.
 */
const HEAVY: string[] = [
    'src/**/multithreading.service.performance.test.ts',
    'src/**/pay-pal.payment-provider.test.ts',
    'src/**/base-keycloak.authenticator.test.ts',
    'src/**/*.heavy.test.ts'
];
const EVALUATION: string = 'src/**/*.evaluation.test.ts';
const CLUSTER: string = 'src/**/*.cluster.test.ts';
const BENCHMARK: string = 'src/**/*.benchmark.test.ts';

export default defineConfig({
    // the framework's decorators are TypeScript's legacy ones, and dependency injection by declared type
    // reads the metadata they write. Set here rather than read from the tsconfig, which Vite only uses
    // for some of its options
    oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
    resolve: {
        // both names resolve to the sources beside this file rather than to a built `dist`: one physical
        // copy of the framework in the process, and no build to go stale between a change and its test
        alias: [
            { find: /^zibri$/, replacement: path.resolve(import.meta.dirname, 'src', 'index.ts') },
            { find: /^zibri-testing$/, replacement: path.resolve(import.meta.dirname, '..', 'testing', 'src', 'index.ts') }
        ]
    },
    test: {
        // what a spy recorded while a suite set up stays for its tests to assert on: several suites watch the
        // application start, which happens in beforeAll
        clearMocks: false,
        globalSetup: ['src/vitest.global-setup.ts'],
        setupFiles: ['src/vitest.setup.ts'],
        // the folders tests write applications and packages into, which hold files named like tests
        exclude: ['**/node_modules/**', '**/dist/**', '**/file-output/**', '**/tmp/**'],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'src/__testing__/coverage',
            exclude: ['**/node_modules/**', '**/dist/**', '**/mock/**', '**/sandbox/**', 'src/__testing__/**']
        },
        projects: [
            {
                extends: true,
                test: { name: 'normal', include: ['src/**/*.test.ts'], exclude: [...HEAVY, EVALUATION, CLUSTER, BENCHMARK] }
            },
            {
                extends: true,
                test: { name: 'heavy', include: HEAVY, fileParallelism: false }
            },
            {
                extends: true,
                test: { name: 'evaluation', include: [EVALUATION] }
            },
            {
                extends: true,
                test: { name: 'cluster', include: [CLUSTER], fileParallelism: false }
            },
            {
                extends: true,
                test: { name: 'benchmark', include: [BENCHMARK], fileParallelism: false }
            }
        ]
    }
});
