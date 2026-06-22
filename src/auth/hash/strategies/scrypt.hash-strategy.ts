import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { HashStrategyInterface } from './hash-strategy.interface';
import { HashContent, HashString, HashUtilities } from '../hash.utilities';

/**
 * Options for hashing via the scrypt hash strategy.
 */
export type ScryptHashOptions = {
    /**
     * Salt length in bytes. Defaults to 16.
     */
    saltLength?: number
};

/**
 * Default scrypt hash strategy implementation of zibri.
 */
export class ScryptHashStrategy implements HashStrategyInterface<ScryptHashOptions> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'scrypt';
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly version: string = 'v1';

    private readonly keyLength: number = 32;
    // eslint-disable-next-line typescript/typedef
    private readonly scrypt = promisify(scrypt);

    // eslint-disable-next-line jsdoc/require-jsdoc
    async hash(
        value: string,
        options: ScryptHashOptions | undefined
    ): Promise<HashString> {
        const salt: Buffer = randomBytes(options?.saltLength ?? 16);
        const hash: Buffer = await this.scrypt(value, salt, this.keyLength) as Buffer;
        const hashedValue: string = `${salt.toString('hex')}:${hash.toString('hex')}`;
        return HashUtilities.contentToHash({ strategyName: this.name, version: this.version, hashedValue });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async equal(value: string, hash: HashString): Promise<boolean> {
        const content: HashContent = HashUtilities.hashToContent(hash);
        const [saltHex, hashHex] = content.hashedValue.split(':');

        if (!saltHex || !hashHex) {
            return false;
        }

        const salt: Buffer = Buffer.from(saltHex, 'hex');
        const storedHash: Buffer = Buffer.from(hashHex, 'hex');
        const passwordHash: Buffer = await this.scrypt(value, salt, this.keyLength) as Buffer;
        return passwordHash.length === storedHash.length && timingSafeEqual(passwordHash, storedHash);
    }
}