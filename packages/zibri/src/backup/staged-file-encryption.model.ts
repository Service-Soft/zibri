/**
 * What a file staged on this instance's disk is encrypted with: a key and an IV of its own, which no other
 * file shares.
 */
export type StagedFileEncryption = {
    /**
     * The key, 32 bytes.
     */
    key: Buffer,
    /**
     * The IV, 16 bytes.
     */
    iv: Buffer
};