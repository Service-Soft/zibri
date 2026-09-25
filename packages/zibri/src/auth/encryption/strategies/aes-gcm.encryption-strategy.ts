import { CipherGCM, CipherGCMTypes, createCipheriv, createDecipheriv, DecipherGCM, randomBytes } from 'node:crypto';

import { EncryptionContent, EncryptionString, EncryptionUtilities } from '../encryption.utilities';
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionBinding, EncryptionStrategyInterface } from './encryption-strategy.interface';
import { InternalError } from '../../../error-handling/internal-error.model';

/**
 * A stored aes-gcm value, split into its parts.
 */
type ParsedAesGcmValue = {
    /**
     * How much of its place the value was bound to, or undefined for one written before binding
     * existed.
     */
    marker: AesGcmValueBinding | undefined,
    /**
     * The initialization vector, base64 encoded.
     */
    ivB64: string,
    /**
     * The authentication tag, base64 encoded.
     */
    tagB64: string,
    /**
     * The encrypted value itself, base64 encoded.
     */
    contentB64: string
};

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
 * How much of its place a value was bound to, written into the value itself.
 *
 * The marker is covered by the authentication tag, so neither changing it nor removing it gets an
 * attacker anywhere: decryption builds a different aad than encryption did and the tag stops
 * matching. A value stored before binding existed has no marker at all and is told apart by having
 * one segment fewer.
 */
enum AesGcmValueBinding {
    /**
     * Bound to the row it was written to, and to the envelope header.
     */
    ROW = 'b',
    /**
     * Bound to the envelope header only, and so free to move between rows.
     */
    HEADER = 'u'
}

/**
 * Default aes-256-gcm encryption strategy implementation of Zibri.
 *
 * ## What a stored value looks like
 * `aes-256-gcm.v1.<keyId>.<marker>.<iv>.<tag>.<ciphertext>`, where the marker says how much of its
 * place the value was bound to. Values written before binding existed have no marker and carry three
 * segments instead of four; they still decrypt, with nothing authenticated but the ciphertext.
 *
 * The version is deliberately *not* what carries this. A strategy is looked up by name and version
 * and its keys hang off that pair, so bumping it would partition the keys and need every stored value
 * migrated before the app could read them. Describing the value in the value is what lets old and new
 * ones live in the same column.
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
        const marker: AesGcmValueBinding | undefined = this.markerFor(options.binding);
        const iv: Buffer = randomBytes(12);
        const cipher: CipherGCM = createCipheriv(this.name, options.key, iv);

        const aad: string | undefined = this.aadFor(marker, options);
        if (aad !== undefined) {
            cipher.setAAD(Buffer.from(aad, 'utf8'));
        }

        const encrypted: Buffer = Buffer.concat([
            cipher.update(value, 'utf8'),
            cipher.final()
        ]);

        const tag: Buffer = cipher.getAuthTag();

        const encryptedValue: string = [
            ...marker === undefined ? [] : [marker],
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
        const { marker, ivB64, tagB64, contentB64 }: ParsedAesGcmValue = this.parse(content.encryptedValue);

        const decipher: DecipherGCM = createDecipheriv(
            this.name,
            options.key,
            Buffer.from(ivB64, 'base64')
        );

        const aad: string | undefined = this.aadFor(marker, options);
        if (aad !== undefined) {
            decipher.setAAD(Buffer.from(aad, 'utf8'));
        }

        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

        const decrypted: Buffer = Buffer.concat([
            decipher.update(Buffer.from(contentB64, 'base64')),
            decipher.final()
        ]);

        return decrypted.toString('utf8');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    isBoundToRow(value: EncryptionString): boolean {
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(value);
        return this.parse(content.encryptedValue).marker === AesGcmValueBinding.ROW;
    }

    /**
     * How much of its place a value is being bound to, given what the caller asked for.
     * @param binding - Where the value belongs, when it is being written to an entity.
     * @returns The marker to store, or undefined to write a value with nothing authenticated.
     */
    private markerFor(binding: EncryptionBinding | undefined): AesGcmValueBinding | undefined {
        if (binding == undefined) {
            return undefined;
        }
        return binding.rowId == undefined ? AesGcmValueBinding.HEADER : AesGcmValueBinding.ROW;
    }

    /**
     * The additional authenticated data for a value with the given marker.
     *
     * The envelope header goes in whenever anything does. It sits outside the ciphertext, so without
     * this the key id a value names could be edited in place with nothing noticing.
     * @param marker - How much of its place the value is bound to.
     * @param options - What the caller passed, holding the binding and the key id.
     * @returns The aad, or undefined for a value that authenticates nothing.
     * @throws When a binding is required by the marker but was not supplied.
     */
    private aadFor(
        marker: AesGcmValueBinding | undefined,
        options: AesGcmEncryptOptions | AesGcmDecryptOptions
    ): string | undefined {
        if (marker === undefined) {
            // a value written before binding existed. Its own aad option still applies, so a caller
            // that was passing one by hand keeps working
            return options.aad;
        }

        const header: string = `${this.name}.${this.version}.${options.keyId}`;
        if (marker === AesGcmValueBinding.HEADER) {
            return [header, options.aad ?? ''].join('|');
        }

        const rowId: string | undefined = options.binding?.rowId;
        if (rowId == undefined) {
            throw new InternalError(
                'This value is bound to the row it was written to, but it is being read without one.'
            );
        }
        return [header, rowId, options.aad ?? ''].join('|');
    }

    /**
     * Splits a stored value into its parts, telling a bound one from a legacy one by its shape.
     * @param encryptedValue - The value part of the envelope.
     * @returns The marker, if any, and the three base64 parts.
     * @throws When the value does not have a shape this strategy wrote.
     */
    private parse(encryptedValue: string): ParsedAesGcmValue {
        const [first, second, third, ...rest] = encryptedValue.split('.');
        const marker: AesGcmValueBinding | undefined = Object.values(AesGcmValueBinding)
            .find(m => m === first);

        if (marker === undefined) {
            const contentB64: string = [third, ...rest].join('.');
            if (!first || !second || !contentB64) {
                throw new InternalError('Invalid encrypted value');
            }
            return { marker, ivB64: first, tagB64: second, contentB64 };
        }

        const contentB64: string = rest.join('.');
        if (!second || !third || !contentB64) {
            throw new InternalError('Invalid encrypted value');
        }
        return { marker, ivB64: second, tagB64: third, contentB64 };
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