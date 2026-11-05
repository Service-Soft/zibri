import { ProviderAccessFailure } from './provider-access-failure.enum';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { $ts } from '../../localization/translate.function';

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