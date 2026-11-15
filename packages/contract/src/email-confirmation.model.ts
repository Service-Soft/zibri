/**
 * What following the link of an email answers: what it was for, and whether that is done.
 */
export type EmailConfirmation = {
    /**
     * Whether the link verified the address, or was one of a change of it.
     */
    purpose: 'verification' | 'change',
    /**
     * Whether it is done. False for a change that still waits for the link to the other address.
     */
    completed: boolean
};