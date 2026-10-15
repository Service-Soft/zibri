import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error for a route handler that returned a kind of value none of its responses declare - a
 * `FileResponse` from a route declaring json, say.
 */
export class UndeclaredResultError extends InternalError {
    /**
     * Creates the error.
     * @param route - The route: eg. `UserController.download`, or `GET /downloads/:id` for one that is
     * not declared on a controller.
     * @param problem - What the handler returned against what the route declares.
     * @param options - The cause, when there is one.
     */
    constructor(route: string, problem: string, options?: ErrorOptions) {
        super(`The route ${route} ${problem}.`, options);
        this.name = 'UndeclaredResultError';
    }
}