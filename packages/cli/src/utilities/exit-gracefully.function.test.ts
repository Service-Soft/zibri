import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

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
    // the source itself, through node's own type stripping: the file carries nothing but annotations
    const source: string = pathToFileURL(path.join(import.meta.dirname, 'exit-gracefully.function.ts')).href;
    const script: string = [
        `import { exitGracefully } from '${source}';`,
        'setInterval(() => {}, 1000);',
        `process.stdout.write('x'.repeat(${WRITTEN_BYTES}));`,
        'void exitGracefully(3);'
    ].join('\n');
    return spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 10000, maxBuffer: WRITTEN_BYTES * 2 });
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