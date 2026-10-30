/**
 * How many recovery codes a set holds, and how long each is, via
 * `ZIBRI_DI_TOKENS.RECOVERY_CODE_OPTIONS`.
 */
export type RecoveryCodeOptions = {
    /**
     * How many codes a set holds. 10 by default.
     */
    count?: number,
    /**
     * How many characters a code has, without the dash it is shown with. At least 10, which is 50
     * bits, and 10 by default.
     */
    length?: number
};