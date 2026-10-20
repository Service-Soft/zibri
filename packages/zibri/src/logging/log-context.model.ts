import { LoggedError } from './logged-error.model.ts';
import { CacheContext } from '../context/cache/cache.context.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { HttpMethod } from '../http/http-method.enum.ts';
import { HttpStatus } from '../http/http-status.enum.ts';
import { OmitStrict } from '../types/omit-strict.type.ts';

/**
 * Any custom additional metadata for the log context.
 */
export class LogContextMetadata implements Record<string, unknown> {
    [key: string]: unknown
}

/**
 * Context information about a request that triggered a log.
 */
export class LogRequestContext {
    /**
     * The trace this request belongs to, across services and across every line it caused.
     *
     * What to search a log backend by when an incident spans more than one application: the same
     * value appears on every line every service wrote while handling one call.
     *
     * Optional because an entry written before this field existed does not carry one, and because a
     * context built outside the http middleware - a test, a websocket - has no request to read it
     * off. Every request the application serves has one.
     */
    @Property.string({ required: false })
    traceId?: string | null;
    /**
     * The span within the trace that this line was written under.
     *
     * What separates the lines one request wrote while talking to the database from the ones it
     * wrote while answering, once a tracing backend has the spans to match them against.
     */
    @Property.string({ required: false })
    spanId?: string | null;
    /**
     * The http method of the request.
     */
    @Property.string({ enum: HttpMethod })
    method!: HttpMethod;
    /**
     * The complete url that was requested.
     */
    @Property.string()
    url!: string;
    /**
     * The ip address of the client.
     */
    @Property.string()
    clientIp!: string;
    /**
     * The user agent of the client.
     */
    @Property.string()
    userAgent!: string;
    /**
     * The http status of the response, if the request already finished.
     */
    @Property.number({ format: 'integer', enum: HttpStatus, required: false })
    status?: HttpStatus | null;
    /**
     * The duration that the request took in ms, if it already finished.
     */
    @Property.number({ required: false })
    durationInMs?: number | null;
}

/**
 * What a row standing for several entries counts.
 */
export class LogCollapsedContext {
    /**
     * How many entries the row stands for, including the one whose message and context it carries.
     */
    @Property.number({ format: 'integer' })
    count!: number;
    /**
     * When the last of them was logged. The first was logged at the row's `createdAt`.
     */
    @Property.date()
    lastAt!: Date;
}

/**
 * Context for the log, like the request, the id of the user if applicable and the stack trace.
 */
export class LogContext {
    /**
     * The path of the file where the log originated from.
     */
    @Property.string()
    origin!: string;
    /**
     * Any custom additional metadata for the log context.
     */
    @Property.object({ cls: () => LogContextMetadata, required: false, allowAdditionalProperties: true })
    metadata?: LogContextMetadata | null;
    /**
     * Context information about the request that triggered the log.
     */
    @Property.object({ cls: () => LogRequestContext, required: false })
    request?: LogRequestContext | null;
    /**
     * Context information about the cache that triggered the log.
     */
    @Property.array({ items: { type: 'object', cls: () => CacheContext }, required: false })
    cache?: CacheContext[] | null;
    /**
     * An error associated to this log.
     */
    @Property.object({ cls: () => LoggedError, required: false })
    error?: LoggedError | null;
    /**
     * Set when the row stands for several entries of one kind, which the db transport writes past its
     * budget.
     */
    @Property.object({ cls: () => LogCollapsedContext, required: false })
    collapsed?: LogCollapsedContext | null;
}

/**
 * The input for creating a new log context.
 */
export type LogContextInput = OmitStrict<LogContext, 'origin' | 'request' | 'cache' | 'error' | 'collapsed'> & {
    /**
     * An error associated to this log.
     */
    error?: unknown,
    /**
     * Context about the request, for a caller that knows more about it than the logger can find out.
     *
     * Normally left unset: the logger reads the request being handled out of async local storage.
     * The access log sets it, because it is the only writer that runs when the response has already
     * closed - which is the only moment the status and the duration are both known, and after the
     * point where a request that matched no route ever had a context to read.
     */
    request?: LogRequestContext
};