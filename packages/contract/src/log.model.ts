import { LogContext } from './log-context.model';
import { LogLevel } from './log-level.enum';

/**
 * A log, as the server stores and sends it.
 */
export type Log = {
    /**
     * The id of the log.
     */
    id: string,
    /**
     * The tenant the log was written in, if any.
     */
    tenantId?: string | null,
    /**
     * The application that logged it, like 'Website': the name of the application options of the server for its own
     * logs. Null for one the server logged while no application ran.
     */
    application?: string | null,
    /**
     * How important the log is.
     */
    level: LogLevel,
    /**
     * What was logged, or the message of the error of an error or critical log.
     */
    message: string,
    /**
     * Where the log comes from, and what it is about.
     */
    context: LogContext,
    /**
     * When the log was written, as an ISO string.
     */
    createdAt: string,
    /**
     * When the server deletes the log, as an ISO string.
     */
    cleanupAt: string
};