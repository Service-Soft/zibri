import { Command } from './commands/command.enum.ts';
import { ChalkUtilities } from './encapsulation/index.ts';

/**
 * The base command of the cli.
 */
export const CLI_BASE_COMMAND: string = 'zi';

/**
 * The message to notify the user of the help command.
 */
export const MORE_INFORMATION_MESSAGE: string = `run ${ChalkUtilities.secondary(
    `${CLI_BASE_COMMAND} ${Command.HELP}`
)} for more information.`;