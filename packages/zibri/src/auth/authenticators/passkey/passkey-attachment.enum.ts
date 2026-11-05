/**
 * Where the device holding a passkey is, as the browser tells it.
 */
export enum PasskeyAttachment {
    /**
     * Built into the device the browser runs on, such as a laptop's fingerprint reader.
     */
    PLATFORM = 'platform',
    /**
     * Another device, such as a security key or a phone.
     */
    CROSS_PLATFORM = 'cross-platform'
}