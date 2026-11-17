/**
 * What the enrollment of recovery codes answers: the codes, which are shown once.
 */
export type RecoveryCodeRegistration = {
    /**
     * The codes, each working once in place of a second factor.
     */
    codes: string[]
};