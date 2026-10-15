/**
 * A passkey a fake device holds.
 */
export type FakePasskey = {
    /**
     * Its id, base64url encoded.
     */
    id: string,
    /**
     * The site it was created for.
     */
    rpId: string,
    /**
     * The account it was created for, as the site named it, base64url encoded.
     */
    userHandle: string,
    /**
     * How many signatures it has made, which the device reports with the next one.
     */
    signCount: number
};