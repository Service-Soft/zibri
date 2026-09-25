import { UnauthorizedError } from '../../../../error-handling/errors/unauthorized.error';
import { $ts } from '../../../../localization/translate.function';

/**
 * Thrown when a one time password is presented a second time.
 *
 * A time based code stays the same for its whole step, so the same six digits are shown for up to
 * thirty seconds. Accepting them twice would make them not one time: anyone who saw a code once
 * could use it for the rest of that step, which is what RFC 6238 requires a verifier to refuse.
 *
 * Separate from a wrong code on purpose, though both answer 401. Two step up operations close
 * together is a normal thing to do, and telling that user their code was invalid sends them looking
 * for a mistake they did not make - the answer is to wait for the next one. It gives an attacker
 * nothing they do not already have, since replaying a code means they knew it was valid.
 */
export class OtpCodeAlreadyUsedError extends UnauthorizedError {
    constructor(options?: ErrorOptions) {
        super($ts`This two factor code has already been used. Wait for your authenticator to show the next one.`, options);
        this.name = 'OtpCodeAlreadyUsedError';
    }
}