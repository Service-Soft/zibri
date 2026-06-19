import { getDependencyStackTrace } from '../di/errors/get-dependency-stack-trace.function';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error to throw when a controller was encountered that does not have a base route.
 */
export class MissingBaseRouteError extends InternalError {
    constructor(controller: Function, options?: ErrorOptions) {
        super(`Could not find a base route for the controller "${controller.name}"`, options);
        this.name = 'MissingBaseRouteError';
        this.stack = getDependencyStackTrace(this.name, this.message, [controller]);
    }
}