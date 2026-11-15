import { CacheContext } from './cache-context.model';
import { LogCollapsedContext } from './log-collapsed-context.model';
import { LogRequestContext } from './log-request-context.model';
import { LoggedError } from './logged-error.model';

/**
 * Where a log comes from and what it is about. A log sent by a browser has only the origin, the metadata and the
 * error; the server adds the rest to its own.
 */
export type LogContext = {
    /**
     * Where it was logged: the path of the page in a browser, like '/checkout', and the path of the file on the server.
     */
    origin: string,
    /**
     * What else was logged with it, like the objects it is about.
     */
    metadata?: Record<string, unknown> | null,
    /**
     * The request it was written in, on the server.
     */
    request?: LogRequestContext | null,
    /**
     * The caches the server used while it wrote it.
     */
    cache?: CacheContext[] | null,
    /**
     * The error of an error or critical log.
     */
    error?: LoggedError | null,
    /**
     * How often it was written again within a short time.
     */
    collapsed?: LogCollapsedContext | null
};