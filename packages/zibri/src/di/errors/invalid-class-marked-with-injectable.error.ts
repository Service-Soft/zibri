import { InternalError } from '../../error-handling/internal-error.model';

// eslint-disable-next-line jsdoc/require-jsdoc
type InvalidClassReason = 'cronJob' | 'plugin' | 'twoFactorMethod' | 'authStrategy';

const messageForReason: Record<InvalidClassReason, string> = {
    cronJob: 'Cron jobs should be registered by the cron service.',
    plugin: 'Plugins interfere with the injection system, making them injectable is forbidden.',
    twoFactorMethod: 'Two factor methods should be registered by the two factor service.',
    authStrategy: 'Auth strategies should be registered by the auth service.'
};

/**
 * An error to throw when a class has been incorrectly marked with @Injectable.
 */
export class InvalidClassMarkedWithInjectableError extends InternalError {
    constructor(className: string, reason: InvalidClassReason, options?: ErrorOptions) {
        super([`Invalid class marked with @Injectable: ${className}`, messageForReason[reason]], options);
        this.name = 'InvalidClassMarkedWithInjectableError';
    }

}