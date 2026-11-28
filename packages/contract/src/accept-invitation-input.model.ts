import { LocaleCode } from './locale-code.type';

/**
 * What `POST /accept-invitation` takes.
 */
export type AcceptInvitationInput = {
    /**
     * The token from the link.
     */
    token: string,
    /**
     * The password of the account the invitation creates, when `requiresLogin` of the token's validity is false.
     */
    password?: string,
    /**
     * The locale of the account the invitation creates, one the application supports, such as `de`. Defaults to the
     * locale the invitation was sent in.
     */
    locale?: LocaleCode
};