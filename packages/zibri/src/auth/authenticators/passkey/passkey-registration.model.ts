/**
 * What a passkey created for a user who does not exist yet says about them.
 */
export type PasskeyRegistration = {
    /**
     * The name the device lists the account under, as the sign-up named it, such as an email.
     * Nothing has proven it.
     */
    name: string,
    /**
     * The model of the device, all zeros when it keeps that to itself.
     */
    aaguid: string,
    /**
     * Whether the passkey is synced to other devices of the user.
     */
    synced: boolean
};