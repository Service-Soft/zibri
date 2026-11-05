/* eslint-disable no-console */
import { LogLevel } from './log-level.enum';
import { Log } from './log.model';

/**
 * Utilities for printing to the console, in color and with the time in front.
 */
export abstract class ConsoleUtilities {
    private static readonly reset: string = '\x1B[0m';
    private static readonly blue: string = '\x1B[34m';
    private static readonly green: string = '\x1B[32m';
    private static readonly red: string = '\x1B[31m';
    private static readonly yellow: string = '\x1B[33m';
    private static readonly purple: string = '\x1B[35m';
    private static readonly bold: string = '\x1B[1m';
    private static readonly bright: string = '\x1B[1m';
    private static readonly spacing: string = ' ';

    /**
     * Prints a warning.
     * @param message - The warning to print.
     */
    static warn(message: string): void {
        console.warn(this.resolveTimestamp(), `${this.yellow}${this.bright}WARN${this.reset} ${this.spacing}`, message);
    }

    /**
     * Prints one log.
     * @param log - The log to print.
     */
    static printLog(log: Log): void {
        const timeStamp: string = this.resolveTimestamp();

        switch (log.level) {
            case LogLevel.DEBUG: {
                console.debug(timeStamp, `${this.green}${this.bright}DEBUG${this.reset}${this.spacing}${log.context.origin}`);
                console.debug(log.message);
                return;
            }
            case LogLevel.INFO: {
                console.info(timeStamp, `${this.blue}${this.bright}INFO${this.reset} ${this.spacing}`, log.message);
                return;
            }
            case LogLevel.WARN: {
                this.warn(log.message);
                return;
            }
            case LogLevel.ERROR: {
                console.error(timeStamp, `${this.red}${this.bright}ERROR${this.reset}${this.spacing}${log.context.origin}`);
                for (const p of log.context.error?.paragraphs ?? []) {
                    console.error(p);
                }
                return;
            }
            case LogLevel.CRITICAL: {
                console.error(timeStamp, `${this.purple}${this.bright}CRITICAL${this.reset}${this.spacing}${log.context.origin}`);
                for (const p of log.context.error?.paragraphs ?? []) {
                    console.error(p);
                }
                return;
            }
        }
    }

    private static resolveTimestamp(): string {
        const date: Date = new Date();
        const hours: string = date.getHours().toString()
            .padStart(2, '0');
        const minutes: string = date.getMinutes().toString()
            .padStart(2, '0');
        const seconds: string = date.getSeconds().toString()
            .padStart(2, '0');
        const ms: string = date.getMilliseconds().toString()
            .padStart(3, '0');
        return `${this.bold}${this.bright}${hours}:${minutes}:${seconds}.${ms}${this.reset}`;
    }
}