/* eslint-disable no-console */
import { LogLevel } from '../log-level.enum.ts';
import { Log } from '../log.model.ts';
import { blue, bright, getTimestamp, green, purple, red, reset, spacing, warn } from '../logger.helpers.ts';
import { BaseLoggerTransportConfig, LoggerTransportSend } from './logger-transport.model.ts';

/**
 * Prints the given logs in the console.
 *
 * A loop, and it is the honest shape for this one: a terminal is a line at a time whatever the
 * caller had in hand, so nothing is gained by knowing the batch. The transports where it matters -
 * one INSERT per line, one mail per line - are the reason the batch reaches here at all.
 * @param logs - The logs to print, oldest first.
 */
export const logToConsole: LoggerTransportSend<BaseLoggerTransportConfig> = (logs: Log[]) => {
    for (const log of logs) {
        printLog(log);
    }
};

/**
 * Prints one log in the console.
 * @param log - The log to print.
 */
function printLog(log: Log): void {
    const timeStamp: string = getTimestamp();

    switch (log.level) {
        case LogLevel.DEBUG: {
            console.debug(timeStamp, `${green}${bright}DEBUG${reset}${spacing}${log.context.origin}`);
            console.debug(log.message);
            return;
        }
        case LogLevel.INFO: {
            console.info(timeStamp, `${blue}${bright}INFO${reset} ${spacing}`, log.message);
            return;
        }
        case LogLevel.WARN: {
            warn(log.message);
            return;
        }
        case LogLevel.ERROR: {
            console.error(timeStamp, `${red}${bright}ERROR${reset}${spacing}${log.context.origin}`);
            for (const p of log.context.error?.paragraphs ?? []) {
                console.error(p);
            }
            return;
        }
        case LogLevel.CRITICAL: {
            console.error(timeStamp, `${purple}${bright}CRITICAL${reset}${spacing}${log.context.origin}`);
            for (const p of log.context.error?.paragraphs ?? []) {
                console.error(p);
            }
            return;
        }
    }
}