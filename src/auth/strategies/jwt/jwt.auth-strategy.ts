import { randomBytes } from 'crypto';

import { SecuritySchemeObject } from 'openapi3-ts/oas31';

import { EncodedJwtAccessToken } from './encoded-jwt-access-token.model';
import { JwtAccessTokenPayload } from './jwt-access-token-payload.model';
import { JwtAuthData } from './jwt-auth-data.model';
import { JwtConfirmPasswordResetData } from './jwt-confirm-password-reset-data.model';
import { JwtCredentials, JwtCredentialsDto } from './jwt-credentials.model';
import { JwtRefreshLoginData } from './jwt-refresh-login-data.model';
import { JwtRefreshTokenPayload } from './jwt-refresh-token-payload.model';
import { JwtRefreshToken, JwtRefreshTokenCreateDto } from './jwt-refresh-token.model';
import { JwtRequestPasswordResetData } from './jwt-request-password-reset-data.model';
import { JwtUtilities } from './jwt.utilities';
import { Repository } from '../../../data-source';
import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../../../di';
import { EmailPriority, EmailServiceInterface } from '../../../email';
import { BaseEntity } from '../../../entity';
import { TooManyRequestsError, UnauthorizedError } from '../../../error-handling';
import { GlobalRegistry } from '../../../global';
import { renderEmailTemplate } from '../../../handlebars';
import { HttpRequest } from '../../../http';
import { Newable } from '../../../types';
import { Ms, UUIDUtilities, validateEntitiesRegistered } from '../../../utilities';
import { WebsocketRequest } from '../../../websocket';
import { HashUtilities } from '../../hash.utilities';
import { BaseUser, PasswordResetToken, PasswordResetTokenCreateData } from '../../models';
import { UserServiceInterface, NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE } from '../../user';
import { AuthStrategyInterface } from '../auth-strategy.interface';

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
    JwtRefreshLoginData
> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'jwt';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly securityScheme: SecuritySchemeObject = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token in the format `Bearer <token>`'
    };

    private readonly accessTokenSecret: string;
    private readonly accessTokenExpiresInMs: number;
    private readonly refreshTokenSecret: string;
    private readonly refreshTokenExpiresInMs: number;
    private readonly passwordResetTokenExpiresInMs: number;
    private readonly userService: UserServiceInterface;
    private readonly emailService: EmailServiceInterface;
    private readonly confirmPasswordResetUrl: string;

    private get refreshTokenRepository(): Repository<JwtRefreshToken> {
        return inject(repositoryTokenFor(JwtRefreshToken));
    }

    private get passwordResetTokenRepository(): Repository<PasswordResetToken, PasswordResetTokenCreateData> {
        return inject(repositoryTokenFor(PasswordResetToken));
    }

    private get credentialsRepository(): Repository<JwtCredentials> {
        return inject(repositoryTokenFor(JwtCredentials));
    }

    constructor() {
        this.accessTokenSecret = inject(ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET);
        this.accessTokenExpiresInMs = inject(ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_EXPIRES_IN_MS);
        this.refreshTokenSecret = inject(ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET);
        this.refreshTokenExpiresInMs = inject(ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_EXPIRES_IN_MS);
        this.passwordResetTokenExpiresInMs = inject(ZIBRI_DI_TOKENS.JWT_PASSWORD_RESET_TOKEN_EXPIRES_IN_MS);
        this.userService = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
        this.emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        this.confirmPasswordResetUrl = inject(ZIBRI_DI_TOKENS.JWT_CONFIRM_PASSWORD_RESET_URL);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(): void {
        if (!this.accessTokenSecret) {
            throw new Error('No value provided for ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET');
        }
        if (!this.refreshTokenSecret) {
            throw new Error('No value provided for ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET');
        }
        if (!this.confirmPasswordResetUrl) {
            throw new Error('No value provided for ZIBRI_DI_TOKENS.JWT_CONFIRM_PASSWORD_RESET_URL');
        }
        if (!GlobalRegistry.userRepositories.length) {
            throw new Error(NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE);
        }

        validateEntitiesRegistered(this.constructor.name, JwtRefreshToken, JwtCredentials, PasswordResetToken);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async login(credentials: JwtCredentialsDto): Promise<JwtAuthData<RoleType>> {
        try {
            const foundUser: UserType = await this.userService.findByEmail(credentials.email);
            const credentialsFound: JwtCredentials = await this.userService.resolveCredentialsFor(foundUser);
            const passwordMatched: boolean = await HashUtilities.equal(credentials.password, credentialsFound.password);
            if (!passwordMatched) {
                throw new UnauthorizedError('Invalid email or password.');
            }
            const accessTokenValue: string = await this.generateAccessToken(foundUser);
            const refreshTokenValue: string = await this.generateRefreshToken(foundUser);
            await this.createRefreshToken(foundUser, refreshTokenValue);

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
    async logout(data: JwtRefreshLoginData): Promise<void> {
        try {
            const refreshToken: JwtRefreshToken | undefined
                = await this.refreshTokenRepository.findOne({ where: { value: data.refreshToken } }, false);
            if (!refreshToken) {
                return;
            }
            await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId });
        }
        catch {
            // ignore
        }
    }

    private async createRefreshToken(foundUser: UserType, refreshTokenValue: string): Promise<JwtRefreshToken> {
        const data: JwtRefreshTokenCreateDto = {
            userId: foundUser.id,
            value: refreshTokenValue,
            familyId: UUIDUtilities.generate(),
            blacklisted: false,
            expirationDate: new Date(Date.now() + this.refreshTokenExpiresInMs)
        };
        return await this.refreshTokenRepository.create(data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async refreshLogin(data: JwtRefreshLoginData): Promise<JwtAuthData<RoleType>> {
        const refreshToken: JwtRefreshToken = await this.verifyAndResolveRefreshToken(data.refreshToken);
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

    private async verifyAndResolveRefreshToken(tokenValue: string): Promise<JwtRefreshToken> {
        await JwtUtilities.verify(tokenValue, this.refreshTokenSecret);
        const refreshToken: JwtRefreshToken | undefined = await this.refreshTokenRepository.findOne(
            { where: { value: tokenValue } },
            false
        );

        if (!refreshToken) {
            throw new UnauthorizedError('Error verifying token: Invalid Token');
        }
        if (refreshToken.blacklisted) {
            await this.refreshTokenRepository.deleteAll({ familyId: refreshToken.familyId });
            throw new UnauthorizedError('The given refresh token has already been used.');
        }

        if (!this.isRefreshTokenExpired(refreshToken)) {
            return refreshToken;
        }

        const user: UserType = await this.userService.findById(refreshToken.userId);
        const refreshTokenValue: string = await this.generateRefreshToken(user);

        const res: JwtRefreshToken = await this.createRefreshToken(user, refreshTokenValue);
        await this.refreshTokenRepository.updateById(refreshToken.id, { blacklisted: true });
        await this.refreshTokenRepository.deleteAll({ expirationDate: { before: new Date() } });
        return res;
    }

    private isRefreshTokenExpired(refreshToken: JwtRefreshToken): boolean {
        const createdAt: Date = new Date(new Date(refreshToken.expirationDate).getTime() - this.refreshTokenExpiresInMs);
        const refreshTokenLifeTimeInMs: number = Date.now() - createdAt.getTime();
        return refreshTokenLifeTimeInMs > this.refreshTokenExpiresInMs;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestPasswordReset(data: JwtRequestPasswordResetData<RoleType, UserType>): Promise<void> {
        if (await this.activePasswordResetTokenAlreadyExists(data.user)) {
            throw new TooManyRequestsError('A password reset has already been requested for this account.');
        }

        const resetTokenData: PasswordResetTokenCreateData = {
            value: randomBytes(16).toString('hex'),
            userId: data.user.id,
            expirationDate: new Date(Date.now() + this.passwordResetTokenExpiresInMs)
        };
        const resetToken: PasswordResetToken = await this.passwordResetTokenRepository.create(resetTokenData);

        await this.emailService.queue({
            recipients: [data.user.email],
            subject: 'Password Reset',
            html: await renderEmailTemplate(
                'password-reset.hbs',
                {
                    user: data.user,
                    confirmPasswordResetUrl: data.emailData?.confirmPasswordResetUrl ?? this.confirmPasswordResetUrl,
                    resetToken,
                    base: {
                        title: 'Password Reset'
                    }
                }
            ),
            priority: EmailPriority.HIGH,
            ...data
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPasswordReset(data: JwtConfirmPasswordResetData): Promise<void> {
        // eslint-disable-next-line stylistic/max-len
        const resetToken: PasswordResetToken | undefined = await this.passwordResetTokenRepository.findOne({ where: { value: data.resetToken } }, false);
        if (!resetToken) {
            throw new UnauthorizedError('Link invalid');
        }
        if (new Date(resetToken.expirationDate).getTime() <= Date.now()) {
            await this.passwordResetTokenRepository.deleteById(resetToken.id);
            throw new UnauthorizedError('Link expired');
        }

        const user: UserType = await this.userService.findById(resetToken.userId);
        const credentials: JwtCredentials = await this.userService.resolveCredentialsFor(user);
        const hashedPassword: string = await HashUtilities.hash(data.newPassword);
        credentials.password = hashedPassword;

        await this.credentialsRepository.updateById(credentials.id, credentials);
        await this.passwordResetTokenRepository.deleteById(resetToken.id);
        await this.refreshTokenRepository.deleteAll({ userId: resetToken.userId });
        // TODO: set require password change to false
    }

    private async activePasswordResetTokenAlreadyExists(user: BaseUser<RoleType>): Promise<boolean> {
        const existingToken: PasswordResetToken | undefined = await this.passwordResetTokenRepository.findOne(
            { where: { userId: user.id } },
            false
        );
        if (existingToken) {
            if (new Date(existingToken.expirationDate).getTime() > Date.now()) {
                return true;
            }
            await this.passwordResetTokenRepository.deleteById(existingToken.id);
        }
        return false;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUser(request: HttpRequest | WebsocketRequest): Promise<UserType | undefined> {
        const jwt: string | undefined = this.extractAccessTokenFromRequest(request);
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
    async isLoggedIn(request: HttpRequest | WebsocketRequest): Promise<boolean> {
        const jwt: string | undefined = this.extractAccessTokenFromRequest(request);
        if (!jwt) {
            return false;
        }
        const data: EncodedJwtAccessToken<RoleType> | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecret);
        return !!data;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async hasRole(request: HttpRequest | WebsocketRequest, allowedRoles: RoleType[]): Promise<boolean> {
        const jwt: string | undefined = this.extractAccessTokenFromRequest(request);
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
        request: HttpRequest | WebsocketRequest,
        targetEntity: TargetEntity,
        targetUserIdKey: keyof InstanceType<TargetEntity>,
        targetIdParamKey: string
    ): Promise<boolean> {
        const jwt: string | undefined = this.extractAccessTokenFromRequest(request);
        if (!jwt) {
            return false;
        }
        const jwtData: EncodedJwtAccessToken<RoleType> | undefined = await JwtUtilities.verify(jwt, this.accessTokenSecret);
        if (!jwtData) {
            return false;
        }
        try {
            const repo: Repository<InstanceType<TargetEntity>> = inject(repositoryTokenFor(targetEntity));
            const targetId: string | undefined = request.params?.[targetIdParamKey];
            if (targetId == undefined) {
                throw new Error(`Could not find the target id specified as path param "${targetId}"`);
            }
            const foundTarget: InstanceType<TargetEntity> = await repo.findById(targetId);
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

    private extractAccessTokenFromRequest(
        request: HttpRequest | WebsocketRequest
    ): string | undefined {
        const authHeader: string | string[] | undefined = request.headers.Authorization;
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
            issuer: GlobalRegistry.getAppData('name')
        });
    }
}