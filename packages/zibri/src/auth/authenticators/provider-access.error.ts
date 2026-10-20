import { ProviderAccessFailure } from './provider-access-failure.enum.ts';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * Thrown when there is no access token for calling a provider's apis for a user.
 *
 * Carries why. Each failure is answered by connecting the provider again, with the scopes needed.
 */
export class ProviderAccessError extends ForbiddenError {
    constructor(
        /**
         * Why there is no access token.
         */
        readonly failure: ProviderAccessFailure,
        options?: ErrorOptions
    ) {
        super($ts`The provider cannot be accessed for this user.`, options);
        this.name = 'ProviderAccessError';
    }
}