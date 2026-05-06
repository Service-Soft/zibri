import { LogContextInput } from './log-context.model';
import { OmitStrict } from '../types/omit-strict.type';
import { BaseLoggerTransportConfig, LoggerTransport } from './transport/logger-transport.model';

/**
 * Interface for a logger.
 */
export interface LoggerInterface {
    /**
     * The transports to be used by the logger.
     */
    transports: LoggerTransport<BaseLoggerTransportConfig>[],
    /**
     * Logs a debug message.
     */
    debug: (message: string, context?: LogContextInput) => void | Promise<void>,
    /**
     * Logs a info message.
     */
    info: (message: string, context?: LogContextInput) => void | Promise<void>,
    /**
     * Logs a warning.
     */
    warn: (message: string, context?: LogContextInput) => void | Promise<void>,
    /**
     * Logs a error.
     */
    error: (error: Error, context?: OmitStrict<LogContextInput, 'error'>) => void | Promise<void>,
    /**
     * Logs a critical error.
     */
    critical: (error: Error, context?: OmitStrict<LogContextInput, 'error'>) => void | Promise<void>
}