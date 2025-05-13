/* eslint-disable no-console */
import { ZIBRI_DI_TOKENS, inject } from '../di';
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

const reset: string = '\x1B[0m';
const blue: string = '\x1B[34m';
const green: string = '\x1B[32m';
const red: string = '\x1B[31m';
const yellow: string = '\x1B[33m';
const purple: string = '\x1B[35m';
const bold: string = '\x1B[1m';
const bright: string = '\x1B[1m';
const spacing: string = ' ';

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
        const timeStamp: string = this.getTimestamp();

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
                console.warn(timeStamp, `${yellow}${bright}WARN${reset} ${spacing}`, ...messages);
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

    private getTimestamp(): string {
        const date: Date = new Date();
        const hours: string = date.getHours() < 10 ? `0${date.getHours()}` : `${date.getHours()}`;
        const minutes: string = date.getMinutes() < 10 ? `0${date.getMinutes()}` : `${date.getMinutes()}`;
        const seconds: string = date.getSeconds() < 10 ? `0${date.getSeconds()}` : `${date.getSeconds()}`;
        return `${bold}${bright}${hours}:${minutes}:${seconds}${reset}`;
    }
}