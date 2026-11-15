/**
 * How important a log is, from debug to critical. A higher one is more important.
 */
export enum LogLevel {
    /**
     * Details that only help while looking for a bug. Only written while debugging is turned on.
     */
    DEBUG = 0,
    /**
     * What the application is doing.
     */
    INFO = 1,
    /**
     * A state that might lead to errors.
     */
    WARN = 2,
    /**
     * Something doesn't work as intended.
     */
    ERROR = 3,
    /**
     * Something needs to be fixed right away.
     */
    CRITICAL = 4
}