import { randomBytes } from 'node:crypto';

import { CookieAuthConfirmPasswordResetData } from './cookie-auth-confirm-password-reset-data.model';
import { CookieAuthRefreshLoginData } from './cookie-auth-refresh-login-data.model';
import { CookieAuthRefreshSession, CookieAuthRefreshSessionCreateData } from './cookie-auth-refresh-session.model';
import { CookieAuthRequestPasswordResetData } from './cookie-auth-request-password-reset-data.model';
import { CookieAuthSessionCleanupCronJob } from './cookie-auth-session-cleanup.cron-job';
import { CookieAuthSession, CookieAuthSessionCreateData } from './cookie-auth-session.model';
import { ZibriApplication } from '../../../application';
import { HttpRequestContext } from '../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { RepositoryTypeForEntity } from '../../../data-source/data-sources/data-source.interface';
import { Repository } from '../../../data-source/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { InjectRepository, repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../../di/errors/no-provider.error';
import { inject } from '../../../di/inject.function';
import { type EmailServiceInterface } from '../../../email/email-service.interface';
import { EmailPriority } from '../../../email/models/email-priority.enum';
import { BaseEntity } from '../../../entity/base-entity.model';
import { TooManyRequestsError } from '../../../error-handling/errors/too-many-requests.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { HttpMethod } from '../../../http/http-method.enum';
import { KnownHeader } from '../../../http/known-header.enum';
import { $ts } from '../../../localization/translate.function';
import { OpenApiSecuritySchemeObject } from '../../../open-api/open-api.model';
import { PreactUtilities } from '../../../preact/preact.utilities';
import { Newable } from '../../../types/newable.type';
import { type OmitStrict } from '../../../types/omit-strict.type';
import { Ms } from '../../../utilities/ms';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import { BaseUser } from '../../models/base-user.model';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { AuthStrategyInterface } from '../auth-strategy.interface';
import { CookieAuthCredentials, CookieAuthCredentialsData } from './cookie-auth-credentials.model';
import { CookieAuthData } from './cookie-auth-data.model';
import { CookieAuthLogoutData } from './cookie-auth-logout-data.model';
import { type CookieOptions } from '../../../http/cookie-options.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from '../../models/password-reset-token.model';
import { PasswordResetEmailTemplate } from '../jwt/jwt-auth.controller';

/**
 * Options input for any cookie session.
 */
export type CookieAuthSessionOptionsInput = OmitStrict<CookieOptions, 'maxAge' | 'expires' | 'signed' | 'httpOnly' | 'secure'>;

/**
 * Full options for any cookie session.
 */
type CookieAuthSessionOptions = OmitStrict<CookieOptions, 'secure'>
    & Required<Pick<CookieOptions, 'maxAge' | 'httpOnly' | 'signed' | 'sameSite'>>;

/**
 * Cookie auth strategy implementation of Zibri.
 */
export class CookieAuthStrategy<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements AuthStrategyInterface<
    RoleType,
    UserType,
    CookieAuthData<RoleType>,
    CookieAuthCredentialsData,
    CookieAuthRequestPasswordResetData<RoleType, UserType>,
    CookieAuthConfirmPasswordResetData,
    CookieAuthRefreshLoginData,
    CookieAuthLogoutData
> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'cookie';
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly securityScheme: OpenApiSecuritySchemeObject;

    private readonly confirmPasswordResetUrl: string;
    private readonly PasswordResetEmail: PasswordResetEmailTemplate<RoleType, UserType>;
    private readonly sessionOptions: CookieAuthSessionOptions;
    private readonly refreshSessionOptions: CookieAuthSessionOptions;

    constructor(
        @InjectRepository(CookieAuthSession)
        private readonly sessionRepository: Repository<CookieAuthSession, CookieAuthSessionCreateData>,
        @InjectRepository(CookieAuthRefreshSession)
        private readonly refreshSessionRepository: Repository<CookieAuthRefreshSession, CookieAuthRefreshSessionCreateData>,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CSRF_TOKEN_HEADER)
        private readonly csrfTokenHeader: string,
        @Inject(ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_OPTIONS)
        sessionOptions: OmitStrict<CookieOptions, 'maxAge' | 'expires'>,
        @Inject(ZIBRI_DI_TOKENS.COOKIE_AUTH_REFRESH_SESSION_OPTIONS)
        refreshSessionOptions: OmitStrict<CookieOptions, 'maxAge' | 'expires'>,
        @Inject(ZIBRI_DI_TOKENS.COOKIE_AUTH_SESSION_EXPIRES_IN_MS)
        private readonly sessionExpiresInMs: number,
        @Inject(ZIBRI_DI_TOKENS.COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS)
        private readonly refreshSessionExpiresInMs: number,
        @Inject(ZIBRI_DI_TOKENS.PASSWORD_RESET_TOKEN_EXPIRES_IN_MS)
        private readonly passwordResetTokenExpiresInMs: number,
        @InjectRepository(PasswordResetToken)
        private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
        @InjectRepository(CookieAuthCredentials)
        private readonly credentialsRepository: Repository<CookieAuthCredentials>,
        @Inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
        private readonly emailService: EmailServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET)
        secret: string | undefined
    ) {
        if (!secret) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, []);
        }
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

        this.confirmPasswordResetUrl = confirmPasswordResetUrl;
        this.PasswordResetEmail = PasswordResetEmail;

        this.sessionOptions = {
            maxAge: this.sessionExpiresInMs,
            signed: true,
            httpOnly: true,
            sameSite: 'lax',
            ...sessionOptions
        };
        this.refreshSessionOptions = {
            maxAge: this.refreshSessionExpiresInMs,
            signed: true,
            httpOnly: true,
            sameSite: 'lax',
            ...refreshSessionOptions
        };

        this.securityScheme = {
            type: 'apiKey',
            in: 'cookie',
            name: this.sessionOptions.name
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(app: ZibriApplication): void {
        if (!app.options.cronJobs.includes(CookieAuthSessionCleanupCronJob)) {
            app.options.cronJobs.push(CookieAuthSessionCleanupCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<UserType | undefined> {
        const session: CookieAuthSession | undefined = await this.resolveAndValidateSession(context, undefined);
        if (!session) {
            return undefined;
        }

        return await this.userService.findById<RoleType, UserType>(session.userId);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async login(credentials: CookieAuthCredentialsData): Promise<CookieAuthData<RoleType>> {
        try {
            const foundUser: UserType = await this.userService.findByEmail(credentials.email);
            const credentialsFound: CookieAuthCredentials = await this.userService.resolveCredentialsFor(foundUser);
            const passwordMatched: boolean = await this.hashService.equal(credentials.password, credentialsFound.password);
            if (!passwordMatched) {
                throw new UnauthorizedError($ts`Invalid email or password.`);
            }

            const refreshSession: CookieAuthRefreshSession = await this.createRefreshSession(
                foundUser.id,
                UUIDUtilities.generate(),
                credentials.transaction,
                randomBytes(32).toString('base64url')
            );
            const session: CookieAuthSession = await this.createSession(refreshSession, credentials.transaction);
            this.setRefreshSessionCookie(refreshSession);
            this.setSessionCookie(session);

            return {
                userId: session.userId,
                roles: foundUser.roles,
                csrfToken: refreshSession.csrfToken,
                sessionExpirationDate: session.expirationDate,
                refreshSessionExpirationDate: refreshSession.expirationDate
            };
        }
        catch {
            throw new UnauthorizedError($ts`Invalid email or password.`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async logout(data: CookieAuthLogoutData): Promise<void> {
        try {
            const refreshSession: CookieAuthRefreshSession | undefined = await this.refreshSessionRepository.findOne(
                { where: { id: data.refreshSessionId }, transaction: data.transaction },
                false
            );
            await this.refreshSessionRepository.deleteAll({ id: data.refreshSessionId }, { transaction: data.transaction });
            if (refreshSession) {
                await this.sessionRepository.deleteAll({ familyId: refreshSession.familyId }, { transaction: data.transaction });
                await this.refreshSessionRepository.deleteAll({ familyId: refreshSession.familyId }, { transaction: data.transaction });
            }

            if (data.clearCookies) {
                this.clearCookies();
            }
        }
        catch {
            // ignore
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async refreshLogin(data: CookieAuthRefreshLoginData): Promise<CookieAuthData<RoleType>> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            throw new UnauthorizedError($ts`No valid context`);
        }

        const currentRefreshSession: CookieAuthRefreshSession | undefined = await this.resolveRefreshSession(context, data.transaction);
        if (!currentRefreshSession) {
            this.clearCookies();
            throw new UnauthorizedError($ts`No valid refresh session`);
        }
        if (new Date(currentRefreshSession.expirationDate).getTime() <= Date.now() || currentRefreshSession.blacklisted) {
            await this.logout({ clearCookies: true, refreshSessionId: currentRefreshSession.id, transaction: data.transaction });
            throw new UnauthorizedError($ts`No valid refresh session`);
        }
        if (!this.isCsrfTokenValid(currentRefreshSession, context)) {
            throw new UnauthorizedError($ts`No valid csrf token`);
        }

        const currentSession: CookieAuthSession | undefined = await this.resolveSession(context, data.transaction);
        if (currentSession && new Date(currentSession.expirationDate).getTime() > Date.now()) {
            // the current session is valid, no need to refresh
            const user: UserType = await this.userService.findById(currentSession.userId);
            return {
                userId: currentSession.userId,
                roles: user.roles,
                csrfToken: currentRefreshSession.csrfToken,
                sessionExpirationDate: currentSession.expirationDate,
                refreshSessionExpirationDate: currentRefreshSession.expirationDate
            };
        }

        const newSession: CookieAuthSession = await this.rotateSessions(currentRefreshSession, data.transaction);
        const user: UserType = await this.userService.findById(newSession.userId);

        return {
            userId: newSession.userId,
            roles: user.roles,
            csrfToken: currentRefreshSession.csrfToken,
            sessionExpirationDate: newSession.expirationDate,
            refreshSessionExpirationDate: new Date(Date.now() + this.refreshSessionExpiresInMs + (Ms.MINUTE * 5))
        };
    }

    private async rotateSessions(
        currentRefreshSession: CookieAuthRefreshSession,
        transaction: Transaction | undefined
    ): Promise<CookieAuthSession> {
        if (currentRefreshSession.blacklisted) {
            await this.logout({ clearCookies: true, refreshSessionId: currentRefreshSession.id, transaction });
        }
        // 1. invalidate old refresh (reuse detection)
        await this.refreshSessionRepository.updateById(
            currentRefreshSession.id,
            { blacklisted: true },
            { transaction }
        );

        // 2. create new refresh (same family + SAME csrf)
        const newRefresh: CookieAuthRefreshSession = await this.createRefreshSession(
            currentRefreshSession.userId,
            currentRefreshSession.familyId,
            transaction,
            currentRefreshSession.csrfToken
        );

        // 3. create new access session
        const newSession: CookieAuthSession = await this.createSession(newRefresh, transaction);

        // 4. set cookies (important: use current context)
        this.setSessionCookie(newSession);
        this.setRefreshSessionCookie(newRefresh);

        return newSession;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isLoggedIn(context: HttpRequestContext | WebsocketRequestContext): Promise<boolean> {
        return await this.resolveUser(context) !== undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async hasRole(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedRoles: RoleType[]
    ): Promise<boolean> {
        const user: UserType | undefined = await this.resolveUser(context);
        if (!user) {
            return false;
        }

        return user.roles.some(r => allowedRoles.includes(r));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async belongsTo<TargetEntity extends Newable<BaseEntity>>(
        context: HttpRequestContext | WebsocketRequestContext,
        targetEntity: TargetEntity,
        targetUserIdKey: keyof InstanceType<TargetEntity>,
        targetIdParamKey: string
    ): Promise<boolean> {
        const session: CookieAuthSession | undefined = await this.resolveAndValidateSession(context, undefined);
        if (!session) {
            return false;
        }

        try {
            const repo: RepositoryTypeForEntity<InstanceType<TargetEntity>> = inject(repositoryTokenFor(targetEntity));
            const targetId: string | undefined = context.request.params?.[targetIdParamKey];
            if (targetId == undefined) {
                throw new InternalError(`Could not find the target id specified as path param "${targetIdParamKey}"`);
            }
            const foundTarget: InstanceType<TargetEntity> = await repo.findById(targetId) as InstanceType<TargetEntity>;
            const userIdProperty: unknown = foundTarget[targetUserIdKey];
            if (Array.isArray(userIdProperty)) {
                return userIdProperty.includes(session.userId);
            }
            return userIdProperty === session.userId;
        }
        catch {
            return false;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestPasswordReset(data: CookieAuthRequestPasswordResetData<RoleType, UserType>): Promise<void> {
        if (await this.activePasswordResetTokenAlreadyExists(data.user, data.transaction)) {
            throw new TooManyRequestsError($ts`A password reset has already been requested for this account.`);
        }

        const resetTokenData: PasswordResetTokenCreateData = {
            value: randomBytes(16).toString('hex'),
            userId: data.user.id,
            expirationDate: new Date(Date.now() + this.passwordResetTokenExpiresInMs)
        };
        const resetToken: PasswordResetToken = await this.passwordResetTokenRepository.create(
            resetTokenData,
            { transaction: data.transaction }
        );

        const html: string = PreactUtilities.renderEmail(
            this.PasswordResetEmail,
            {
                user: data.user,
                confirmPasswordResetLink: `${data.emailData?.confirmPasswordResetUrl ?? this.confirmPasswordResetUrl}/${resetToken.value}`
            }
        );

        await this.emailService.queue({
            recipients: [data.user.email],
            subject: 'Password Reset',
            html,
            priority: EmailPriority.HIGH,
            ...data.emailData
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPasswordReset(data: CookieAuthConfirmPasswordResetData): Promise<void> {
        const resetToken: PasswordResetToken | undefined = await this.passwordResetTokenRepository.findOne(
            {
                where: { value: data.resetToken },
                transaction: data.transaction
            },
            false
        );
        if (!resetToken) {
            throw new UnauthorizedError($ts`Link invalid`);
        }
        if (new Date(resetToken.expirationDate).getTime() <= Date.now()) {
            await this.passwordResetTokenRepository.deleteById(resetToken.id, { transaction: data.transaction });
            throw new UnauthorizedError($ts`Link expired`);
        }

        const user: UserType = await this.userService.findById(resetToken.userId);
        const credentials: CookieAuthCredentials = await this.userService.resolveCredentialsFor(user);

        await this.credentialsRepository.updateById(credentials.id, { password: data.newPassword }, { transaction: data.transaction });
        await this.passwordResetTokenRepository.deleteById(resetToken.id, { transaction: data.transaction });
        await this.sessionRepository.deleteAll({ userId: resetToken.userId }, { transaction: data.transaction });
        // TODO: set require password change to false
    }

    private async activePasswordResetTokenAlreadyExists(user: BaseUser<RoleType>, transaction: Transaction | undefined): Promise<boolean> {
        const existingToken: PasswordResetToken | undefined = await this.passwordResetTokenRepository.findOne(
            { where: { userId: user.id }, transaction },
            false
        );
        if (existingToken) {
            if (new Date(existingToken.expirationDate).getTime() > Date.now()) {
                return true;
            }
            await this.passwordResetTokenRepository.deleteById(existingToken.id, { transaction });
        }
        return false;
    }

    private async resolveSession(
        context: HttpRequestContext | WebsocketRequestContext,
        transaction: Transaction | undefined
    ): Promise<CookieAuthSession | undefined> {
        if (!(context instanceof HttpRequestContext)) {
            return undefined;
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const currentSessionId: string | undefined = context.request.signedCookies?.[this.sessionOptions.name];
        if (!currentSessionId) {
            return undefined;
        }
        return await this.sessionRepository.findOne({ where: { id: currentSessionId }, transaction }, false);
    }

    private async resolveAndValidateSession(
        context: HttpRequestContext | WebsocketRequestContext,
        transaction: Transaction | undefined
    ): Promise<CookieAuthSession | undefined> {
        const refreshSession: CookieAuthRefreshSession | undefined = await this.resolveRefreshSession(context, transaction);

        if (!refreshSession) {
            this.clearCookies();
            return undefined;
        }
        if (new Date(refreshSession.expirationDate).getTime() <= Date.now() || refreshSession.blacklisted) {
            await this.logout({ clearCookies: true, refreshSessionId: refreshSession.id, transaction });
            return undefined;
        }
        if (!this.isCsrfTokenValid(refreshSession, context)) {
            return undefined;
        }

        const session: CookieAuthSession | undefined = await this.resolveSession(context, transaction);
        if (!session) {
            return undefined;
        }
        if (new Date(session.expirationDate).getTime() <= Date.now()) {
            return await this.rotateSessions(refreshSession, transaction);
        }

        if (session.familyId !== refreshSession.familyId || session.userId !== refreshSession.userId) {
            return undefined;
        }

        return session;
    }

    private isCsrfTokenValid(
        refreshSession: CookieAuthRefreshSession,
        context: HttpRequestContext | WebsocketRequestContext
    ): boolean {
        if (!(context instanceof HttpRequestContext)) {
            return false;
        }

        if ([HttpMethod.GET, HttpMethod.HEAD, HttpMethod.OPTIONS].includes(context.request.method)) {
            // don't validate safe methods
            return true;
        }
        const csrfToken: string | undefined = this.resolveCsrfTokenFromHeader(context);
        return csrfToken === refreshSession.csrfToken;
    }

    private async resolveRefreshSession(
        context: HttpRequestContext | WebsocketRequestContext,
        transaction: Transaction | undefined
    ): Promise<CookieAuthRefreshSession | undefined> {
        if (!(context instanceof HttpRequestContext)) {
            return undefined;
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const currentRefreshSessionId: string | undefined = context.request.signedCookies?.[this.refreshSessionOptions.name];
        if (!currentRefreshSessionId) {
            return undefined;
        }
        return await this.refreshSessionRepository.findOne(
            { where: { id: currentRefreshSessionId }, transaction },
            false
        );
    }

    private async createSession(
        refreshSession: CookieAuthRefreshSession,
        transaction: Transaction | undefined
    ): Promise<CookieAuthSession> {
        const sessionCreateData: CookieAuthSessionCreateData = {
            userId: refreshSession.userId,
            familyId: refreshSession.familyId,
            expirationDate: new Date(Date.now() + this.sessionExpiresInMs + (Ms.MINUTE * 5))
        };
        return await this.sessionRepository.create(sessionCreateData, { transaction });
    }

    private async createRefreshSession(
        userId: string,
        familyId: string,
        transaction: Transaction | undefined,
        csrfToken: string
    ): Promise<CookieAuthRefreshSession> {
        return await this.refreshSessionRepository.create({
            userId,
            blacklisted: false,
            familyId,
            expirationDate: new Date(Date.now() + this.refreshSessionExpiresInMs + (Ms.MINUTE * 5)),
            csrfToken
        }, { transaction });
    }

    private resolveCsrfTokenFromHeader(context: HttpRequestContext | WebsocketRequestContext): string | undefined {
        if (!(context instanceof HttpRequestContext)) {
            return undefined;
        }
        return context.request.headers[this.csrfTokenHeader as KnownHeader];
    }

    private clearCookies(): void {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            return;
        }
        context.response.clearCookie(this.sessionOptions.name, this.sessionOptions);
        context.response.clearCookie(this.refreshSessionOptions.name, this.refreshSessionOptions);
    }

    private setSessionCookie(session: CookieAuthSession): void {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            return;
        }
        const secure: boolean = context.request.secure || context.request.headers[KnownHeader.X_FORWARDED_PROTO] === 'https';
        context.response.cookie(this.sessionOptions.name, session.id, { ...this.sessionOptions, secure });
    }

    private setRefreshSessionCookie(session: CookieAuthRefreshSession): void {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            return;
        }
        const secure: boolean = context.request.secure || context.request.headers[KnownHeader.X_FORWARDED_PROTO] === 'https';
        context.response.cookie(this.refreshSessionOptions.name, session.id, { ...this.refreshSessionOptions, secure });
    }
}