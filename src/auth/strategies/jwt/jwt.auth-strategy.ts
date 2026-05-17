import { randomBytes } from 'crypto';

import { EncodedJwtAccessToken } from './encoded-jwt-access-token.model';
import { JwtAccessTokenPayload } from './jwt-access-token-payload.model';
import { JwtAuthData } from './jwt-auth-data.model';
import { JwtConfirmPasswordResetData } from './jwt-confirm-password-reset-data.model';
import { JwtCredentials, JwtCredentialsCreateData, JwtCredentialsDto } from './jwt-credentials.model';
import { JwtRefreshLoginData } from './jwt-refresh-login-data.model';
import { JwtRefreshTokenCleanupCronJob } from './jwt-refresh-token-cleanup.cron-job';
import { JwtRefreshTokenPayload } from './jwt-refresh-token-payload.model';
import { JwtRefreshToken, JwtRefreshTokenCreateDto } from './jwt-refresh-token.model';
import { JwtRequestPasswordResetData } from './jwt-request-password-reset-data.model';
import { JwtUtilities } from './jwt.utilities';
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
import { GlobalRegistry } from '../../../global/global-registry';
import { OpenApiSecuritySchemeObject } from '../../../open-api/open-api.model';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { Ms } from '../../../utilities/ms';
import { BaseUser } from '../../models/base-user.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from '../../models/password-reset-token.model';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { AuthStrategyInterface } from '../auth-strategy.interface';
import { PasswordResetEmailTemplate } from './jwt-auth.controller';
import { PreactUtilities } from '../../../preact/preact.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { type HashServiceInterface } from '../../hash/hash-service.interface';

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

    private readonly accessTokenSecret: string;
    private readonly refreshTokenSecret: string;
    private readonly confirmPasswordResetUrl: string;
    private readonly PasswordResetEmail: PasswordResetEmailTemplate<RoleType, UserType>;

    constructor(
        @InjectRepository(JwtRefreshToken)
        private readonly refreshTokenRepository: Repository<JwtRefreshToken>,
        @InjectRepository(PasswordResetToken)
        private readonly passwordResetTokenRepository: Repository<PasswordResetToken, PasswordResetTokenCreateData>,
        @InjectRepository(JwtCredentials)
        private readonly credentialsRepository: Repository<JwtCredentials, JwtCredentialsCreateData>,
        @Inject(ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_EXPIRES_IN_MS)
        private readonly accessTokenExpiresInMs: number,
        @Inject(ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_EXPIRES_IN_MS)
        private readonly refreshTokenExpiresInMs: number,
        @Inject(ZIBRI_DI_TOKENS.PASSWORD_RESET_TOKEN_EXPIRES_IN_MS)
        private readonly passwordResetTokenExpiresInMs: number,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
        private readonly emailService: EmailServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface
    ) {
        const accessTokenSecret: string | undefined = inject(ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET);
        if (!accessTokenSecret) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET, []);
        }
        const refreshTokenSecret: string | undefined = inject(ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET);
        if (!refreshTokenSecret) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET, []);
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

        this.accessTokenSecret = accessTokenSecret;
        this.refreshTokenSecret = refreshTokenSecret;
        this.confirmPasswordResetUrl = confirmPasswordResetUrl;
        this.PasswordResetEmail = PasswordResetEmail;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(app: ZibriApplication): void {
        if (!app.options.cronJobs.includes(JwtRefreshTokenCleanupCronJob)) {
            app.options.cronJobs.push(JwtRefreshTokenCleanupCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async login(credentials: JwtCredentialsDto): Promise<JwtAuthData<RoleType>> {
        try {
            const foundUser: UserType = await this.userService.findByEmail(credentials.email);
            const credentialsFound: JwtCredentials = await this.userService.resolveCredentialsFor(foundUser);
            const passwordMatched: boolean = await this.hashService.equal(credentials.password, credentialsFound.password);
            if (!passwordMatched) {
                throw new UnauthorizedError('Invalid email or password.');
            }
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
        catch {
            throw new UnauthorizedError('Invalid email or password.');
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async logout(data: OmitStrict<JwtRefreshLoginData, 'transaction'>): Promise<void> {
        try {
            const refreshToken: JwtRefreshToken | undefined = await this.refreshTokenRepository.findOne(
                { where: { value: data.refreshToken } },
                false
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
        const encoded: EncodedJwtAccessToken<string> | undefined = await JwtUtilities.verify(tokenValue, this.refreshTokenSecret);
        if (!encoded) {
            throw new UnauthorizedError('Error verifying token: Invalid Token');
        }
        const refreshToken: JwtRefreshToken | undefined = await this.refreshTokenRepository.findOne(
            { where: { value: tokenValue }, transaction },
            false
        );

        if (!refreshToken) {
            throw new UnauthorizedError('Error verifying token: Invalid Token');
        }
        if (refreshToken.blacklisted) {
            await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId }, { transaction });
            throw new UnauthorizedError('The given refresh token has already been used.');
        }
        if (new Date(refreshToken.expirationDate).getTime() <= Date.now()) {
            await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId }, { transaction });
            throw new UnauthorizedError('The given refresh token is expired.');
        }

        const user: UserType = await this.userService.findById(refreshToken.userId);
        const refreshTokenValue: string = await this.generateRefreshToken(user);

        const res: JwtRefreshToken = await this.createRefreshToken(user, refreshTokenValue, refreshToken.familyId, transaction);
        await this.refreshTokenRepository.updateById(refreshToken.id, { blacklisted: true }, { transaction });
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestPasswordReset(data: JwtRequestPasswordResetData<RoleType, UserType>): Promise<void> {
        if (await this.activePasswordResetTokenAlreadyExists(data.user, data.transaction)) {
            throw new TooManyRequestsError('A password reset has already been requested for this account.');
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
    async confirmPasswordReset(data: JwtConfirmPasswordResetData): Promise<void> {
        const resetToken: PasswordResetToken | undefined = await this.passwordResetTokenRepository.findOne(
            { where: { value: data.resetToken }, transaction: data.transaction },
            false
        );
        if (!resetToken) {
            throw new UnauthorizedError('Link invalid');
        }
        if (new Date(resetToken.expirationDate).getTime() <= Date.now()) {
            await this.passwordResetTokenRepository.deleteById(resetToken.id, { transaction: data.transaction });
            throw new UnauthorizedError('Link expired');
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<UserType | undefined> {
        const jwt: string | undefined = this.extractAccessTokenFromRequestContext(context);
        if (!jwt) {
            return undefined;
        }
        const data: EncodedJwtAccessToken<RoleType> | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecret);
        if (!data) {
            return undefined;
        }

        return await this.userService.findById<RoleType, UserType>(data.payload.id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isLoggedIn(context: HttpRequestContext | WebsocketRequestContext): Promise<boolean> {
        const jwt: string | undefined = this.extractAccessTokenFromRequestContext(context);
        if (!jwt) {
            return false;
        }
        const data: EncodedJwtAccessToken<RoleType> | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecret);
        return !!data;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async hasRole(context: HttpRequestContext | WebsocketRequestContext, allowedRoles: RoleType[]): Promise<boolean> {
        const jwt: string | undefined = this.extractAccessTokenFromRequestContext(context);
        if (!jwt) {
            return false;
        }
        const data: EncodedJwtAccessToken<RoleType> | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecret);
        if (!data) {
            return false;
        }
        return !!allowedRoles.find(r => data.payload.roles.includes(r));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async belongsTo<TargetEntity extends Newable<BaseEntity>>(
        context: HttpRequestContext | WebsocketRequestContext,
        targetEntity: TargetEntity,
        targetUserIdKey: keyof InstanceType<TargetEntity>,
        targetIdParamKey: string
    ): Promise<boolean> {
        const jwt: string | undefined = this.extractAccessTokenFromRequestContext(context);
        if (!jwt) {
            return false;
        }
        const jwtData: EncodedJwtAccessToken<RoleType> | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecret);
        if (!jwtData) {
            return false;
        }
        try {
            const repo: RepositoryTypeForEntity<InstanceType<TargetEntity>> = inject(repositoryTokenFor(targetEntity));
            const targetId: string | undefined = context.request.params?.[targetIdParamKey];
            if (targetId == undefined) {
                throw new Error(`Could not find the target id specified as path param "${targetId}"`);
            }
            const foundTarget: InstanceType<TargetEntity> = await repo.findById(targetId) as InstanceType<TargetEntity>;
            const userIdProperty: unknown = foundTarget[targetUserIdKey];
            if (Array.isArray(userIdProperty)) {
                return userIdProperty.includes(jwtData.payload.id);
            }
            return userIdProperty === jwtData.payload.id;
        }
        catch {
            return false;
        }
    }

    private extractAccessTokenFromRequestContext(
        context: HttpRequestContext | WebsocketRequestContext
    ): string | undefined {
        const authHeader: string | string[] | undefined = context.request.headers.authorization;
        if (authHeader == undefined || typeof authHeader !== 'string') {
            return undefined;
        }
        const parts: string[] = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return undefined;
        }
        return parts[1];
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
                this.accessTokenSecret,
                { expiresIn: this.accessTokenExpiresInMs / Ms.SECOND }
            );
        }
        catch (error) {
            throw new UnauthorizedError('Error generating token', { cause: error });
        }
    }

    private async generateRefreshToken(user: UserType): Promise<string> {
        const payload: JwtRefreshTokenPayload<RoleType, UserType> = {
            userId: user.id
        };

        return await JwtUtilities.sign(payload, this.refreshTokenSecret, {
            expiresIn: this.refreshTokenExpiresInMs / Ms.SECOND,
            issuer: GlobalRegistry.getAppData('name'),
            jwtid: UUIDUtilities.generate()
        });
    }
}