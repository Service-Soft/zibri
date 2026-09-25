import { CookieAuthConfirmPasswordResetData } from './cookie-auth-confirm-password-reset-data.model';
import { CookieAuthCredentialsDto } from './cookie-auth-credentials.model';
import { CookieAuthData } from './cookie-auth-data.model';
import { CookieAuthLogoutData } from './cookie-auth-logout-data.model';
import { CookieAuthRefreshLoginData } from './cookie-auth-refresh-login-data.model';
import { CookieAuthStrategy } from './cookie-auth.auth-strategy';
import { IsolationLevel } from '../../../data-source/data-sources/data-source.interface';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import { AuditAction, AuditOutcome, AuditReason } from '../../../logging/audit-event.model';
import { auditReasonFor } from '../../../logging/audit-reason-for.function';
import { Response } from '../../../open-api/decorators/response.decorator';
import { RateLimited } from '../../../rate-limiting/decorators/rate-limited.decorator';
import { Body } from '../../../routing/decorators/body.decorator';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { AuthControllerInterface } from '../../auth-controller.interface';
import { type AuthServiceInterface } from '../../auth-service.interface';
import { Auth } from '../../decorators/auth.decorator';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';
import { BaseUser } from '../../models/base-user.model';
import { PasswordResetToken } from '../../models/password-reset-token.model';
import { type UserServiceInterface } from '../../user/user-service.interface';

class CookieAuthRequestPasswordResetInput {
    @Property.string({ format: 'email' })
    email!: string;
}

class CookieAuthVerifyPasswordResetTokenInput {
    @Property.string()
    resetToken!: string;
}

class CookieAuthVerifyPasswordResetTokenResponse {
    @Property.boolean()
    isValid!: boolean;
}

class CookieAuthConfirmPasswordResetDto extends OmitClass(CookieAuthConfirmPasswordResetData, ['transaction']) {}

class CookieAuthRefreshLoginDto extends OmitClass(CookieAuthRefreshLoginData, ['transaction']) {}

class CookieAuthLogoutDto extends OmitClass(CookieAuthLogoutData, ['transaction']) {}

// unauthenticated by necessity, and redundant on purpose - see the same note on JwtAuthController
@Auth.skip({ allowRedundant: true })
@Controller('/auth', { allowOrphan: true, versions: 'all' })
export class CookieAuthController implements AuthControllerInterface<
    CookieAuthCredentialsDto,
    CookieAuthData<string>,
    CookieAuthRefreshLoginData,
    CookieAuthRequestPasswordResetInput,
    CookieAuthConfirmPasswordResetData
> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface,
        @InjectRepository(PasswordResetToken)
        private readonly passwordResetTokenRepository: Repository<PasswordResetToken>
    ) {}

    // the same budget the jwt controller spends, and for the same reason: these are the endpoints a
    // caller may use before being anybody, and a password is the one secret short enough to guess
    @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
    @Response.object(CookieAuthData)
    @Post('/login')
    async login(
        @Body(CookieAuthCredentialsDto)
        credentials: CookieAuthCredentialsDto
    ): Promise<CookieAuthData<string>> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource
            .startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
        try {
            const res: CookieAuthData<string> = await this.authService.login(CookieAuthStrategy, { ...credentials, transaction });
            await transaction.commit();
            return res;
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    @Response.object(CookieAuthData)
    @Post('/refresh-login')
    async refreshLogin(
        @Body(CookieAuthRefreshLoginDto)
        data: CookieAuthRefreshLoginDto
    ): Promise<CookieAuthData<string>> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource
            .startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
        try {
            const res: CookieAuthData<string> = await this.authService.refreshLogin(CookieAuthStrategy, { ...data, transaction });
            await transaction.commit();
            return res;
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
    @Response.empty()
    @Post('/request-password-reset')
    async requestPasswordReset(
        @Body(CookieAuthRequestPasswordResetInput)
        data: CookieAuthRequestPasswordResetInput
    ): Promise<void> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource
            .startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
        try {
            // the same answer whether or not the address is registered - see the note on the jwt
            // controller's version
            const user: BaseUser<string> | undefined = await this.userService.findByEmail(data.email, { required: false });
            if (user) {
                await this.authService.requestPasswordReset(CookieAuthStrategy, { user, transaction });
            }
            await transaction.commit();

            // see the note on the jwt controller: after the commit, and for every request rather than
            // only the ones naming a real account
            inject(ZIBRI_DI_TOKENS.LOGGER).audit({
                action: AuditAction.PASSWORD_RESET_REQUESTED,
                outcome: user ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
                reason: user ? undefined : AuditReason.NO_SUCH_SUBJECT,
                subject: data.email,
                userId: user?.id
            });
        }
        catch (error) {
            await transaction.rollback();
            inject(ZIBRI_DI_TOKENS.LOGGER).audit({
                action: AuditAction.PASSWORD_RESET_REQUESTED,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                subject: data.email
            });
            throw error;
        }
    }

    @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
    @Response.object(CookieAuthVerifyPasswordResetTokenResponse)
    @Post('/verify-password-reset-token')
    async verifyResetToken(
        @Body(CookieAuthVerifyPasswordResetTokenInput)
        input: CookieAuthVerifyPasswordResetTokenInput
    ): Promise<CookieAuthVerifyPasswordResetTokenResponse> {
        // hashed to be searched for, because that is how it is stored
        const value: HashString = await this.hashService.hash(input.resetToken, { strategy: Sha256HashStrategy });
        const resetToken: PasswordResetToken | undefined
            = await this.passwordResetTokenRepository.findOne({ where: { value }, required: false });
        if (!resetToken) {
            return {
                isValid: false
            };
        }
        if (new Date(resetToken.expirationDate).getTime() <= Date.now()) {
            await this.passwordResetTokenRepository.deleteById(resetToken.id);
            return {
                isValid: false
            };
        }
        try {
            await this.userService.findById(resetToken.userId);
            return {
                isValid: true
            };
        }
        catch {
            return {
                isValid: false
            };
        }
    }

    @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
    @Response.empty()
    @Post('/confirm-password-reset')
    async confirmPasswordReset(
        @Body(CookieAuthConfirmPasswordResetDto)
        data: CookieAuthConfirmPasswordResetDto
    ): Promise<void> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource
            .startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
        try {
            await this.authService.confirmPasswordReset(CookieAuthStrategy, { ...data, transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    @Response.empty()
    @Post('/logout')
    async logout(
        @Body(CookieAuthLogoutDto)
        data: CookieAuthLogoutDto
    ): Promise<void> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource
            .startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
        try {
            await this.authService.logout(CookieAuthStrategy, { ...data, transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }
}