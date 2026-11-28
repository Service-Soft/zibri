import { type LocaleCode } from '../../localization/models/locale-code.model';

/**
 * Who accepts an invitation, and with what.
 */
export type InvitationAcceptance = {
    /**
     * The locale of the account the invitation creates, one the application supports, in place of the locale the
     * invitation was sent in. An email with an account of its own keeps the account's.
     */
    locale?: LocaleCode,
    /**
     * The password of the account the invitation creates, for an email without an account of its own.
     */
    password: string | undefined,
    /**
     * The id of the user the request is logged in as, if any. An email with an account of its own is accepted by
     * that account only.
     */
    loggedInUserId: string | undefined
};