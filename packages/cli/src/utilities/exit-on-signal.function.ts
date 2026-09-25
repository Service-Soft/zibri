import { exitWithInterrupt } from './exit-with-interrupt.function';

/**
 * The signals a terminal sends to ask the cli to stop.
 */
const STOP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

/**
 * Makes an interrupt end the cli the way an interrupt during a prompt already does.
 *
 * Node exits on these by itself, but only while nothing is listening for them - and a prompt and a
 * child process each listen while they are running, so an interrupt was answered one way inside those
 * and another way outside them. This is what makes the message and the exit code the same wherever it
 * lands.
 * @returns A function that stops listening, for a caller that wants the default back.
 */
export function exitOnSignal(): () => void {
    const handlers: [NodeJS.Signals, () => void][] = STOP_SIGNALS.map(signal => [
        signal,
        () => {
            void exitWithInterrupt();
        }
    ]);

    for (const [signal, handler] of handlers) {
        process.on(signal, handler);
    }

    return () => {
        for (const [signal, handler] of handlers) {
            process.removeListener(signal, handler);
        }
    };
}