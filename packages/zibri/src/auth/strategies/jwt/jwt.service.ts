import { type AccessTokenRevocation } from './access-token-revocation.type.ts';
import { EncodedJwt } from './encoded-jwt-access-token.model.ts';
import { JwtAsymmetricKey } from './jwt-asymmetric-key.model.ts';
import { type JwtAuthOptions } from './jwt-auth-options.model.ts';
import { JwtKey } from './jwt-key.model.ts';
import { JwtServiceInterface } from './jwt-service.interface.ts';
import { JwtSignOptions } from './jwt-sign-options.model.ts';
import { JwtVerifyOptions } from './jwt-verify-options.model.ts';
import { JwtUtilities } from './jwt.utilities.ts';
import { MissingJwtSecretError } from './missing-jwt-secret.error.ts';
import { VerifiedJwt } from './verified-jwt.model.ts';
import { Inject } from '../../../di/decorators/inject.decorator.ts';
import { Injectable } from '../../../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { GlobalRegistry } from '../../../global/global-registry.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';
import { optionalPeer } from '../../../utilities/optional-peer.function.ts';

/**
 * Default implementation of the service signing and verifying the access tokens of the application.
 */
@Injectable({ register: 'onUse' })
export class JwtService implements JwtServiceInterface {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly accessTokenExpiresInMs: number;

    // only the current key ever signs. Verifying takes the current one first and then every previous
    // one, which exist to verify tokens issued before a rotation
    private readonly signingKey: JwtKey;
    private readonly verificationKeys: JwtKey[];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS)
        options: JwtAuthOptions,
        @Inject(ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION)
        accessTokenRevocation: AccessTokenRevocation,
        @Inject(ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK)
        revalidateUsers: boolean
    ) {
        // loaded here so that a missing package stops the boot, rather than the first login
        optionalPeer('jose', 'Jwt auth');
        // revoking at once means reading on every check, which is what trusting the credential turns off
        if (accessTokenRevocation === 'immediately' && !revalidateUsers) {
            throw new InternalError([
                'ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION is immediately, and REVALIDATE_USER_ON_AUTH_CHECK is false.',
                'Revoking access tokens at once reads on every check, which the second one turns off. Change one of them.'
            ]);
        }
        const accessTokenKey: string | JwtAsymmetricKey | undefined = options.accessTokenKey;
        // an empty string is an unset environment variable rather than a secret
        if (accessTokenKey == undefined || accessTokenKey === '') {
            throw new MissingJwtSecretError('accessTokenKey');
        }
        this.signingKey = this.resolveConfiguredKeys('accessTokenKey', () => JwtUtilities.resolveSigningKey(accessTokenKey));
        this.verificationKeys = this.resolveConfiguredKeys(
            'accessTokenKey or previousAccessTokenKeys',
            () => [accessTokenKey, ...options.previousAccessTokenKeys].map(k => JwtUtilities.resolveVerificationKey(k))
        );
        this.accessTokenExpiresInMs = options.accessTokenExpiresInMs;
    }

    /**
     * Who the application says it is: its `baseUrl`, which an authorization server's issuer has to be
     * (RFC 8414). Read per call rather than in the constructor, because the service can be built before
     * the application data is registered.
     * @returns The issuer to sign with and to require.
     * @throws When the application has no `baseUrl`, since signing and verifying with an undefined
     * issuer turns the check off rather than failing.
     */
    get issuer(): string {
        const baseUrl: string | undefined = GlobalRegistry.getAppData('baseUrl');
        if (baseUrl == undefined) {
            throw new InternalError('Cannot issue or verify a jwt before the application has a baseUrl.');
        }
        // without a trailing slash, so that the same url written two ways is one issuer
        return baseUrl.replace(/\/+$/, '');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async signAccessToken(payload: Record<string, unknown>, audience: string | string[]): Promise<string> {
        return await this.sign(payload, {
            expiresInMs: this.accessTokenExpiresInMs,
            // a single audience as a string, which is the form every resource server reads
            audience: Array.isArray(audience) && audience.length === 1 ? audience[0] : audience,
            type: 'at+jwt'
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findAccessToken(token: string, audience: string | undefined): Promise<VerifiedJwt | undefined> {
        return await this.verify(token, { audience, type: 'at+jwt' });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async sign(payload: Record<string, unknown>, options: OmitStrict<JwtSignOptions, 'issuer'>): Promise<string> {
        return await JwtUtilities.sign(payload, this.signingKey, { ...options, issuer: this.issuer });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async verify(token: string, options: OmitStrict<JwtVerifyOptions, 'issuer'>): Promise<VerifiedJwt | undefined> {
        const data: EncodedJwt | undefined = await JwtUtilities.verify(token, this.verificationKeys, { ...options, issuer: this.issuer });
        if (data == undefined || typeof data.payload !== 'object' || data.payload == undefined) {
            return undefined;
        }
        const payload: Record<string, unknown> = Object.fromEntries(Object.entries(data.payload));
        const tokenAudience: unknown = payload['aud'];
        return {
            payload,
            issuedAt: typeof payload['iat'] === 'number' ? payload['iat'] : 0,
            expiresAt: typeof payload['exp'] === 'number' ? payload['exp'] : 0,
            audience: typeof tokenAudience === 'string'
                ? [tokenAudience]
                : Array.isArray(tokenAudience) ? tokenAudience.filter(a => typeof a === 'string') : []
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    getVerificationKeys(): JwtKey[] {
        return this.verificationKeys;
    }

    /**
     * Builds keys out of what was configured, naming the option when that is not possible.
     * @param option - The option the keys come from, for the message.
     * @param resolve - Builds the keys.
     * @returns What `resolve` built.
     * @throws When the configured value is not a usable key, saying which option holds it.
     */
    private resolveConfiguredKeys<T>(option: string, resolve: () => T): T {
        try {
            return resolve();
        }
        catch (error) {
            throw new InternalError(
                [
                    `The ${option} configured on ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT cannot be used.`,
                    error instanceof Error ? error.message : String(error)
                ],
                { cause: error }
            );
        }
    }
}