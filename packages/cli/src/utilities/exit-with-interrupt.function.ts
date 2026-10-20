import { ChalkUtilities } from '../encapsulation/index.ts';
import { exitGracefully } from './exit-gracefully.function.ts';

/**
 * Exits the cli when an interrupt occurs.
 * @returns Never, as the program stops when this function finished running.
 */
export async function exitWithInterrupt(): Promise<never> {
    // eslint-disable-next-line no-console
    console.log(ChalkUtilities.secondary('\nProcess interrupted (Ctrl+C)'));
    return await exitGracefully(130);
}