import { randomBytes } from 'node:crypto';

import { HiBase32Utilities } from './hi-base32.utilities';
import { Repository } from '../../../../data-source';
import { inject, Inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../../../../di';
import { UnauthorizedError } from '../../../../error-handling';
import { HttpRequest, KnownHeader } from '../../../../http';
import { validateEntitiesRegistered } from '../../../../utilities';
import { WebsocketRequest } from '../../../../websocket';
import { BaseUser } from '../../../models';
import { TwoFactorMethod } from '../two-factor-method.interface';
import { OtpCredentials, OtpCredentialsCreateData } from './otp-credentials.model';
import { OtpUtilities } from './otp.utilities';

/**
 * The data for confirming the registration of the otp two factor method.
 */
export type OtpConfirmRegisterData = {
    /**
     * The token to validate.
     */
    token: string
};

/**
 * One Time Password Two Factor Method.
 */
export class OtpTwoFactorMethod implements TwoFactorMethod<never, OtpConfirmRegisterData> {

    private get otpCredentialsRepository(): Repository<OtpCredentials, OtpCredentialsCreateData> {
        return inject(repositoryTokenFor(OtpCredentials));
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.OTP_HEADER)
        private readonly otpHeader: KnownHeader,
        @Inject(ZIBRI_DI_TOKENS.OTP_LENGTH)
        private readonly otpLength: number
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(): void {
        if (this.otpHeader == undefined) {
            throw new Error('No value provided for ZIBRI_DI_TOKENS.OTP_HEADER');
        }
        if (this.otpLength == undefined) {
            throw new Error('No value provided for ZIBRI_DI_TOKENS.OTP_LENGTH');
        }

        validateEntitiesRegistered(this.constructor.name, OtpCredentials);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestRegisterForUser<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType
    ): Promise<void> {
        const secret: string = this.generateSecret();
        const qrCodeUrl: string = OtpUtilities.createQrCodeUrl(secret);
        await this.otpCredentialsRepository.create({ secret, qrCodeUrl, userId: user.id });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmRegisterForUser<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        data: OtpConfirmRegisterData
    ): Promise<void> {
        const credentials: OtpCredentials[] = await this.otpCredentialsRepository.findAll({ where: { userId: user.id } });
        for (const c of credentials) {
            if (OtpUtilities.validate(c.secret, data.token)) {
                await this.otpCredentialsRepository.updateById(c.id, { confirmed: true });
                return;
            }
        }

        throw new UnauthorizedError('The provided two factor code is invalid.');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unregisterForUser<Role extends string, UserType extends BaseUser<Role>>(user: UserType): Promise<void> {
        await this.otpCredentialsRepository.deleteAll({ userId: user.id });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validate<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        request: HttpRequest | WebsocketRequest
    ): Promise<void> {
        const credentials: OtpCredentials[] = await this.otpCredentialsRepository.findAll({ where: { userId: user.id } });
        const token: string = this.extractTokenFromRequest(request);
        for (const c of credentials) {
            if (OtpUtilities.validate(c.secret, token)) {
                return;
            }
        }
        throw new UnauthorizedError('The provided two factor code is invalid.');
    }

    private extractTokenFromRequest(request: HttpRequest | WebsocketRequest): string {
        const code: string | undefined = request.headers[this.otpHeader];
        if (!code) {
            throw new UnauthorizedError(`"${this.otpHeader}" header not found`);
        }
        if (code.length !== this.otpLength) {
            throw new UnauthorizedError(`The provided two factor code is not ${this.otpLength} digits long.`);
        }
        return code;
    }

    private generateSecret(): string {
        const buffer: Buffer = randomBytes(15);
        const base32: string = HiBase32Utilities
            .encode(buffer)
            .replaceAll('=', '')
            .substring(0, 24);
        return base32;
    }
}