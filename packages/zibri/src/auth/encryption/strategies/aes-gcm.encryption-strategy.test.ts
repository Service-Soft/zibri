import { describe, expect, it } from '@jest/globals';

import { AesGcmEncryptionStrategy } from './aes-gcm.encryption-strategy';
import { EncryptionContent, EncryptionString, EncryptionUtilities } from '../encryption.utilities';

describe('AesGcmEncryptionStrategy', () => {
    const strategy: AesGcmEncryptionStrategy = new AesGcmEncryptionStrategy();
    const key: Buffer = strategy.generateRandomKey();

    it('decrypts what it encrypted', () => {
        expect(strategy.decrypt(strategy.encrypt('secret', { key, keyId: 'k' }), { key, keyId: 'k' })).toBe('secret');
    });

    // node checks as many bytes of the tag as it is given, so a tag cut to four bytes is guessed once
    // in four billion tries rather than never
    it('refuses a value whose authentication tag is shorter than the one it writes', () => {
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(strategy.encrypt('secret', { key, keyId: 'k' }));
        const [iv, tag, ...rest] = content.encryptedValue.split('.');
        const shortTag: string = Buffer.from(tag ?? '', 'base64').subarray(0, 4)
            .toString('base64');
        const truncated: EncryptionString = EncryptionUtilities.contentToEncryptionString({
            ...content,
            encryptedValue: [iv, shortTag, ...rest].join('.')
        });

        expect(() => strategy.decrypt(truncated, { key, keyId: 'k' })).toThrow();
    });
});