import { execSync, ExecSyncOptions } from 'child_process';

import { ChalkUtilities } from './chalk.utilities.ts';
import { exitGracefully, exitWithInterrupt, isErrorWithSignal, isExitPromptError } from '../utilities/index.ts';

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
}