import { type AccessTokenRevocation } from './access-token-revocation.type';
import { EncodedJwt } from './encoded-jwt.model';
import { isJwtAccessTokenPayload, JwtAccessTokenPayload } from './jwt-access-token-payload.model';
import { JwtAuthData } from './jwt-auth-data.model';
import { type JwtAuthOptions } from './jwt-auth-options.model';
import { JwtKey } from './jwt-key.model';
import { JwtRefreshLoginData, JwtRefreshLoginDto } from './jwt-refresh-login-data.model';
import { isJwtRefreshTokenPayload, JwtRefreshTokenPayload } from './jwt-refresh-token-payload.model';
import { JwtRefreshToken, JwtRefreshTokenCreateDto } from './jwt-refresh-token.model';
import { type JwtServiceInterface } from './jwt-service.interface';
import { JwtUtilities } from './jwt.utilities';
import { MissingJwtSecretError } from './missing-jwt-secret.error';
import { VerifiedJwt } from './verified-jwt.model';
import { ZibriApplication } from '../../../application/application';
import { HttpRequestContext } from '../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { Repository } from '../../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { CredentialReusedError } from '../../../error-handling/errors/credential-reused.error';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { $ts } from '../../../localization/translate.function';
import { OpenApiSecuritySchemeObject } from '../../../open-api/open-api.model';
import { BaseMembership } from '../../../tenancy/membership/base-membership.model';
import { type MembershipServiceInterface } from '../../../tenancy/membership/membership-service.interface';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { Ms } from '../../../utilities/ms';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { FederatedSessionColumns } from '../../authenticators/federated/federated-session-columns.model';
import { FederatedSessionMatch } from '../../authenticators/federated/federated-session-match.model';
import { FederatedSessionUtilities } from '../../authenticators/federated/federated-session.utilities';
import { IntrospectionResponse } from '../../authorization-server/introspection-response.model';
import { OAuth2ErrorCode } from '../../authorization-server/oauth2-error-code.enum';
import { OAuth2Error } from '../../authorization-server/oauth2.error';
import { type DpopServiceInterface } from '../../dpop/dpop-service.interface';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';
import { Authentication } from '../../models/authentication.model';
import { BaseUser } from '../../models/base-user.model';
import { ClaimedUser } from '../../models/claimed-user.model';
import { EndedLogin } from '../../models/ended-login.model';
import { ListedLogin } from '../../models/listed-login.model';
import { ProviderAuthentication } from '../../models/provider-authentication.model';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { AuthControllerStrategyInterface } from '../auth-controller-strategy.interface';
import { AuthorizationHeaderUtilities } from '../authorization-header.utilities';
import { AuthorizationToken } from '../authorization-token.model';
import { CredentialEntity } from '../credential-entity.model';
import { LoginListingAuthStrategyInterface } from '../login-listing-auth-strategy.interface';
import { resolveLoginDevice } from '../resolve-login-device.function';
import { TokenIntrospectingAuthStrategyInterface } from '../token-introspecting-auth-strategy.interface';

/**
 * What a verified access token of a login says.
 */
type LoginAccessToken<Role extends string> = {
    /**
     * The verified token.
     */
    verified: VerifiedJwt,
    /**
     * Its payload, read as that of a login's token.
     */
    payload: JwtAccessTokenPayload<Role, BaseUser<Role>>
};

/**
 * The refresh token one rotation minted.
 */
type RotatedRefreshToken<UserType> = {
    /**
     * The stored row, which holds the token hashed.
     */
    refreshToken: JwtRefreshToken,
    /**
     * The token itself, which is what the caller is handed.
     */
    value: string,
    /**
     * The `auth_time` of the login the rotation continues.
     */
    authTime: number,
    /**
     * The user the rotation continues the login of, as the authenticators answered them.
     */
    user: UserType
};

/**
 * Jwt auth strategy implementation of Zibri.
 */
export class JwtAuthStrategy<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
>
implements AuthControllerStrategyInterface<
    RoleType,
    UserType,
    JwtAuthData<RoleType>,
    JwtRefreshLoginData,
    OmitStrict<JwtRefreshLoginData, 'transaction'>
>, TokenIntrospectingAuthStrategyInterface<RoleType, UserType>, LoginListingAuthStrategyInterface<
    RoleType,
    UserType,
    JwtAuthData<RoleType>,
    JwtRefreshLoginData,
    OmitStrict<JwtRefreshLoginData, 'transaction'>
> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'jwt';

    // the family an access token belongs to, which it is checked against unless it works until it
    // expires
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly credentialEntities: CredentialEntity[] = [{ entityClass: JwtRefreshToken, endedBy: 'remove' }];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly authDataModel: Newable<JwtAuthData<RoleType>> = JwtAuthData;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly refreshLoginModel: Newable<JwtRefreshLoginDto> = JwtRefreshLoginDto;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly logoutModel: Newable<JwtRefreshLoginDto> = JwtRefreshLoginDto;

    // the tokens are the body of the response, which a redirect has none of
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly logsInWithResponse: boolean = false;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly securityScheme: OpenApiSecuritySchemeObject = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token in the format `Bearer <token>`'
    };

    // only the current secret ever signs. Verifying takes the current one first and then every
    // previous one, which exist to verify tokens issued before a rotation. Access tokens are signed
    // by the jwt service, which every strategy issuing them shares
    private readonly refreshTokenSigningKey: JwtKey;
    private readonly refreshTokenVerificationKeys: JwtKey[];
    private readonly refreshTokenExpiresInMs: number;
    private readonly refreshTokenReuseGraceInMs: number;
    private readonly requireDpop: boolean;

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by init, instead of failing on a repository token while this is built
    private get refreshTokenRepository(): Repository<JwtRefreshToken> {
        return inject(repositoryTokenFor(JwtRefreshToken));
    }

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS)
        options: JwtAuthOptions,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.JWT_SERVICE)
        private readonly jwtService: JwtServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.DPOP_SERVICE)
        private readonly dpopService: DpopServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION)
        private readonly accessTokenRevocation: AccessTokenRevocation
    ) {
        const refreshTokenSecret: string | undefined = options.refreshTokenSecret;
        // an empty string is an unset environment variable rather than a secret
        if (!refreshTokenSecret) {
            throw new MissingJwtSecretError('refreshTokenSecret');
        }
        this.requireDpop = options.requireDpop;
        const refreshTokenVerificationKeys: JwtKey[] = [refreshTokenSecret, ...options.previousRefreshTokenSecrets]
            .map(s => JwtUtilities.resolveVerificationKey(s));
        this.validateDistinctSecrets(jwtService.getVerificationKeys(), refreshTokenVerificationKeys);

        this.refreshTokenSigningKey = JwtUtilities.resolveSigningKey(refreshTokenSecret);
        this.refreshTokenVerificationKeys = refreshTokenVerificationKeys;
        this.refreshTokenExpiresInMs = options.refreshTokenExpiresInMs;
        this.refreshTokenReuseGraceInMs = options.refreshTokenReuseGraceInMs;
    }

    /**
     * Refuses a configuration in which one key can verify a token it did not sign.
     *
     * Which key verifies a token is the only thing that keeps the two kinds apart, so an access
     * secret shared with a refresh secret turns a 30 day credential meant to be exchanged once into
     * a bearer credential for as long as it lives. A previous key repeated as the current one is
     * refused for the same reason it is pointless: it means a rotation that did not rotate, and
     * dropping it later would then invalidate live tokens rather than expired ones.
     * @param accessTokenKeys - Every key an access token may verify against.
     * @param refreshTokenKeys - Every key a refresh token may verify against.
     * @throws When any key appears more than once across the two lists.
     */
    private validateDistinctSecrets(accessTokenKeys: JwtKey[], refreshTokenKeys: JwtKey[]): void {
        // a key pair is told apart by its thumbprint, which is the same whether it was configured as
        // the private or the public half. Prefixed, so a secret that happens to read like a
        // thumbprint is still a different key
        const all: string[] = [...accessTokenKeys, ...refreshTokenKeys]
            .map(k => k.algorithm === 'HS256' ? `secret:${k.secret}` : `key:${k.kid}`);
        if (new Set(all).size === all.length) {
            return;
        }
        throw new InternalError([
            'The configured jwt keys are not all distinct.',
            'Each kind of token is only distinguishable by the key it verifies against, so',
            'sharing one lets a refresh token be presented as an access token.',
            'Every entry across accessTokenKey, previousAccessTokenKeys, refreshTokenSecret',
            'and previousRefreshTokenSecrets has to be a different value.'
        ]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUserRows(userIds: string[], transaction: RepositoryTransaction): Promise<void> {
        await this.refreshTokenRepository.deleteAll({ userId: { oneOf: userIds } }, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(app: ZibriApplication): void {
        validateEntitiesRegistered(JwtAuthStrategy.name, app, JwtRefreshToken);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startLogin(authentication: Authentication<UserType>, transaction: RepositoryTransaction | undefined): Promise<JwtAuthData<RoleType>> {
        const { user, authenticatedAt, federatedSession, providerAuthentication } = authentication;
        // every token of this login carries the time from here on, refreshes included, and so does
        // the family its refresh tokens share, which the access tokens name as the login
        const authTime: number = Math.floor(authenticatedAt.getTime() / Ms.SECOND);
        const familyId: string = UUIDUtilities.generate();
        // the key the request proves it holds, which every token of the login is bound to from here on
        const dpopKeyThumbprint: string | undefined = await this.resolveRequestKeyThumbprint();
        if (dpopKeyThumbprint == undefined && this.requireDpop) {
            throw new OAuth2Error(
                OAuth2ErrorCode.INVALID_DPOP_PROOF,
                $ts`A login is bound to a DPoP key, which the request carries no proof of.`
            );
        }
        const accessTokenValue: string = await this.generateAccessToken(
            user,
            authTime,
            familyId,
            dpopKeyThumbprint,
            providerAuthentication
        );
        const refreshTokenValue: string = await this.generateRefreshToken(user, authTime);
        await this.createRefreshToken(
            user,
            refreshTokenValue,
            familyId,
            authTime,
            FederatedSessionUtilities.toColumns(federatedSession),
            dpopKeyThumbprint,
            providerAuthentication,
            transaction
        );

        return {
            accessToken: {
                value: accessTokenValue,
                expirationDate: new Date(Date.now() + this.jwtService.accessTokenExpiresInMs)
            },
            refreshToken: {
                value: refreshTokenValue,
                expirationDate: new Date(Date.now() + this.refreshTokenExpiresInMs)
            },
            userId: user.id,
            roles: user.roles
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endLogins(userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        // the refresh tokens only: an access token is signed rather than stored, so it stays valid
        // until it expires - unless access tokens are revoked at once, which finds their family gone
        await this.refreshTokenRepository.deleteAll({ userId }, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endFederatedLogins(session: FederatedSessionMatch, transaction: RepositoryTransaction | undefined): Promise<void> {
        // every token of a family carries the session, so this ends whole families. The access tokens
        // stay valid as with endLogins
        await this.refreshTokenRepository.deleteAll(FederatedSessionUtilities.toWhere(session), { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async logout(data: OmitStrict<JwtRefreshLoginData, 'transaction'>): Promise<EndedLogin | undefined> {
        // hashed to be searched for, because that is how it is stored. Has to name the same
        // strategy the property does, or the column is written one way and read another.
        const refreshToken: JwtRefreshToken | undefined = await this.refreshTokenRepository.findOne(
            { where: { value: await this.hashService.hash(data.refreshToken, { strategy: Sha256HashStrategy }) }, required: false }
        );
        if (!refreshToken) {
            return undefined;
        }
        // not caught: a store that fails here leaves the login live, which is for the caller to
        // record rather than for this to hide behind the answer of a login that was ended
        await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId });
        return { userId: refreshToken.userId, federatedSession: FederatedSessionUtilities.fromColumns(refreshToken) };
    }

    private async createRefreshToken(
        foundUser: UserType,
        refreshTokenValue: string,
        familyId: string,
        authTime: number,
        federatedSession: FederatedSessionColumns,
        dpopKeyThumbprint: string | undefined,
        providerAuthentication: ProviderAuthentication | undefined,
        transaction: RepositoryTransaction | undefined
    ): Promise<JwtRefreshToken> {
        const data: JwtRefreshTokenCreateDto = {
            userId: foundUser.id,
            value: refreshTokenValue,
            familyId,
            blacklisted: false,
            expirationDate: new Date(Date.now() + this.refreshTokenExpiresInMs),
            authenticatedAt: new Date(authTime * Ms.SECOND),
            issuedAt: new Date(),
            // the client of each refresh rather than of the login's start, so a login lists where it
            // was last used from
            ...resolveLoginDevice(),
            dpopKeyThumbprint,
            providerAuthentication,
            ...federatedSession
        };
        return await this.refreshTokenRepository.create(data, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findLogins(userId: string, transaction: RepositoryTransaction | undefined): Promise<ListedLogin[]> {
        const live: JwtRefreshToken[] = await this.refreshTokenRepository.findAll({
            where: { userId, blacklisted: false, expirationDate: { after: new Date() } },
            limit: 'all',
            transaction
        });
        // one token of a login is live, except for a moment after two tabs refreshed with the same one
        // within the grace, each into a token of its own: the newer stands for the login
        const byLogin: Map<string, JwtRefreshToken> = new Map();
        for (const token of live) {
            const kept: JwtRefreshToken | undefined = byLogin.get(token.familyId);
            if (kept == undefined || new Date(token.issuedAt ?? 0).getTime() > new Date(kept.issuedAt ?? 0).getTime()) {
                byLogin.set(token.familyId, token);
            }
        }
        return [...byLogin.values()].map(token => ({
            id: token.familyId,
            authenticatedAt: token.authenticatedAt ?? undefined,
            lastUsedAt: token.issuedAt ?? undefined,
            expiresAt: token.expirationDate,
            userAgent: token.userAgent ?? undefined,
            ipAddress: token.ipAddress ?? undefined
        }));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async endLogin(userId: string, loginId: string, transaction: RepositoryTransaction | undefined): Promise<boolean> {
        // the refresh tokens only, as with endLogins. By the user as well, so a login of somebody else is
        // none of theirs
        return await this.refreshTokenRepository.deleteAll({ userId, familyId: loginId }, { transaction }) > 0;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveLoginId(context: HttpRequestContext | WebsocketRequestContext): Promise<string | undefined> {
        // the family its refresh tokens share, which the access token names as the login
        return (await this.findRequestLoginToken(context))?.payload.sid;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async refreshLogin(data: JwtRefreshLoginData): Promise<JwtAuthData<RoleType>> {
        const rotated: RotatedRefreshToken<UserType> = await this.verifyAndResolveRefreshToken(data.refreshToken, data.transaction);
        const user: UserType = rotated.user;
        // the login's time, not now: a refresh is not a login, and minting it fresh here would let
        // any client holding a refresh token present itself as having just logged in
        const accessTokenValue: string = await this.generateAccessToken(
            user,
            rotated.authTime,
            rotated.refreshToken.familyId,
            rotated.refreshToken.dpopKeyThumbprint ?? undefined,
            rotated.refreshToken.providerAuthentication ?? undefined
        );

        return {
            userId: user.id,
            roles: user.roles,
            refreshToken: {
                // the token rather than the row's value, which is its hash. Answering with that
                // handed the client something no later refresh could ever match
                value: rotated.value,
                expirationDate: rotated.refreshToken.expirationDate
            },
            accessToken: {
                value: accessTokenValue,
                expirationDate: new Date(Date.now() + this.jwtService.accessTokenExpiresInMs)
            }
        };
    }

    private async verifyAndResolveRefreshToken(tokenValue: string, transaction: RepositoryTransaction): Promise<RotatedRefreshToken<UserType>> {
        const encoded: EncodedJwt | undefined = await this.verifyRefreshToken(tokenValue);
        // the payload was read as an access token's here, which is the shape it never has. Nothing
        // happened to look at it, so the mistake was invisible - checking it is what keeps a token
        // signed for one purpose from being spent on the other.
        // one message for every way a refresh can be refused, here and below. Which state a token is
        // in - never valid, aged out, or already spent by somebody - is three answers that only
        // matter to a holder who did not issue it, and the last of them says the theft worked. What
        // the framework does about each still differs, and that difference is carried by the class
        // and by the audit trail, which is where it is worth having
        if (!encoded || !isJwtRefreshTokenPayload(encoded.payload)) {
            throw new UnauthorizedError($ts`Invalid refresh token.`);
        }
        const refreshToken: JwtRefreshToken | undefined = await this.refreshTokenRepository.findOne(
            {
                where: { value: await this.hashService.hash(tokenValue, { strategy: Sha256HashStrategy }) },
                transaction,
                required: false
            }
        );

        if (!refreshToken) {
            throw new UnauthorizedError($ts`Invalid refresh token.`);
        }
        if (refreshToken.blacklisted && !this.isWithinReuseGrace(refreshToken)) {
            // outside the request's transaction: the refusal below rolls it back, and a family ended
            // inside it came back with the rollback - reuse was detected and ended nothing
            await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId });
            throw new CredentialReusedError($ts`Invalid refresh token.`);
        }
        if (new Date(refreshToken.expirationDate).getTime() <= Date.now()) {
            await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId }, { transaction });
            throw new UnauthorizedError($ts`Invalid refresh token.`);
        }
        // before it is spent, so that a refresh token stolen without the key it is bound to spends
        // nothing: the login it belongs to goes on for whoever holds the key
        await this.validateRefreshProof(refreshToken);
        // before it is spent as well, so a refresh an authenticator refuses - a directory that cannot be
        // reached, say - leaves the token working
        const found: UserType | undefined = await this.userService
            .findById<RoleType, UserType, false>(refreshToken.userId, { required: false });
        if (found == undefined) {
            throw new UnauthorizedError($ts`Invalid refresh token.`);
        }
        const user: UserType = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).resolveRefreshUser<RoleType, UserType>(found, transaction);

        // claimed before anything is minted, and only while it is still usable. The read above takes
        // no lock, so two requests carrying the same token both get this far - the condition on the
        // write is what decides between them. Whoever changes the row rotates it; the other finds
        // nothing to update, because by then the token really is spent.
        //
        // A token replaced within the grace is already claimed, and nothing is claimed again: the
        // caller is a second tab that refreshed with the same token as the first one did, and it is
        // minted a token of its own in the same family. The grace runs from the first replacement
        if (!refreshToken.blacklisted) {
            try {
                await this.refreshTokenRepository.updateById(
                    refreshToken.id,
                    { blacklisted: true, replacedAt: new Date() },
                    { transaction, where: { blacklisted: false } }
                );
            }
            catch (error) {
                if (!(error instanceof NotFoundError)) {
                    throw error;
                }
                // deliberately no family delete. Reuse of an *already* blacklisted token is caught by
                // the check above and does destroy the family, which is what reuse detection is for.
                // Losing this race is a client with two requests in flight, and logging that user out
                // would turn its own retry into an attack on itself.
                throw new UnauthorizedError($ts`Invalid refresh token.`);
            }
        }

        const authTime: number = encoded.payload.auth_time;
        const refreshTokenValue: string = await this.generateRefreshToken(user, authTime);

        return {
            refreshToken: await this.createRefreshToken(
                user,
                refreshTokenValue,
                refreshToken.familyId,
                authTime,
                // the session at a provider stays with the login, like its time, its key and how the
                // user proved who they are there
                FederatedSessionUtilities.toColumns(FederatedSessionUtilities.fromColumns(refreshToken)),
                refreshToken.dpopKeyThumbprint ?? undefined,
                refreshToken.providerAuthentication ?? undefined,
                transaction
            ),
            value: refreshTokenValue,
            authTime,
            user
        };
    }

    /**
     * Refuses a refresh that does not prove it holds the key its login is bound to.
     * @param refreshToken - The stored refresh token.
     * @throws An OAuth2Error `invalid_dpop_proof` when the login is bound to a key the request proves no
     * hold of, or is bound to none while logins have to be, or `use_dpop_nonce`.
     */
    private async validateRefreshProof(refreshToken: JwtRefreshToken): Promise<void> {
        const bound: string | undefined = refreshToken.dpopKeyThumbprint ?? undefined;
        if (bound == undefined && !this.requireDpop) {
            return;
        }
        if (bound == undefined || await this.resolveRequestKeyThumbprint() !== bound) {
            throw new OAuth2Error(
                OAuth2ErrorCode.INVALID_DPOP_PROOF,
                $ts`The login is bound to a DPoP key, which the request proves no hold of.`
            );
        }
    }

    /**
     * The DPoP key the request being answered proves it holds, outside of a request to a resource.
     * @returns The thumbprint of the key, or undefined when there is no request or it carries no proof.
     */
    private async resolveRequestKeyThumbprint(): Promise<string | undefined> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        return context == undefined ? undefined : await this.dpopService.resolveProofThumbprint(context, undefined);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    hasCredential(context: HttpRequestContext | WebsocketRequestContext): boolean {
        // a bearer token shaped like a jwt being present, not a valid one. Whether it verifies is what
        // resolving it decides - answering false for a bad token would make a request carrying a bad
        // token and a good cookie resolve as the cookie's user, which is exactly the mix this exists
        // to refuse. The shape is what leaves an opaque bearer token, such as an api key sent as one,
        // to the strategy it belongs to, a token shaped like a client's to ClientAccessTokenAuthStrategy,
        // so that a route naming this strategy stays one for people, and a token another issuer names
        // to ProviderTokenAuthStrategy
        return AuthorizationHeaderUtilities.findJwtKind(context, this.jwtService.issuer) === 'login';
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<UserType | undefined> {
        const token: LoginAccessToken<RoleType> | undefined = await this.findRequestLoginToken(context);
        if (token == undefined) {
            return undefined;
        }
        // the token verifies over an account that may since have been deleted, which is "not logged
        // in" rather than an error. Read beside whether the token is still live, which costs nothing
        // while tokens are revoked on expiry
        const [user, live] = await Promise.all([
            this.userService.findById<RoleType, UserType, false>(token.payload.id, { required: false }),
            this.isLoginLive(token.payload)
        ]);
        return live ? user : undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveClaimedUser(context: HttpRequestContext | WebsocketRequestContext): Promise<ClaimedUser<RoleType> | undefined> {
        const token: LoginAccessToken<RoleType> | undefined = await this.findRequestLoginToken(context);
        if (token == undefined) {
            return undefined;
        }
        // everything a check needs is already in the payload - an id, roles, and the roles in each
        // tenant. What it cannot carry is the rest of the application's own user entity, which is why
        // this is not the type resolveUser returns and why the current user never comes from here.
        return { id: token.payload.id, roles: token.payload.roles, tenantRoles: token.payload.tenant_roles };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveAuthenticatedAt(context: HttpRequestContext | WebsocketRequestContext): Promise<Date | undefined> {
        const token: LoginAccessToken<RoleType> | undefined = await this.findRequestLoginToken(context);
        return token == undefined ? undefined : new Date(token.payload.auth_time * Ms.SECOND);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveProviderAuthentication(
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<ProviderAuthentication | undefined> {
        const token: LoginAccessToken<RoleType> | undefined = await this.findRequestLoginToken(context);
        if (token == undefined || (token.payload.amr == undefined && token.payload.acr == undefined)) {
            return undefined;
        }
        return { methods: token.payload.amr ?? [], contextClass: token.payload.acr };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveExpiresAt(context: HttpRequestContext | WebsocketRequestContext): Promise<Date | undefined> {
        const token: LoginAccessToken<RoleType> | undefined = await this.findRequestLoginToken(context);
        return token == undefined ? undefined : new Date(token.verified.expiresAt * Ms.SECOND);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async introspectToken(token: string): Promise<IntrospectionResponse> {
        // whoever the token is for: a service asking about it is not the application
        const accessToken: LoginAccessToken<string> | undefined = await this.findLoginAccessToken(token, undefined);
        if (accessToken != undefined) {
            const [user, live] = await Promise.all([this.findActiveUser(accessToken.payload.id), this.isLoginLive(accessToken.payload)]);
            if (user == undefined || !live) {
                return { active: false };
            }
            // what a request with the token holds now, in whichever tenant it acts
            const held: string[] = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).resolveUserPermissions(user, undefined);
            return {
                active: true,
                scope: held.join(' '),
                username: user.email,
                token_type: accessToken.payload.cnf?.jkt == undefined ? 'Bearer' : 'DPoP',
                exp: accessToken.verified.expiresAt,
                iat: accessToken.verified.issuedAt,
                sub: user.id,
                aud: accessToken.verified.audience,
                iss: this.jwtService.issuer,
                ...accessToken.payload.cnf == undefined ? {} : { cnf: accessToken.payload.cnf }
            };
        }
        const refreshToken: JwtRefreshToken | undefined = await this.findRefreshToken(token);
        const user: BaseUser<string> | undefined = refreshToken == undefined ? undefined : await this.findActiveUser(refreshToken.userId);
        if (refreshToken == undefined || user == undefined) {
            return { active: false };
        }
        return {
            active: true,
            username: user.email,
            token_type: 'refresh_token',
            exp: Math.floor(new Date(refreshToken.expirationDate).getTime() / Ms.SECOND),
            sub: user.id,
            iss: this.jwtService.issuer
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revokeToken(token: string): Promise<void> {
        const accessToken: LoginAccessToken<string> | undefined = await this.findLoginAccessToken(token, undefined);
        if (accessToken != undefined) {
            if (this.accessTokenRevocation === 'onExpiry') {
                throw new OAuth2Error(
                    OAuth2ErrorCode.UNSUPPORTED_TOKEN_TYPE,
                    $ts`Access tokens work until they expire, so they cannot be revoked.`
                );
            }
            // the login the token belongs to, which is what it is checked against
            await this.refreshTokenRepository.deleteAll({ familyId: accessToken.payload.sid });
            return;
        }
        const refreshToken: JwtRefreshToken | undefined = await this.findRefreshToken(token);
        if (refreshToken != undefined) {
            // ends the login, as a logout does
            await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId });
        }
    }

    /**
     * Whether the login an access token belongs to has not ended. Always true while access tokens are
     * revoked on expiry.
     * @param payload - What the token says.
     * @returns True while the token may still be used.
     */
    private async isLoginLive(payload: JwtAccessTokenPayload<string, BaseUser<string>>): Promise<boolean> {
        if (this.accessTokenRevocation === 'onExpiry') {
            return true;
        }
        // a logout, ended logins and a spent token reused all delete the family, and rotating it keeps it
        return await this.refreshTokenRepository.findOne({ where: { familyId: payload.sid }, required: false }) != undefined;
    }

    /**
     * Finds a user who exists and is not deactivated.
     * @param userId - The id of the user.
     * @returns The user, or undefined.
     */
    private async findActiveUser(userId: string): Promise<UserType | undefined> {
        const user: UserType | undefined = await this.userService.findById<RoleType, UserType, false>(userId, { required: false });
        return user?.deactivatedAt == undefined ? user : undefined;
    }

    /**
     * Finds what an access token of a login says.
     * @param token - The token.
     * @param audience - Who the token must be for, or undefined for anyone.
     * @returns What it says, or undefined when it does not verify or is no login's.
     */
    private async findLoginAccessToken<Role extends string>(
        token: string,
        audience: string | undefined
    ): Promise<LoginAccessToken<Role> | undefined> {
        const verified: VerifiedJwt | undefined = await this.jwtService.findAccessToken(token, audience);
        return verified != undefined && isJwtAccessTokenPayload<Role>(verified.payload)
            ? { verified, payload: verified.payload }
            : undefined;
    }

    /**
     * Finds the stored refresh token a token is, while it may still be exchanged.
     * @param token - The token.
     * @returns The stored token, or undefined when it does not verify, is unknown, spent or expired.
     */
    private async findRefreshToken(token: string): Promise<JwtRefreshToken | undefined> {
        const encoded: EncodedJwt | undefined = await this.verifyRefreshToken(token);
        if (encoded == undefined || !isJwtRefreshTokenPayload(encoded.payload)) {
            return undefined;
        }
        const refreshToken: JwtRefreshToken | undefined = await this.refreshTokenRepository.findOne({
            where: { value: await this.hashService.hash(token, { strategy: Sha256HashStrategy }) },
            required: false
        });
        if (
            refreshToken == undefined
            || (refreshToken.blacklisted && !this.isWithinReuseGrace(refreshToken))
            || new Date(refreshToken.expirationDate).getTime() <= Date.now()
        ) {
            return undefined;
        }
        return refreshToken;
    }

    /**
     * Whether a spent token is still accepted: a rotation replaced it less than the grace ago.
     * @param refreshToken - The stored token.
     * @returns True inside the grace.
     */
    private isWithinReuseGrace(refreshToken: JwtRefreshToken): boolean {
        return refreshToken.replacedAt != undefined
            && Date.now() - new Date(refreshToken.replacedAt).getTime() < this.refreshTokenReuseGraceInMs;
    }

    private async findRequestLoginToken(
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<LoginAccessToken<RoleType> | undefined> {
        const token: AuthorizationToken | undefined = AuthorizationHeaderUtilities.findToken(context);
        // only a token of a login, and only one for this application
        const found: LoginAccessToken<RoleType> | undefined = token == undefined
            ? undefined
            : await this.findLoginAccessToken<RoleType>(token.value, this.jwtService.issuer);
        const keyThumbprint: string | undefined = found?.payload.cnf?.jkt;
        if (token == undefined || found == undefined || (keyThumbprint == undefined && this.requireDpop)) {
            return undefined;
        }
        // bound to a DPoP key, which the request proves it holds: a token stolen without the key is
        // worth nothing
        return await this.dpopService.isSentAsBound(context, token, keyThumbprint) ? found : undefined;
    }

    private async verifyRefreshToken(token: string): Promise<EncodedJwt | undefined> {
        return await JwtUtilities.verify(
            token,
            this.refreshTokenVerificationKeys,
            { issuer: this.jwtService.issuer, audience: undefined, type: 'JWT' }
        );
    }

    private async generateAccessToken(
        user: UserType,
        authTime: number,
        familyId: string,
        dpopKeyThumbprint: string | undefined,
        providerAuthentication: ProviderAuthentication | undefined
    ): Promise<string> {
        // only while checks trust the credential: a check in a tenant reads these in place of the
        // membership then, and otherwise they would only make every token longer. As stale as the
        // roles beside them, until the next refresh
        const tenantRoles: Record<string, string[]> | undefined = inject(ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK)
            ? undefined
            : await this.resolveTenantRoles(user.id);
        const payload: JwtAccessTokenPayload<RoleType, UserType> = {
            id: user.id,
            roles: user.roles,
            ...tenantRoles == undefined ? {} : { tenant_roles: tenantRoles },
            auth_time: authTime,
            sid: familyId,
            ...dpopKeyThumbprint == undefined ? {} : { cnf: { jkt: dpopKeyThumbprint } },
            // under the claims OpenID Connect gives them, so whatever reads the token by the published
            // keys finds them where the standard puts them
            ...providerAuthentication == undefined ? {} : { amr: providerAuthentication.methods },
            ...providerAuthentication?.contextClass == undefined ? {} : { acr: providerAuthentication.contextClass }
        };

        try {
            // for this application, so a service verifying tokens by the published keys can tell the
            // ones that are for it apart
            return await this.jwtService.signAccessToken(payload, this.jwtService.issuer);
        }
        catch (error) {
            throw new UnauthorizedError($ts`Error generating token`, { cause: error });
        }
    }

    /**
     * Resolves the roles of a user's active memberships, by tenant.
     * @param userId - The user.
     * @returns The roles of each tenant the user is an active member of.
     */
    private async resolveTenantRoles(userId: string): Promise<Record<string, string[]>> {
        const memberships: BaseMembership<string>[] = await this.membershipService.findActiveMemberships(userId);
        return Object.fromEntries(memberships.map(membership => [membership.tenantId, membership.roles]));
    }

    private async generateRefreshToken(user: UserType, authTime: number): Promise<string> {
        const payload: JwtRefreshTokenPayload<RoleType, UserType> = {
            userId: user.id,
            auth_time: authTime
        };

        return await JwtUtilities.sign(payload, this.refreshTokenSigningKey, {
            expiresInMs: this.refreshTokenExpiresInMs,
            issuer: this.jwtService.issuer,
            // only ever read here, and told apart from an access token by its key and its typ
            audience: undefined,
            type: 'JWT',
            jwtId: UUIDUtilities.generate()
        });
    }
}