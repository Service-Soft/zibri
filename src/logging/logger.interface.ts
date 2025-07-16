
/**
 * Interface for a logger.
 */
export interface LoggerInterface {
    /**
     * Logs a debug message.
     */
    debug: (...messages: (string | number)[]) => void,
    /**
     * Logs a info message.
     */
    info: (...messages: (string | number)[]) => void,
    /**
     * Logs a warning.
     */
    warn: (...messages: (string | number)[]) => void,
    /**
     * Logs a error.
     */
    error: (...messages: (string | number | Error)[]) => void,
    /**
     * Logs a critical error.
     */
    critical: (...messages: (string | number | Error)[]) => void
}