import { Repository } from '../../data-source';
import { Inject, InjectRepository, ZIBRI_DI_TOKENS } from '../../di';
import { Property } from '../../entity';
import { Response } from '../../open-api';
import { Body, Controller, Post } from '../../routing';
import { AuthControllerInterface } from '../auth-controller.interface';
import { type AuthServiceInterface } from '../auth-service.interface';
import { BaseUser, PasswordResetToken } from '../models';
import { type UserServiceInterface } from '../user-service.interface';
import { JwtAuthData } from './jwt-auth-data.model';
import { JwtConfirmPasswordResetData } from './jwt-confirm-password-reset-data.model';
import { JwtCredentialsDto } from './jwt-credentials.model';
import { JwtRefreshLoginData } from './jwt-refresh-login-data.model';
import { JwtRefreshToken } from './jwt-refresh-token.model';
import { JwtAuthStrategy } from './jwt.auth-strategy';

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

@Controller('/auth')
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
        @InjectRepository(JwtRefreshToken)
        private readonly refreshTokenRepository: Repository<JwtRefreshToken>,
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
    async confirmPasswordReset(data: JwtConfirmPasswordResetData): Promise<void> {
        await this.authService.confirmPasswordReset(JwtAuthStrategy, data);
    }

    @Response.empty()
    @Post('/logout')
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
}