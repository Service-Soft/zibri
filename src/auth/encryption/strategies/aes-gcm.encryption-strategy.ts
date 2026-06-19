import { CipherGCM, CipherGCMTypes, createCipheriv, createDecipheriv, DecipherGCM, randomBytes } from 'node:crypto';

import { EncryptionContent, EncryptionString, EncryptionUtilities } from '../encryption.utilities';
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionStrategyInterface } from './encryption-strategy.interface';
import { InternalError } from '../../../error-handling/internal-error.model';

/**
 * Options for encrypting with the default aes-256-gcm encryption strategy implementation of Zibri.
 */
type AesGcmEncryptOptions = BaseEncryptOptions<Buffer> & {
    /**
     * The "Additional authenticated data" can be used to store something like a user id
     * on the encrypted value that needs to be provided when decrypting.
     */
    aad?: string
};

/**
 * Options for encrypting with the default aes-256-gcm encryption strategy implementation of Zibri.
 */
type AesGcmDecryptOptions = BaseDecryptOptions<Buffer> & {
    /**
     * The "Additional authenticated data" can be used to store something like a user id
     * on the encrypted value that needs to be provided when decrypting.
     */
    aad?: string
};

/**
 * Default aes-256-gcm encryption strategy implementation of Zibri.
 */
export class AesGcmEncryptionStrategy implements EncryptionStrategyInterface<
    Buffer,
    AesGcmEncryptOptions,
    AesGcmDecryptOptions
> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: CipherGCMTypes = 'aes-256-gcm';
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly version: string = 'v1';

    // eslint-disable-next-line jsdoc/require-jsdoc
    encrypt(value: string, options: AesGcmEncryptOptions): EncryptionString {
        const iv: Buffer = randomBytes(12);
        const cipher: CipherGCM = createCipheriv(this.name, options.key, iv);

        if (options.aad !== undefined) {
            cipher.setAAD(Buffer.from(options.aad, 'utf8'));
        }

        const encrypted: Buffer = Buffer.concat([
            cipher.update(value, 'utf8'),
            cipher.final()
        ]);

        const tag: Buffer = cipher.getAuthTag();

        const encryptedValue: string = [
            iv.toString('base64'),
            tag.toString('base64'),
            encrypted.toString('base64')
        ].join('.');

        return EncryptionUtilities.contentToEncryptionString({
            version: this.version,
            strategyName: this.name,
            keyId: options.keyId,
            encryptedValue
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    decrypt(value: EncryptionString, options: AesGcmDecryptOptions): string {
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(value);
        const [ivB64, tagB64, ...contentB64Parts] = content.encryptedValue.split('.');

        const contentB64: string = contentB64Parts.join('.');
        if (!ivB64 || !tagB64 || !contentB64) {
            throw new InternalError('Invalid encrypted value');
        }

        const decipher: DecipherGCM = createDecipheriv(
            this.name,
            options.key,
            Buffer.from(ivB64, 'base64')
        );

        if (options.aad !== undefined) {
            decipher.setAAD(Buffer.from(options.aad, 'utf8'));
        }

        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

        const decrypted: Buffer = Buffer.concat([
            decipher.update(Buffer.from(contentB64, 'base64')),
            decipher.final()
        ]);

        return decrypted.toString('utf8');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    generateRandomKey(): Buffer {
        return randomBytes(32);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    serializeKey(key: Buffer): Buffer {
        return key;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    deserializeKey(raw: Buffer): Buffer {
        return raw;
    }
}