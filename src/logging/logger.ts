/* eslint-disable no-console */
import { ZIBRI_DI_TOKENS, inject } from '../di';
import { blue, bright, getTimestamp, green, purple, red, reset, spacing, warn } from './logger.helpers';
import { LoggerInterface } from './logger.interface';

// eslint-disable-next-line typescript/typedef
const LOG_LEVEL_VALUES = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    critical: 4
} as const;

export type LogLevels = typeof LOG_LEVEL_VALUES;

export type LogLevel = keyof LogLevels;

export class Logger implements LoggerInterface {

    debug(...messages: (string | number)[]): void {
        this.log('debug', ...messages);
    }

    info(...messages: (string | number)[]): void {
        this.log('info', ...messages);
    }

    warn(...messages: (string | number)[]): void {
        this.log('warn', ...messages);
    }

    error(...messages: (string | number | Error)[]): void {
        this.log('error', ...messages);
    }

    critical(...messages: (string | number | Error)[]): void {
        this.log('critical', ...messages);
    }

    private log(level: LogLevel, ...messages: (string | number | Error)[]): void {
        const logLevel: LogLevel = inject(ZIBRI_DI_TOKENS.LOG_LEVEL);
        if (LOG_LEVEL_VALUES[logLevel] > LOG_LEVEL_VALUES[level]) {
            return;
        }
        const timeStamp: string = getTimestamp();

        switch (level) {
            case 'debug': {
                console.debug(timeStamp, `${green}${bright}DEBUG${reset}${spacing}`, ...messages);
                return;
            }
            case 'info': {
                console.info(timeStamp, `${blue}${bright}INFO${reset} ${spacing}`, ...messages);
                return;
            }
            case 'warn': {
                warn(...messages);
                return;
            }
            case 'error': {
                console.error(timeStamp, `${red}${bright}ERROR${reset}${spacing}`, ...messages);
                return;
            }
            case 'critical': {
                console.error(timeStamp, `${purple}${bright}FATAL${reset}${spacing}`, ...messages);
            }
        }
    }
}