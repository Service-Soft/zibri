import { Property } from '../../entity/decorators/property.decorator';
import { type LocaleCode } from '../../localization/models/locale-code.model';

/**
 * What accepting an invitation is sent with.
 */
export class AcceptInvitationInput {
    /**
     * The token from the link.
     */
    @Property.string()
    token!: string;

    /**
     * The password of the account the invitation creates. Only for an email without an account of its own, which
     * `requiresLogin` of `InvitationTokenValidity` tells apart.
     */
    @Property.string({ required: false })
    password?: string;

    /**
     * The locale of the account the invitation creates, one the application supports, such as the language the
     * user picked on the page accepting it. Defaults to the locale the invitation was sent in.
     */
    @Property.string({ required: false })
    locale?: LocaleCode;
}