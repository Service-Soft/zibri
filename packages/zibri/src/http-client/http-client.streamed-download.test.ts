import { ChildProcess, fork, ForkOptions } from 'node:child_process';

import { describe, expect, it } from '@jest/globals';
import { resolveTypeScriptForkOptions } from 'zibri-testing';

import { STREAMED_DOWNLOAD_BYTES, STREAMED_DOWNLOADS } from './__testing__/streamed-download.constants';
import { FsUtilities } from '../utilities/fs.utilities';

// a restore through s3 ended the application: the response body was paused by a reader slower than
// the network when the service closed the connection, and the fetch of node's bundled undici then
// threw an assertion from the socket's end event, which nothing can catch

/**
 * How the downloading process ended.
 */
type DownloadOutcome = {
    /**
     * How many bytes each download got, when the process reported.
     */
    received: number[] | undefined,
    /**
     * The code it exited with.
     */
    exitCode: number | null,
    /**
     * What it wrote to stderr.
     */
    stderr: string
};

/**
 * Runs the downloads in a process of their own.
 * @returns How it ended.
 */
async function runDownloads(): Promise<DownloadOutcome> {
    const { execArgv, env }: Required<Pick<ForkOptions, 'execArgv' | 'env'>> = resolveTypeScriptForkOptions('The streamed download test');
    const child: ChildProcess = fork(FsUtilities.getPath(__dirname, '__testing__', 'streamed-download.entry.ts'), [], {
        cwd: process.cwd(),
        execArgv,
        env,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    let stderr: string = '';
    child.stderr?.on('data', (chunk: Buffer) => stderr += chunk.toString());
    let received: number[] | undefined;
    child.on('message', (message: { received: number[] }) => received = message.received);
    const exitCode: number | null = await new Promise(resolve => child.once('exit', resolve));
    return { received, exitCode, stderr };
}

describe('HttpClient, downloading a stream', () => {
    it('gets every byte of a body read slower than it arrives from a server that closes the connection', async () => {
        const outcome: DownloadOutcome = await runDownloads();

        // stderr as well, which says what ended the process when it did not report
        expect({ ...outcome, stderr: outcome.stderr.includes('Error') ? outcome.stderr : '' }).toEqual({
            received: Array.from({ length: STREAMED_DOWNLOADS }, () => STREAMED_DOWNLOAD_BYTES),
            exitCode: 0,
            stderr: ''
        });
    }, 120000);
});