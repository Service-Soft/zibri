import { JwtAuthData } from './jwt-auth-data.model';
import { JwtConfirmPasswordResetData } from './jwt-confirm-password-reset-data.model';
import { JwtCredentialsDto } from './jwt-credentials.model';
import { JwtRefreshLoginData } from './jwt-refresh-login-data.model';
import { JwtAuthStrategy } from './jwt.auth-strategy';
import { Repository } from '../../../data-source/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { Property } from '../../../entity/decorators/property.decorator';
import { Response } from '../../../open-api/decorators/response.decorator';
import { PreactEmailComponent } from '../../../preact/preact-email-component.model';
import { Body } from '../../../routing/decorators/body.decorator';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { AuthControllerInterface } from '../../auth-controller.interface';
import { type AuthServiceInterface } from '../../auth-service.interface';
import { BaseUser } from '../../models/base-user.model';
import { PasswordResetToken } from '../../models/password-reset-token.model';
import { type UserServiceInterface } from '../../user/user-service.interface';

/**
 * Properties of a password reset email.
 */
type PasswordResetEmailTemplateProps<Role extends string, UserType extends BaseUser<Role>> = {
    confirmPasswordResetLink: string,
    user: UserType
};

/**
 * Definition for a password reset email template.
 */
export type PasswordResetEmailTemplate<
    Role extends string, UserType extends BaseUser<Role>
> = PreactEmailComponent<PasswordResetEmailTemplateProps<Role, UserType>>;

class JwtRequestPasswordResetInput {
    @Property.string({ format: 'email' })
    email!: string;
}

class JwtVerifyPasswordResetTokenInput {
    @Property.string()
    resetToken!: string;
}

class JwtVerifyPasswordResetTokenResponse {
    @Property.boolean()
    isValid!: boolean;
}

@Controller('/auth', { allowOrphan: true })
export class JwtAuthController implements AuthControllerInterface<
    JwtCredentialsDto,
    JwtAuthData<string>,
    JwtRefreshLoginData,
    JwtRequestPasswordResetInput,
    JwtConfirmPasswordResetData
> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface,
        @InjectRepository(PasswordResetToken)
        private readonly passwordResetTokenRepository: Repository<PasswordResetToken>
    ) {}

    @Response.object(JwtAuthData)
    @Post('/login')
    async login(
        @Body(JwtCredentialsDto)
        credentials: JwtCredentialsDto
    ): Promise<JwtAuthData<string>> {
        return await this.authService.login(JwtAuthStrategy, credentials);
    }

    @Response.object(JwtAuthData)
    @Post('/refresh-login')
    async refreshLogin(
        @Body(JwtRefreshLoginData)
        data: JwtRefreshLoginData
    ): Promise<JwtAuthData<string>> {
        return await this.authService.refreshLogin(JwtAuthStrategy, data);
    }

    @Response.empty()
    @Post('/request-password-reset')
    async requestPasswordReset(
        @Body(JwtRequestPasswordResetInput)
        data: JwtRequestPasswordResetInput
    ): Promise<void> {
        const user: BaseUser<string> = await this.userService.findByEmail(data.email);
        await this.authService.requestPasswordReset(JwtAuthStrategy, { user });
    }

    @Response.object(JwtVerifyPasswordResetTokenResponse)
    @Post('/verify-password-reset-token')
    async verifyResetToken(
        @Body(JwtVerifyPasswordResetTokenInput)
        input: JwtVerifyPasswordResetTokenInput
    ): Promise<JwtVerifyPasswordResetTokenResponse> {
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
        @Body(JwtConfirmPasswordResetData)
        data: JwtConfirmPasswordResetData
    ): Promise<void> {
        await this.authService.confirmPasswordReset(JwtAuthStrategy, data);
    }

    @Response.empty()
    @Post('/logout')
    async logout(
        @Body(JwtRefreshLoginData)
        data: JwtRefreshLoginData
    ): Promise<void> {
        await this.authService.logout(JwtAuthStrategy, data);
    }
}