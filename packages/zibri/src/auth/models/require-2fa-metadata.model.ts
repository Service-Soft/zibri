import { Require2faReauth } from './require-2fa-reauth.model';
import { SkipMetadata } from './skip-auth-metadata.model';
import { TwoFactorMethods } from '../2fa/two-factor-methods.model';

/**
 * Metadata for the \@Auth.require2fa decorator.
 */
export type Require2faMetadata = {
    /**
     * The allowed methods that can be used to provide an additional factor.
     * Defaults to every method the application configured.
     */
    allowedMethods?: TwoFactorMethods,
    /**
     * Whether a recent login is accepted in place of a second factor.
     * Defaults to `ZIBRI_DI_TOKENS.REQUIRE_2FA_REAUTH`, which is false by default.
     */
    reauth?: Require2faReauth
};

/**
 * Metadata for the \@Auth.require2fa.skip decorator.
 */
export type SkipRequire2faMetadata = SkipMetadata;