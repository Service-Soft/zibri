import { randomBytes } from 'crypto';

import { EncodedJwt } from './encoded-jwt-access-token.model';
import { isJwtAccessTokenPayload, JwtAccessTokenPayload } from './jwt-access-token-payload.model';
import { JwtAuthData } from './jwt-auth-data.model';
import { type JwtAuthOptions } from './jwt-auth-options.model';
import { PasswordResetEmailTemplate } from './jwt-auth.controller';
import { JwtConfirmPasswordResetData } from './jwt-confirm-password-reset-data.model';
import { JwtCredentials, JwtCredentialsCreateData, JwtCredentialsDto } from './jwt-credentials.model';
import { JwtRefreshLoginData } from './jwt-refresh-login-data.model';
import { JwtRefreshTokenCleanupCronJob } from './jwt-refresh-token-cleanup.cron-job';
import { isJwtRefreshTokenPayload, JwtRefreshTokenPayload } from './jwt-refresh-token-payload.model';
import { JwtRefreshToken, JwtRefreshTokenCreateDto } from './jwt-refresh-token.model';
import { JwtRequestPasswordResetData } from './jwt-request-password-reset-data.model';
import { JwtUtilities } from './jwt.utilities';
import { ZibriApplication } from '../../../application/application';
import { HttpRequestContext } from '../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../../di/errors/no-provider.error';
import { inject } from '../../../di/inject.function';
import { type EmailServiceInterface } from '../../../email/email-service.interface';
import { EmailPriority } from '../../../email/models/email-priority.enum';
import { CredentialReusedError } from '../../../error-handling/errors/credential-reused.error';
import { HttpError } from '../../../error-handling/errors/http.error';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../../global/global-registry';
import { $ts } from '../../../localization/translate.function';
import { OpenApiSecuritySchemeObject } from '../../../open-api/open-api.model';
import { TsxUtilities } from '../../../tsx/tsx.utilities';
import { OmitStrict } from '../../../types/omit-strict.type';
import { Ms } from '../../../utilities/ms';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';
import { BaseUser } from '../../models/base-user.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from '../../models/password-reset-token.model';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { AuthStrategyInterface } from '../auth-strategy.interface';

/**
 * An error to throw when one of the two required jwt signing secrets has not been configured.
 *
 * There is deliberately no default: a framework that invented one would ship every application the
 * same signing key, and anyone who read the source could mint tokens for all of them.
 */
class MissingJwtSecretError extends InternalError {
    constructor(secret: 'accessTokenSecret' | 'refreshTokenSecret', options?: ErrorOptions) {
        super(
            [
                `No ${secret} configured on ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT.`,
                'It has no default, because a shared one would let anyone with the source mint tokens.'
            ],
            options
        );
        this.name = 'MissingJwtSecretError';
    }
}

/**
 * Jwt auth strategy implementation of Zibri.
 */
export class JwtAuthStrategy<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
>
implements AuthStrategyInterface<
    RoleType,
    UserType,
    JwtAuthData<RoleType>,
    JwtCredentialsDto,
    JwtRequestPasswordResetData<RoleType, UserType>,
    JwtConfirmPasswordResetData,
    JwtRefreshLoginData,
    OmitStrict<JwtRefreshLoginData, 'transaction'>
> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'jwt';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly securityScheme: OpenApiSecuritySchemeObject = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token in the format `Bearer <token>`'
    };

    // the current secret first, then every previous one. Non empty by construction, and the first
    // entry is the only one anything signs with - the rest exist to verify tokens issued before a
    // rotation
    private readonly accessTokenSecrets: [string, ...string[]];
    private readonly refreshTokenSecrets: [string, ...string[]];
    private readonly accessTokenExpiresInMs: number;
    private readonly refreshTokenExpiresInMs: number;
    private readonly confirmPasswordResetUrl: string;
    private readonly PasswordResetEmail: PasswordResetEmailTemplate<RoleType, UserType>;
    private dummyPasswordHashPromise: Promise<HashString> | undefined;

    constructor(
        @InjectRepository(JwtRefreshToken)
        private readonly refreshTokenRepository: Repository<JwtRefreshToken>,
        @InjectRepository(PasswordResetToken)
        private readonly passwordResetTokenRepository: Repository<PasswordResetToken, PasswordResetTokenCreateData>,
        @InjectRepository(JwtCredentials)
        private readonly credentialsRepository: Repository<JwtCredentials, JwtCredentialsCreateData>,
        @Inject(ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS)
        options: JwtAuthOptions,
        @Inject(ZIBRI_DI_TOKENS.PASSWORD_RESET_TOKEN_EXPIRES_IN_MS)
        private readonly passwordResetTokenExpiresInMs: number,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
        private readonly emailService: EmailServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface
    ) {
        if (!options.accessTokenSecret) {
            throw new MissingJwtSecretError('accessTokenSecret');
        }
        if (!options.refreshTokenSecret) {
            throw new MissingJwtSecretError('refreshTokenSecret');
        }
        const accessTokenSecrets: [string, ...string[]] = [options.accessTokenSecret, ...options.previousAccessTokenSecrets];
        const refreshTokenSecrets: [string, ...string[]] = [options.refreshTokenSecret, ...options.previousRefreshTokenSecrets];
        this.validateDistinctSecrets(accessTokenSecrets, refreshTokenSecrets);

        const confirmPasswordResetUrl: string | undefined = inject(ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL);
        if (!confirmPasswordResetUrl) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL, []);
        }
        const PasswordResetEmail: PasswordResetEmailTemplate<RoleType, UserType> | undefined = inject(
            ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE
        );
        if (!PasswordResetEmail) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE, []);
        }

        this.accessTokenSecrets = accessTokenSecrets;
        this.refreshTokenSecrets = refreshTokenSecrets;
        this.accessTokenExpiresInMs = options.accessTokenExpiresInMs;
        this.refreshTokenExpiresInMs = options.refreshTokenExpiresInMs;
        this.confirmPasswordResetUrl = confirmPasswordResetUrl;
        this.PasswordResetEmail = PasswordResetEmail;
    }

    /**
     * Refuses a configuration in which one secret can verify a token it did not sign.
     *
     * Which secret verifies a token is the only thing that keeps the two kinds apart, so an access
     * secret shared with a refresh secret turns a 30 day credential meant to be exchanged once into
     * a bearer credential for as long as it lives. A previous secret repeated as the current one is
     * refused for the same reason it is pointless: it means a rotation that did not rotate, and
     * dropping it later would then invalidate live tokens rather than expired ones.
     * @param accessTokenSecrets - Every secret an access token may verify against.
     * @param refreshTokenSecrets - Every secret a refresh token may verify against.
     * @throws When any secret appears more than once across the two lists.
     */
    private validateDistinctSecrets(accessTokenSecrets: string[], refreshTokenSecrets: string[]): void {
        const all: string[] = [...accessTokenSecrets, ...refreshTokenSecrets];
        if (new Set(all).size === all.length) {
            return;
        }
        throw new InternalError([
            'The configured jwt secrets are not all distinct.',
            'Each kind of token is only distinguishable by the secret it verifies against, so',
            'sharing one lets a refresh token be presented as an access token.',
            'Every entry across accessTokenSecret, previousAccessTokenSecrets, refreshTokenSecret',
            'and previousRefreshTokenSecrets has to be a different value.'
        ]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(app: ZibriApplication): void {
        if (!app.options.cronJobs.includes(JwtRefreshTokenCleanupCronJob)) {
            app.options.cronJobs.push(JwtRefreshTokenCleanupCronJob);
        }
    }

    /**
     * The stored password for a user, or undefined when there is none to compare against.
     *
     * A user can exist without credentials - created by an admin, or registered through another
     * strategy - and that has to answer the same as a wrong password rather than as an error.
     * @param user - The user to look up.
     * @returns The stored hash, or undefined when the user has no credentials.
     */
    private async findStoredPassword(user: UserType): Promise<HashString | undefined> {
        try {
            const credentials: JwtCredentials = await this.userService.resolveCredentialsFor(user);
            return credentials.password;
        }
        catch {
            return undefined;
        }
    }

    /**
     * Re-hashes a password that was just proven correct, if the stored hash is out of date.
     *
     * Here rather than in `AuthService` because this is the one moment the plaintext exists, and the
     * user and stored hash are already loaded - driving it from the service would mean looking both
     * up again, and it has no typed way to know where a strategy keeps its credentials.
     *
     * Deliberately does not fail the login: the caller proved who they are, and a write that did not
     * happen is a hash that stays old rather than a reason to refuse them.
     * @param user - The user that just logged in.
     * @param password - The plaintext they logged in with.
     * @param storedPassword - The hash it was compared against.
     */
    private async upgradeStoredPassword(user: UserType, password: string, storedPassword: HashString): Promise<void> {
        try {
            if (!await this.hashService.needsRehash(storedPassword)) {
                return;
            }
            // written as plaintext on purpose: the entity hook hashes it on the way in, with whatever
            // the current strategy and cost are, which is the whole point of the upgrade
            await this.credentialsRepository.updateAll({ userId: user.id }, { password });
        }
        catch (error) {
            inject(ZIBRI_DI_TOKENS.LOGGER).warn(
                `Could not upgrade the stored password hash for user ${user.id}: ${String(error)}`
            );
        }
    }

    /**
     * Something to compare a password against when there is nothing real to compare it against.
     *
     * Hashed from a value nobody holds, with the default strategy, so a comparison against it costs
     * what a comparison against a real password costs and follows a change of strategy for free.
     * Computed once and reused - the very first miss in a process pays for producing it, which is
     * one request out of all of them.
     * @returns The stand-in hash.
     */
    private async dummyPasswordHash(): Promise<HashString> {
        this.dummyPasswordHashPromise ??= Promise.resolve(this.hashService.hash(randomBytes(32).toString('hex')));
        return await this.dummyPasswordHashPromise;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async login(credentials: JwtCredentialsDto): Promise<JwtAuthData<RoleType>> {
        try {
            const foundUser: UserType | undefined = await this.userService.findByEmail(credentials.email, { required: false });
            const storedPassword: HashString | undefined = foundUser == undefined
                ? undefined
                : await this.findStoredPassword(foundUser);

            // one comparison on every path, against a stand-in when there is nothing to compare
            // against. An unknown address used to answer before any key derivation ran while a known
            // one waited for a full scrypt, which made the response time an account existence oracle
            // - readable from anywhere, and unaffected by the messages being identical.
            const passwordMatched: boolean = await this.hashService.equal(
                credentials.password,
                storedPassword ?? await this.dummyPasswordHash()
            );
            if (foundUser == undefined || storedPassword == undefined || !passwordMatched) {
                throw new UnauthorizedError($ts`Invalid email or password.`);
            }
            await this.upgradeStoredPassword(foundUser, credentials.password, storedPassword);

            const accessTokenValue: string = await this.generateAccessToken(foundUser);
            const refreshTokenValue: string = await this.generateRefreshToken(foundUser);
            await this.createRefreshToken(foundUser, refreshTokenValue, UUIDUtilities.generate(), undefined);

            return {
                accessToken: {
                    value: accessTokenValue,
                    expirationDate: new Date(Date.now() + this.accessTokenExpiresInMs)
                },
                refreshToken: {
                    value: refreshTokenValue,
                    expirationDate: new Date(Date.now() + this.refreshTokenExpiresInMs)
                },
                userId: foundUser.id,
                roles: foundUser.roles
            };
        }
        catch (error) {
            // B4's uniformity is about the ways of being refused: every one of them has to answer
            // the same, or the difference says whether the address is registered. A fault is not one
            // of those, and folding it in here made a user store that is down answer exactly like a
            // wrong password - to the caller, and in the audit trail, where an outage then reads as
            // a credential stuffing run. It surfaces as a masked 500 instead.
            if (!(error instanceof HttpError)) {
                throw error;
            }
            throw new UnauthorizedError($ts`Invalid email or password.`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async logout(data: OmitStrict<JwtRefreshLoginData, 'transaction'>): Promise<void> {
        try {
            // hashed to be searched for, because that is how it is stored. Has to name the same
            // strategy the property does, or the column is written one way and read another.
            const refreshToken: JwtRefreshToken | undefined = await this.refreshTokenRepository.findOne(
                { where: { value: await this.hashService.hash(data.refreshToken, { strategy: Sha256HashStrategy }) }, required: false }
            );
            if (!refreshToken) {
                return;
            }
            await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId });
        }
        catch {
            // ignore
        }
    }

    private async createRefreshToken(
        foundUser: UserType,
        refreshTokenValue: string,
        familyId: string,
        transaction: Transaction | undefined
    ): Promise<JwtRefreshToken> {
        const data: JwtRefreshTokenCreateDto = {
            userId: foundUser.id,
            value: refreshTokenValue,
            familyId,
            blacklisted: false,
            expirationDate: new Date(Date.now() + this.refreshTokenExpiresInMs)
        };
        return await this.refreshTokenRepository.create(data, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async refreshLogin(data: JwtRefreshLoginData): Promise<JwtAuthData<RoleType>> {
        const refreshToken: JwtRefreshToken = await this.verifyAndResolveRefreshToken(data.refreshToken, data.transaction);
        const user: UserType = await this.userService.findById(refreshToken.userId);
        const accessTokenValue: string = await this.generateAccessToken(user);

        return {
            userId: user.id,
            roles: user.roles,
            refreshToken: {
                value: refreshToken.value,
                expirationDate: refreshToken.expirationDate
            },
            accessToken: {
                value: accessTokenValue,
                expirationDate: new Date(Date.now() + this.accessTokenExpiresInMs)
            }
        };
    }

    private async verifyAndResolveRefreshToken(tokenValue: string, transaction: Transaction): Promise<JwtRefreshToken> {
        const encoded: EncodedJwt | undefined = await JwtUtilities.verify(tokenValue, this.refreshTokenSecrets, this.issuer);
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
        if (refreshToken.blacklisted) {
            await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId }, { transaction });
            throw new CredentialReusedError($ts`Invalid refresh token.`);
        }
        if (new Date(refreshToken.expirationDate).getTime() <= Date.now()) {
            await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId }, { transaction });
            throw new UnauthorizedError($ts`Invalid refresh token.`);
        }

        // claimed before anything is minted, and only while it is still usable. The read above takes
        // no lock, so two requests carrying the same token both get this far - the condition on the
        // write is what decides between them. Whoever changes the row rotates it; the other finds
        // nothing to update, because by then the token really is spent.
        try {
            await this.refreshTokenRepository.updateById(
                refreshToken.id,
                { blacklisted: true },
                { transaction, where: { blacklisted: false } }
            );
        }
        catch (error) {
            if (!(error instanceof NotFoundError)) {
                throw error;
            }
            // deliberately no family delete. Reuse of an *already* blacklisted token is caught by the
            // check above and does destroy the family, which is what reuse detection is for. Losing
            // this race is a client with two requests in flight, and logging that user out would turn
            // its own retry into an attack on itself.
            throw new UnauthorizedError($ts`Invalid refresh token.`);
        }

        const user: UserType = await this.userService.findById(refreshToken.userId);
        const refreshTokenValue: string = await this.generateRefreshToken(user);

        return await this.createRefreshToken(user, refreshTokenValue, refreshToken.familyId, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestPasswordReset(data: JwtRequestPasswordResetData<RoleType, UserType>): Promise<void> {
        if (await this.activePasswordResetTokenAlreadyExists(data.user, data.transaction)) {
            // silently, because answering differently here told an unauthenticated caller that the
            // address exists *and* that somebody recently asked to reset it. One live token at a
            // time is still the rule - the account already has a usable one in its inbox, so there
            // is nothing to do rather than something to refuse.
            return;
        }

        // kept here, because it does not survive being stored: the property is hashed on the way in,
        // so the created entity holds the hash and this is the only moment the token itself exists.
        // Reading it back off the entity mailed the user a hash of their own token.
        const tokenValue: string = randomBytes(16).toString('hex');
        const resetTokenData: PasswordResetTokenCreateData = {
            value: tokenValue,
            userId: data.user.id,
            expirationDate: new Date(Date.now() + this.passwordResetTokenExpiresInMs)
        };
        await this.passwordResetTokenRepository.create(resetTokenData, { transaction: data.transaction });

        const html: string = TsxUtilities.renderEmail(
            this.PasswordResetEmail,
            {
                user: data.user,
                confirmPasswordResetLink: `${data.emailData?.confirmPasswordResetUrl ?? this.confirmPasswordResetUrl}/${tokenValue}`
            }
        );

        await this.emailService.queue({
            recipients: [data.user.email],
            subject: 'Password Reset',
            html,
            priority: EmailPriority.HIGH,
            ...data.emailData,
            // after the spread, so an application cannot ask for this one to be kept. The mail body
            // carries the token in the clear - that is what a reset link is - and the queue row is
            // deleted once it is sent. Retaining it would put back exactly the readable token that
            // hashing the stored value removed, and keep it long after the token itself expired.
            persist: false
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPasswordReset(data: JwtConfirmPasswordResetData): Promise<void> {
        const resetToken: PasswordResetToken | undefined = await this.passwordResetTokenRepository.findOne(
            {
                where: { value: await this.hashService.hash(data.resetToken, { strategy: Sha256HashStrategy }) },
                transaction: data.transaction,
                required: false
            }
        );
        if (!resetToken) {
            throw new UnauthorizedError($ts`Link invalid`);
        }
        if (new Date(resetToken.expirationDate).getTime() <= Date.now()) {
            await this.passwordResetTokenRepository.deleteById(resetToken.id, { transaction: data.transaction });
            throw new UnauthorizedError($ts`Link expired`);
        }

        const user: UserType = await this.userService.findById(resetToken.userId);
        const credentials: JwtCredentials = await this.userService.resolveCredentialsFor(user);

        await this.credentialsRepository.updateById(credentials.id, { password: data.newPassword }, { transaction: data.transaction });
        await this.passwordResetTokenRepository.deleteById(resetToken.id, { transaction: data.transaction });
        await this.refreshTokenRepository.deleteAll({ userId: resetToken.userId }, { transaction: data.transaction });
        // TODO: set require password change to false
    }

    private async activePasswordResetTokenAlreadyExists(user: BaseUser<RoleType>, transaction: Transaction): Promise<boolean> {
        const existingToken: PasswordResetToken | undefined = await this.passwordResetTokenRepository.findOne(
            { where: { userId: user.id }, transaction, required: false }
        );
        if (existingToken) {
            if (new Date(existingToken.expirationDate).getTime() > Date.now()) {
                return true;
            }
            await this.passwordResetTokenRepository.deleteById(existingToken.id, { transaction });
        }
        return false;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    hasCredential(context: HttpRequestContext | WebsocketRequestContext): boolean {
        // a bearer token being present, not a valid one. Whether it verifies is what resolving it
        // decides - answering false for a bad token would make a request carrying a bad token and a
        // good cookie resolve as the cookie's user, which is exactly the mix this exists to refuse.
        return this.extractAccessTokenFromRequestContext(context) != undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<UserType | undefined> {
        const jwt: string | undefined = this.extractAccessTokenFromRequestContext(context);
        if (!jwt) {
            return undefined;
        }
        const data: EncodedJwt | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecrets, this.issuer);
        if (!data || !isJwtAccessTokenPayload<RoleType>(data.payload)) {
            return undefined;
        }

        // the token verifies over an account that may since have been deleted, which is "not logged
        // in" rather than an error
        return await this.userService.findById<RoleType, UserType, false>(data.payload.id, { required: false });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveClaimedUser(context: HttpRequestContext | WebsocketRequestContext): Promise<BaseUser<RoleType> | undefined> {
        const jwt: string | undefined = this.extractAccessTokenFromRequestContext(context);
        if (!jwt) {
            return undefined;
        }
        const data: EncodedJwt | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecrets, this.issuer);
        if (!data || !isJwtAccessTokenPayload<RoleType>(data.payload)) {
            return undefined;
        }
        // everything a check needs is already in the payload - an id, an email and roles is a base
        // user. What it cannot carry is the rest of the application's own user entity, which is why
        // this is not the type resolveUser returns and why the current user never comes from here.
        return { id: data.payload.id, email: data.payload.email, roles: data.payload.roles };
    }

    private extractAccessTokenFromRequestContext(
        context: HttpRequestContext | WebsocketRequestContext
    ): string | undefined {
        const authHeader: string | string[] | undefined = context.request.headers?.authorization;
        if (authHeader == undefined || typeof authHeader !== 'string') {
            return undefined;
        }
        const parts: string[] = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return undefined;
        }
        return parts[1];
    }

    /**
     * Who this application says it is, on the tokens it signs and on the ones it accepts.
     *
     * The application's own name. Read per call rather than in the constructor, because a strategy
     * can be constructed before the application data is registered.
     * @returns The issuer to sign with and to require.
     * @throws When the application has no name, since signing and verifying with an undefined issuer
     * turns the check off rather than failing.
     */
    private get issuer(): string {
        const name: string | undefined = GlobalRegistry.getAppData('name');
        if (name == undefined) {
            throw new InternalError('Cannot issue or verify a jwt before the application has a name.');
        }
        return name;
    }

    private async generateAccessToken(user: UserType): Promise<string> {
        const payload: JwtAccessTokenPayload<RoleType, UserType> = {
            id: user.id,
            roles: user.roles,
            email: user.email
        };

        try {
            return await JwtUtilities.sign(
                payload,
                // always the current secret. The rest of the list only ever verifies
                this.accessTokenSecrets[0],
                {
                    expiresIn: this.accessTokenExpiresInMs / Ms.SECOND,
                    // refresh tokens carried this already; access tokens did not, and nothing checked
                    // it on either. Signed and required on both now.
                    issuer: this.issuer
                }
            );
        }
        catch (error) {
            throw new UnauthorizedError($ts`Error generating token`, { cause: error });
        }
    }

    private async generateRefreshToken(user: UserType): Promise<string> {
        const payload: JwtRefreshTokenPayload<RoleType, UserType> = {
            userId: user.id
        };

        return await JwtUtilities.sign(payload, this.refreshTokenSecrets[0], {
            expiresIn: this.refreshTokenExpiresInMs / Ms.SECOND,
            issuer: this.issuer,
            jwtid: UUIDUtilities.generate()
        });
    }
}