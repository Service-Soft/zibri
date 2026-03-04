import { SkipAuthMetadata } from './skip-auth-metadata.model';
import { TwoFactorMethods } from '../2fa/two-factor-methods.model';

/**
 * Metadata for the \@Auth.require2fa decorator.
 */
export type Require2faMetadata = {
    /**
     * The allowed methods that can be used to provide an additional factor.
     */
    allowedMethods?: TwoFactorMethods
};

/**
 * Metadata for the \@Auth.require2fa.skip decorator.
 */
export type SkipRequire2faMetadata = SkipAuthMetadata;