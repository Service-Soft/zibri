import { ConsoleUtilities } from '../console.utilities';
import { Log } from '../log.model';
import { BaseLoggerTransportConfig, LoggerTransportSend } from './logger-transport.model';

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
        ConsoleUtilities.printLog(log);
    }
};