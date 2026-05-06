import { CookieAuthConfirmPasswordResetData } from './cookie-auth-confirm-password-reset-data.model';
import { CookieAuthCredentialsDto } from './cookie-auth-credentials.model';
import { CookieAuthData } from './cookie-auth-data.model';
import { CookieAuthLogoutData } from './cookie-auth-logout-data.model';
import { CookieAuthRefreshLoginData } from './cookie-auth-refresh-login-data.model';
import { CookieAuthStrategy } from './cookie-auth.auth-strategy';
import { IsolationLevel } from '../../../data-source/data-sources/data-source.interface';
import { Repository } from '../../../data-source/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import { Response } from '../../../open-api/decorators/response.decorator';
import { Body } from '../../../routing/decorators/body.decorator';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { AuthControllerInterface } from '../../auth-controller.interface';
import { type AuthServiceInterface } from '../../auth-service.interface';
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

@Controller('/auth', { allowOrphan: true })
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
        @InjectRepository(PasswordResetToken)
        private readonly passwordResetTokenRepository: Repository<PasswordResetToken>
    ) {}

    @Response.object(CookieAuthData)
    @Post('/login')
    async login(
        @Body(CookieAuthCredentialsDto)
        credentials: CookieAuthCredentialsDto
    ): Promise<CookieAuthData<string>> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource.startTransaction(IsolationLevel.READ_COMMITTED);
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
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource.startTransaction(IsolationLevel.READ_COMMITTED);
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

    @Response.empty()
    @Post('/request-password-reset')
    async requestPasswordReset(
        @Body(CookieAuthRequestPasswordResetInput)
        data: CookieAuthRequestPasswordResetInput
    ): Promise<void> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource.startTransaction(IsolationLevel.READ_COMMITTED);
        try {
            const user: BaseUser<string> = await this.userService.findByEmail(data.email);
            await this.authService.requestPasswordReset(CookieAuthStrategy, { user, transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    @Response.object(CookieAuthVerifyPasswordResetTokenResponse)
    @Post('/verify-password-reset-token')
    async verifyResetToken(
        @Body(CookieAuthVerifyPasswordResetTokenInput)
        input: CookieAuthVerifyPasswordResetTokenInput
    ): Promise<CookieAuthVerifyPasswordResetTokenResponse> {
        const resetToken: PasswordResetToken | undefined
            = await this.passwordResetTokenRepository.findOne({ where: { value: input.resetToken } }, false);
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

    @Response.empty()
    @Post('/confirm-password-reset')
    async confirmPasswordReset(
        @Body(CookieAuthConfirmPasswordResetDto)
        data: CookieAuthConfirmPasswordResetDto
    ): Promise<void> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource.startTransaction(IsolationLevel.READ_COMMITTED);
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
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource.startTransaction(IsolationLevel.READ_COMMITTED);
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