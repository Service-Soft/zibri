import { execSync, ExecSyncOptions, spawnSync, SpawnSyncReturns } from 'child_process';

import { ChalkUtilities } from './chalk.utilities';
import { exitGracefully, exitWithInterrupt, isErrorWithSignal, isExitPromptError } from '../utilities';

/**
 * How a program ended.
 */
export type ProcessResult = {
    /**
     * Its exit code, or undefined when it could not be started or was stopped by a signal.
     */
    status: number | undefined,
    /**
     * What it wrote to stdout, byte for byte.
     */
    stdout: Buffer
};

/**
 * Encapsulates functionality of the child_process package.
 */
export abstract class CPUtilities {

    /**
     * Used only for testing/mocking.
     */
    // eslint-disable-next-line typescript/prefer-readonly
    private static cwd?: string;

    /**
     * Executes a command and waits for its execution.
     * @param command - The command to run.
     * @param output - Whether or not the output of the command should be passed to the console.
     * @throws When there was an error during execution.
     */
    static async exec(command: string, output: boolean = true): Promise<void> {
        const options: ExecSyncOptions = {
            stdio: output ? 'inherit' : undefined,
            killSignal: 'SIGINT',
            cwd: this.cwd
        };
        try {
            execSync(command, options);
        }
        catch (error) {
            if (isExitPromptError(error) || (isErrorWithSignal(error) && error.signal === 'SIGINT')) {
                await exitWithInterrupt();
            }
            // eslint-disable-next-line no-console
            console.error(ChalkUtilities.error(`Command failed: ${command}`));
            await exitGracefully(1);
        }
    }

    /**
     * Executes a command and reads what it wrote to stdout.
     * A command that fails is an answer here rather than a reason to stop, which is the difference
     * to exec: this reads configuration a machine is allowed not to have.
     * @param command - The command to run.
     * @returns The output with surrounding whitespace removed, or undefined when it wrote none.
     */
    static output(command: string): string | undefined {
        try {
            const stdout: string = execSync(command, {
                // stderr is dropped rather than inherited: a command that is expected to fail should
                // not print anything to a user who never asked for it.
                stdio: ['ignore', 'pipe', 'ignore'],
                cwd: this.cwd
            }).toString()
                .trim();
            return stdout === '' ? undefined : stdout;
        }
        catch {
            return undefined;
        }
    }

    /**
     * Runs a program without a shell, and hands back how it ended.
     * An exit code other than 0 is an answer here rather than a failure, which is the difference to
     * output: some programs say what they found that way.
     * @param file - The program.
     * @param args - Its arguments, passed as they are.
     * @param cwd - Where it runs.
     * @returns Its exit code and what it wrote to stdout.
     */
    static resolveResult(file: string, args: string[], cwd: string): ProcessResult {
        const result: SpawnSyncReturns<Buffer> = spawnSync(file, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
        return result.error != undefined
            ? { status: undefined, stdout: Buffer.alloc(0) }
            : { status: result.status ?? undefined, stdout: result.stdout };
    }
}