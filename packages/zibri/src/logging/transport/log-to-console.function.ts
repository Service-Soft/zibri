/* eslint-disable no-console */
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';
import { blue, bright, getTimestamp, green, purple, red, reset, spacing, warn } from '../logger.helpers';
import { BaseLoggerTransportConfig, LoggerTransportSend } from './logger-transport.model';

/**
 * Prints the given log in the console.
 * @param log - The log to print.
 */
export const logToConsole: LoggerTransportSend<BaseLoggerTransportConfig> = (log: Log) => {
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
};