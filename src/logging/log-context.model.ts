import { LoggedError } from './logged-error.model';
import { CacheContext } from '../context/cache/cache.context';
import { Property } from '../entity/decorators/property.decorator';
import { HttpMethod } from '../http/http-method.enum';
import { HttpStatus } from '../http/http-status.enum';
import { OmitStrict } from '../types/omit-strict.type';

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
    @Property.number({ enum: HttpStatus, required: false })
    status?: HttpStatus;
    /**
     * The duration that the request took in ms, if it already finished.
     */
    @Property.number({ required: false })
    durationInMs?: number;
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
    metadata?: LogContextMetadata;
    /**
     * Context information about the request that triggered the log.
     */
    @Property.object({ cls: () => LogRequestContext, required: false })
    request?: LogRequestContext;
    /**
     * Context information about the cache that triggered the log.
     */
    @Property.array({ items: { type: 'object', cls: () => CacheContext }, required: false })
    cache?: CacheContext[];
    /**
     * An error associated to this log.
     */
    @Property.object({ cls: () => LoggedError, required: false })
    error?: LoggedError;
}

/**
 * The input for creating a new log context.
 */
export type LogContextInput = OmitStrict<LogContext, 'origin' | 'request' | 'cache' | 'error'> & {
    /**
     * An error associated to this log.
     */
    error?: unknown
};