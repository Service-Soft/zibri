import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import ts from 'typescript';

/**
 * How much the child writes before exiting - far more than one write to a pipe takes at once, so
 * some of it is still queued when the exit is asked for.
 */
const WRITTEN_BYTES: number = 1024 * 1024;

/**
 * Runs the real `exitGracefully` in a process of its own, since exiting is what it does.
 *
 * The child keeps a timer running, which is what a test runner or a server does to the event loop:
 * without it the process would end on `process.exitCode` whether the function worked or not.
 * @returns How the child ended, and what it wrote.
 */
function runExitingChild(): SpawnSyncReturns<string> {
    const source: string = readFileSync(path.join(__dirname, 'exit-gracefully.function.ts'), 'utf8');
    const compiled: string = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const script: string = [
        compiled,
        'setInterval(() => {}, 1000);',
        `process.stdout.write('x'.repeat(${WRITTEN_BYTES}));`,
        'void exports.exitGracefully(3);'
    ].join('\n');
    return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000, maxBuffer: WRITTEN_BYTES * 2 });
}

describe('exitGracefully', () => {
    it('exits with the code once everything written has gone out, even while something holds the process open', () => {
        const res: SpawnSyncReturns<string> = runExitingChild();

        // killed by the timeout rather than exited is the failure this guards against
        expect(res.signal).toBeNull();
        expect(res.status).toBe(3);
        expect(res.stdout).toHaveLength(WRITTEN_BYTES);
    });
});