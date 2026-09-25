import { JwtAuthData } from './jwt-auth-data.model';
import { JwtConfirmPasswordResetData } from './jwt-confirm-password-reset-data.model';
import { JwtCredentialsDto } from './jwt-credentials.model';
import { JwtRefreshLoginData } from './jwt-refresh-login-data.model';
import { JwtAuthStrategy } from './jwt.auth-strategy';
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
import { TsxEmailComponent } from '../../../tsx/tsx-email-component.model';
import { AuthControllerInterface } from '../../auth-controller.interface';
import { type AuthServiceInterface } from '../../auth-service.interface';
import { Auth } from '../../decorators/auth.decorator';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';
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
> = TsxEmailComponent<PasswordResetEmailTemplateProps<Role, UserType>>;

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

class JwtConfirmPasswordResetDto extends OmitClass(JwtConfirmPasswordResetData, ['transaction']) {}

class JwtRefreshLoginDto extends OmitClass(JwtRefreshLoginData, ['transaction']) {}

// unauthenticated by necessity - these are the routes a caller uses to *become* authenticated, so
// they have to stay reachable whichever `defaultAuth` the application declared. `allowRedundant`
// because a controller that ships with the framework cannot know which one that was, and being
// warned for stating its own posture would leave it no way to be correct.
@Auth.skip({ allowRedundant: true })
@Controller('/auth', { allowOrphan: true, versions: 'all' })
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
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface,
        @InjectRepository(PasswordResetToken)
        private readonly passwordResetTokenRepository: Repository<PasswordResetToken>
    ) {}

    // the endpoints anyone may call without being anybody yet. A password is the one secret here
    // short enough to guess, and checking one costs a deliberately slow hash - so unlimited attempts
    // are both a way in and a way to keep the event loop busy.
    //
    // One budget across all of them, spent per caller: a person who mistypes a password twice and
    // then asks for a reset stays well inside it, while an attacker gets a handful of guesses per
    // window from each address they can send from.
    @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
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
        @Body(JwtRefreshLoginDto)
        data: JwtRefreshLoginDto
    ): Promise<JwtAuthData<string>> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource
            .startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
        try {
            const res: JwtAuthData<string> = await this.authService.refreshLogin(JwtAuthStrategy, { ...data, transaction });
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
        @Body(JwtRequestPasswordResetInput)
        data: JwtRequestPasswordResetInput
    ): Promise<void> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource
            .startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
        try {
            // an address nobody has registered gets the same answer as one somebody has. This route
            // is unauthenticated, so anything that distinguishes the two turns it into a list of who
            // holds an account here - and the caller is not entitled to that either way.
            const user: BaseUser<string> | undefined = await this.userService.findByEmail(data.email, { required: false });
            if (user) {
                await this.authService.requestPasswordReset(JwtAuthStrategy, { user, transaction });
            }
            await transaction.commit();

            // after the commit, so the outcome describes what happened rather than what was about to
            // be attempted. Recorded here rather than in the service because here is the only place a
            // request for an address nobody holds is still visible - the strategy is handed a
            // resolved user, so by then those have been filtered out. They are the ones worth seeing:
            // the reply is identical either way, so a run against a list of addresses leaves no other
            // trace anywhere.
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
    @Response.object(JwtVerifyPasswordResetTokenResponse)
    @Post('/verify-password-reset-token')
    async verifyResetToken(
        @Body(JwtVerifyPasswordResetTokenInput)
        input: JwtVerifyPasswordResetTokenInput
    ): Promise<JwtVerifyPasswordResetTokenResponse> {
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
        @Body(JwtConfirmPasswordResetDto)
        data: JwtConfirmPasswordResetDto
    ): Promise<void> {
        const transaction: Transaction = await this.passwordResetTokenRepository.dataSource
            .startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
        try {
            await this.authService.confirmPasswordReset(JwtAuthStrategy, { ...data, transaction });
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
        @Body(JwtRefreshLoginDto)
        data: JwtRefreshLoginDto
    ): Promise<void> {
        await this.authService.logout(JwtAuthStrategy, data);
    }
}