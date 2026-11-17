import { ValidationProblem } from './validation-problem.model';

/**
 * What a refused or failed request is answered with.
 */
export type ErrorResponseBody = {
    /**
     * The http status of the response.
     */
    status: number,
    /**
     * The name of the error, like 'NotFoundError'.
     */
    name: string,
    /**
     * The whole message, as one string, in the language of the request.
     */
    message: string,
    /**
     * The message, split into the paragraphs it was written as.
     */
    paragraphs: string[],
    /**
     * What is wrong with the request, one entry per value, when it failed validation.
     */
    problems?: ValidationProblem[],
    /**
     * The id of the trace of the request, which finds it in the logs of the server.
     */
    traceId?: string
};