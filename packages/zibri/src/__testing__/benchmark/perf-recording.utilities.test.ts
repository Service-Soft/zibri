import { ChildProcess, execFileSync, fork, ForkOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { resolveTypeScriptForkOptions } from 'zibri-testing';

import { PerfControl } from './perf-control.model';
import { PERF_CONTROL_ENV, PerfFork, PerfRecordingUtilities } from './perf-recording.utilities';
import { FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { testFileFolder } from '../constants';

/**
 * Whether perf can be started here.
 * @returns Whether it can.
 */
function isPerfInstalled(): boolean {
    try {
        execFileSync('perf', ['--version'], { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}

const perfInstalled: boolean = process.platform === 'linux' && isPerfInstalled();

describe('PerfRecordingUtilities', () => {
    const folder: string = FsUtilities.getPath(testFileFolder, `perf-recording-${UUIDUtilities.generate()}`);

    beforeAll(async () => {
        await mkdir(folder, { recursive: true });
    });

    afterAll(async () => {
        await rm(folder, { recursive: true, force: true });
    });

    it('refuses to set a recording up on a system other than Linux', () => {
        expect(() => PerfRecordingUtilities.createControl(`${folder}/darwin.perf.data`, 'darwin')).toThrow('Linux only');
    });

    // what a suite wraps around what it measures, which every run but one of scripts/profile-benchmarks.mjs runs
    it('runs the work as it is in a process nothing records', async () => {
        expect(process.env[PERF_CONTROL_ENV]).toBeUndefined();

        expect(await PerfRecordingUtilities.recordIfAsked(async () => await Promise.resolve(42))).toBe(42);
    });

    it('forks node as it is without a recording', () => {
        expect(PerfRecordingUtilities.resolveFork(undefined, ['--expose-gc'])).toEqual({ execPath: process.execPath, execArgv: ['--expose-gc'] });
    });

    // the way a measured process is started: under perf, which records only while the process says so
    (perfInstalled ? it : it.skip)('records a process started under perf while it says so, and keeps its channel to its parent', async () => {
        const control: PerfControl = PerfRecordingUtilities.createControl(`${folder}/fixture.perf.data`);
        const { execArgv, env }: Required<Pick<ForkOptions, 'execArgv' | 'env'>> = resolveTypeScriptForkOptions('The perf fixture');
        const forked: PerfFork = PerfRecordingUtilities.resolveFork(control, execArgv);
        const child: ChildProcess = fork(FsUtilities.getPath(__dirname, 'perf-recording.fixture.ts'), [], {
            ...forked,
            stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
            env: { ...env, [PERF_CONTROL_ENV]: JSON.stringify(control) }
        });
        const message: unknown = await new Promise((resolve, reject) => {
            child.once('message', resolve);
            child.once('exit', code => reject(new Error(`perf ended with ${code} before the fixture reported`)));
        });
        const code: number | null = child.exitCode ?? await new Promise(resolve => child.once('exit', resolve));

        expect(message).toEqual({ returned: 42 });
        expect(code).toBe(0);
        expect(existsSync(control.file)).toBe(true);
        expect(execFileSync('perf', ['report', '-i', control.file, '--stdio', '--sort', 'comm'], { encoding: 'utf8' })).toMatch(/\d+\.\d+%/);
        // the names of the functions V8 compiled and its log, beside the recording rather than where the process ran
        const beside: string[] = await readdir(folder);
        expect(beside.some(name => /^perf-\d+\.map$/.test(name))).toBe(true);
        expect(beside).toContain('fixture.perf.data.v8.log');
        expect((await readdir(process.cwd())).filter(name => /^isolate-.*-v8\.log$/.test(name))).toEqual([]);
    }, 60_000);
});