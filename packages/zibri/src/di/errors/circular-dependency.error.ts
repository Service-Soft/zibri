import { InternalError } from '../../error-handling/internal-error.model';

/**
 * An error to throw when a value cannot be constructed because it is already being constructed.
 *
 * The container caches an instance only once its provider has returned, so a token that is asked for
 * again while it is still being built cannot be answered from the cache and cannot be built either.
 * Left undetected that is not an error at all but a `RangeError: Maximum call stack size exceeded`,
 * whose trace is made entirely of the container's own frames and names neither participant.
 */
export class CircularDependencyError extends InternalError {
    constructor(cycle: string[], options?: ErrorOptions) {
        super(
            [
                `Circular dependency: ${cycle.join(' -> ')}.`,
                'Each of these is being constructed while the next one is asked for, so none of them can finish.',
                'Break the cycle by injecting one of them where it is used rather than where it is built -',
                'a method that calls inject() runs after construction, when the instance it needs exists.'
            ].join('\n'),
            options
        );
        this.name = 'CircularDependencyError';
    }
}