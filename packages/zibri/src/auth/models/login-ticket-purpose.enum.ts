/**
 * What a login ticket continues a login with.
 */
export enum LoginTicketPurpose {
    /**
     * Presenting or enrolling a second factor.
     */
    SECOND_FACTOR = 'secondFactor',
    /**
     * Choosing a new password, once any second factor was presented.
     */
    PASSWORD_CHANGE = 'passwordChange'
}