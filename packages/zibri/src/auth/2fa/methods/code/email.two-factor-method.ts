import { CodeTwoFactorMethod } from './code.two-factor-method';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { EmailPriority } from '../../../../email/models/email-priority.enum';
import { $ts } from '../../../../localization/translate.function';
import { Newable } from '../../../../types/newable.type';
import { Ms } from '../../../../utilities/ms';
import { BaseUser } from '../../../models/base-user.model';
import { NoRegisterData } from '../no-register-data.model';

/**
 * A code sent to the email address of the user as the second factor.
 *
 * The `2fa/start` route of `AuthController` asks for it with `startSecondFactor`, and the user sends it
 * back in the `x-authorization-email-code` header of the guarded request. To change what the email
 * says, extend this class and override `deliver`.
 *
 * Enrolling needs no input: the code goes to the address of the account, and the enrollment counts
 * once the user has entered it. Anyone who can read that mailbox can pass this second factor, so it
 * protects an account against a stolen password, not against a stolen mailbox.
 */
export class EmailTwoFactorMethod extends CodeTwoFactorMethod<void> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly channel: string = 'email';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly requestRegisterModel: Newable<void> = NoRegisterData;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async deliver(user: BaseUser<string>, _destination: string | undefined, code: string): Promise<void> {
        const minutes: number = Math.round(this.resolveOptions().expiresInMs / Ms.MINUTE);
        const text: string = $ts`Your verification code is ${code}. It is valid for ${minutes} minutes.`;
        await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).queue({
            recipients: [user.email],
            subject: $ts`Your verification code`,
            html: `<p>${text}</p>`,
            userId: user.id,
            priority: EmailPriority.HIGH
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected resolveDestination(): undefined {
        return undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected resolveHeader(): string {
        return inject(ZIBRI_DI_TOKENS.EMAIL_CODE_HEADER);
    }
}