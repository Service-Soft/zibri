import { Property } from '../entity/decorators/property.decorator';
import { HttpMethod } from '../http/http-method.enum';
import { HttpStatus } from '../http/http-status.enum';
import { OmitStrict } from '../types/omit-strict.type';

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
     * Context information about the request that triggered the log.
     */
    @Property.object({ cls: () => LogRequestContext, required: false })
    request?: LogRequestContext;
}

/**
 * The input for creating a new log context.
 */
export type LogContextInput = OmitStrict<LogContext, 'origin'>;