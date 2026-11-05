import { InternalError } from '../internal-error.model';

/**
 * A error to throw when there has been an invalid combination of decorators.
 */
export class InvalidDecoratorCombinationError extends InternalError {
    constructor(target: string, decorators: string[], options?: ErrorOptions) {
        super(`${target} was decorated with ${decorators}`, options);
        this.name = 'InvalidDecoratorCombinationError';
    }
}