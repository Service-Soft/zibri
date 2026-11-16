/**
 * The ticket a passkey created for a new account answers with, which the registration of the user continues with.
 */
export type PasskeyTicketCredentials = {
    /**
     * The one-time ticket.
     */
    ticket: string
};