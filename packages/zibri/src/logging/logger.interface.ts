import { AuditEvent } from './audit-event.model';
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
    debug: (message: string, context?: LogContextInput) => void,
    /**
     * Logs a info message.
     */
    info: (message: string, context?: LogContextInput) => void,
    /**
     * Logs a warning.
     */
    warn: (message: string, context?: LogContextInput) => void,
    /**
     * Logs a error.
     */
    error: (error: Error, context?: OmitStrict<LogContextInput, 'error'>) => void,
    /**
     * Logs a critical error.
     */
    critical: (error: Error, context?: OmitStrict<LogContextInput, 'error'>) => void,
    /**
     * Records a security relevant event.
     *
     * Goes through the same transports as everything else, at `info` when it succeeded and `warn`
     * when it did not, and carries the event itself under `context.metadata.audit` so that a
     * transport or a query can pick the audit trail out of the rest.
     *
     * This is the seam: an application that has to ship these somewhere specific replaces the logger
     * and routes `audit` wherever it needs to go, without touching the auth code that emits them.
     */
    audit: (event: AuditEvent) => void,
    /**
     * Waits until everything logged so far has reached the transports.
     *
     * The logging methods above queue rather than write, so they return before anything has been
     * persisted. Anything that has to see a log entry - a test asserting on it, a shutdown that must
     * not lose the reason it is shutting down - has to wait for this.
     */
    flush: () => Promise<void>
}