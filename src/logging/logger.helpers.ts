/* eslint-disable jsdoc/require-jsdoc */

export const reset: string = '\x1B[0m';
export const blue: string = '\x1B[34m';
export const green: string = '\x1B[32m';
export const red: string = '\x1B[31m';
export const yellow: string = '\x1B[33m';
export const purple: string = '\x1B[35m';
export const bold: string = '\x1B[1m';
export const bright: string = '\x1B[1m';
export const spacing: string = ' ';

export function warn(message: string): void {
    // eslint-disable-next-line no-console
    console.warn(getTimestamp(), `${yellow}${bright}WARN${reset} ${spacing}`, message);
}

export function getTimestamp(): string {
    const date: Date = new Date();
    const hours: string = date.getHours().toString()
        .padStart(2, '0');
    const minutes: string = date.getMinutes().toString()
        .padStart(2, '0');
    const seconds: string = date.getSeconds().toString()
        .padStart(2, '0');
    const ms: string = date.getMilliseconds().toString()
        .padStart(3, '0');
    return `${bold}${bright}${hours}:${minutes}:${seconds}.${ms}${reset}`;
}