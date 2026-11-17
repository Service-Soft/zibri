/**
 * The request a log of the server was written in.
 */
export type LogRequestContext = {
    /**
     * The id of the trace of the request.
     */
    traceId?: string | null,
    /**
     * The id of the span the log was written in.
     */
    spanId?: string | null,
    /**
     * The http method, like 'GET'.
     */
    method: string,
    /**
     * The url of the request.
     */
    url: string,
    /**
     * The address the request came from.
     */
    clientIp: string,
    /**
     * The User-Agent of the request.
     */
    userAgent: string,
    /**
     * The http status the request was answered with, once it was.
     */
    status?: number | null,
    /**
     * How long answering took, once it was answered.
     */
    durationInMs?: number | null
};