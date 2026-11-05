import { JwtProviderTokenVerifyOptions } from './jwt-provider-token-verify-options.model';

/**
 * What a logout token an identity provider sent is verified with.
 */
export type JwtLogoutTokenVerifyOptions = JwtProviderTokenVerifyOptions & {
    /**
     * How long ago the token may have been issued.
     */
    maxAgeInMs: number
};