import { ForbiddenError } from './forbidden.error';
import { $ts } from '../../localization/translate.function';

/**
 * An error to throw when what was asked for needs a verified email address, and the user's is not.
 */
export class EmailNotVerifiedError extends ForbiddenError {
    constructor(options?: ErrorOptions) {
        super($ts`Verify your email address first. A link to verify it is in your inbox.`, options);
        this.name = 'EmailNotVerifiedError';
    }
}