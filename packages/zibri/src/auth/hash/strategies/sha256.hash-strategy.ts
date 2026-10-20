import { createHash, timingSafeEqual } from 'node:crypto';

import { HashStrategyInterface } from './hash-strategy.interface.ts';
import { HashContent, HashString, HashUtilities } from '../hash.utilities.ts';

/**
 * Hash strategy for values that carry their own entropy, and have to stay findable.
 *
 * Unsalted and fast, which is what makes it usable where the other strategies are not: a value
 * hashed this way can be looked up, because hashing the same input again produces the same hash.
 * That is the whole reason it exists - a refresh token or a password reset token arrives on its own,
 * with nothing else in the request to find the row by, so a salted hash would leave no way to find
 * it short of reading every row and comparing.
 *
 * **Never use this for a password, or for anything else short enough to guess.** scrypt and bcrypt
 * are slow and salted because their input is guessable; neither property buys anything against a
 * value like `randomBytes(16)`, where there is nothing to enumerate and no two inputs to collide.
 * Against a password, both properties are exactly what is missing. `deterministic` says so to the
 * hash service, which refuses to use this as the default strategy.
 */
export class Sha256HashStrategy implements HashStrategyInterface<Record<string, never>> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly name: string = 'sha256';
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly version: string = 'v1';
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly deterministic: boolean = true;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    hash(value: string): HashString {
        return HashUtilities.contentToHash({
            strategyName: this.name,
            version: this.version,
            hashedValue: createHash('sha256').update(value, 'utf8')
                .digest('hex')
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    equal(value: string, hash: HashString): boolean {
        const content: HashContent = HashUtilities.hashToContent(hash);
        const expected: Buffer = Buffer.from(content.hashedValue, 'hex');
        const actual: Buffer = Buffer.from(
            createHash('sha256').update(value, 'utf8')
                .digest('hex'),
            'hex'
        );
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    }
}