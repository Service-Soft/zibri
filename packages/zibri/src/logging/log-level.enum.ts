/**
 * The different possible log levels.
 */
export enum LogLevel {
    /**
     * Used only for debugging, is only active after manually enabling it.
     * Data is deleted as soon as debug is turned off again.
     */
    DEBUG = 0,
    /**
     * A simple information of what is happening.
     */
    INFO = 1,
    /**
     * A warning, that the application has reached a state that might lead to errors.
     */
    WARN = 2,
    /**
     * Something is not working as intended.
     */
    ERROR = 3,
    /**
     * Immediate action is required.
     */
    CRITICAL = 4
}