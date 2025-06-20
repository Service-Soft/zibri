export const reset: string = '\x1B[0m';
export const blue: string = '\x1B[34m';
export const green: string = '\x1B[32m';
export const red: string = '\x1B[31m';
export const yellow: string = '\x1B[33m';
export const purple: string = '\x1B[35m';
export const bold: string = '\x1B[1m';
export const bright: string = '\x1B[1m';
export const spacing: string = ' ';

export function warn(...messages: (string | number | Error)[]): void {
    // eslint-disable-next-line no-console
    console.warn(getTimestamp(), `${yellow}${bright}WARN${reset} ${spacing}`, ...messages);
}

export function getTimestamp(): string {
    const date: Date = new Date();
    const hours: string = date.getHours() < 10 ? `0${date.getHours()}` : `${date.getHours()}`;
    const minutes: string = date.getMinutes() < 10 ? `0${date.getMinutes()}` : `${date.getMinutes()}`;
    const seconds: string = date.getSeconds() < 10 ? `0${date.getSeconds()}` : `${date.getSeconds()}`;
    return `${bold}${bright}${hours}:${minutes}:${seconds}${reset}`;
}