/* eslint-disable cspell/spellchecker */
import { ChildProcessByStdio, spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import { InternalError } from '../../../error-handling/internal-error.model';

/**
 * How much of what a client tool wrote to its error output an error about it carries, from the end,
 * which is where the tool names what stopped it.
 */
const STDERR_TAIL_BYTES: number = 4096;

/**
 * Running the postgres client tools a backup is made and restored with.
 */
export abstract class PostgresClientToolUtilities {

    /**
     * Finds the major version of a postgres client tool, which also tells whether it starts at all.
     * @param command - The command to look for.
     * @param env - The environment the client tools run with, whose `PATH` the command is looked for on.
     * @returns The major version, or undefined when the command could not be started.
     */
    static async findMajorVersion(command: string, env: NodeJS.ProcessEnv): Promise<number | undefined> {
        return await new Promise<number | undefined>(resolve => {
            const child: ChildProcessByStdio<null, Readable, null> = spawn(
                command,
                ['--version'],
                { stdio: ['ignore', 'pipe', 'ignore'], env }
            );
            let output: string = '';
            child.stdout.on('data', (chunk: Buffer) => {
                output += chunk.toString();
            });
            child.on('error', () => resolve(undefined));
            child.on('close', code => {
                // eg. "pg_dump (PostgreSQL) 17.6", or "psql (PostgreSQL) 16.4 (Debian 16.4-1.pgdg120+1)"
                const major: string | undefined = /\(PostgreSQL\) (\d+)/.exec(output)?.[1];
                resolve(code === 0 && major != undefined ? Number(major) : undefined);
            });
        });
    }

    /**
     * Settles once a child process has exited.
     * @param child - The child process, whose error output is piped.
     * @param command - The command it runs, for the error.
     * @returns A promise that resolves on an exit code of 0 and fails on anything else.
     */
    static async waitForExit(child: ChildProcessByStdio<Writable | null, Readable | null, Readable>, command: string): Promise<void> {
        const stderr: () => string = this.keepStderrTail(child.stderr);
        await new Promise<void>((resolve, reject) => {
            child.on('error', reject);
            child.on('close', code => code === 0 ? resolve() : reject(this.resolveExitError(command, code, stderr())));
        });
    }

    /**
     * Keeps the end of what a child process writes to its error output, for the error about its exit.
     * @param stderr - The error output of the child.
     * @returns What it wrote so far, as text.
     */
    static keepStderrTail(stderr: Readable): () => string {
        let tail: string = '';
        stderr.on('data', (chunk: Buffer) => {
            tail = (tail + chunk.toString()).slice(-STDERR_TAIL_BYTES);
        });
        return () => tail.trim();
    }

    /**
     * Resolves the error about a client tool that stopped, carrying what it wrote to its error output.
     * @param command - The command it runs.
     * @param code - Its exit code.
     * @param stderr - What it wrote to its error output.
     * @returns The error.
     */
    static resolveExitError(command: string, code: number | null, stderr: string): InternalError {
        return new InternalError([`${command} exited with code ${code}.`, ...stderr ? [stderr] : []]);
    }
}