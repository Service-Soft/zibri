import { HashStrategyInterface } from './hash-strategy.interface.ts';
import { optionalPeer } from '../../../utilities/optional-peer.function.ts';
import { HashContent, HashString, HashUtilities } from '../hash.utilities.ts';

/**
 * Options for hashing via the bcrypt hash strategy.
 */
export type BcryptHashOptions = {
    /**
     * How many rounds should be used for the salt.
     */
    rounds?: number
};

/**
 * Verifies the bcrypt hashes zibri 2.x wrote.
 *
 * Hashes with 10 rounds unless `rounds` says otherwise, and does its work on the main thread, where
 * scrypt runs on the thread pool. Keep it registered while stored hashes need it, and mark it
 * `DEPRECATED` in the hash strategy table: each of its hashes is then replaced with one of the
 * default strategy the next time its user signs in.
 * @deprecated Use `ScryptHashStrategy` for new hashes.
 */
// the default of 10 rounds stays as it is: this exists to read what 2.x wrote, and raising it would
// only make the strategy nobody should be writing with a little better at writing
export class BcryptHashStrategy implements HashStrategyInterface<BcryptHashOptions> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly name: string = 'bcrypt';
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly version: string = 'v1';
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly deterministic: boolean = false;

    /**
     * Loaded when the strategy is constructed, which is when a consumer wires it into their options
     * - so an application that asks for bcrypt without having installed it fails on the way up,
     * rather than on the first password it is handed.
     */
    private readonly bcrypt: typeof import('bcryptjs') = optionalPeer('bcryptjs', 'The bcrypt hash strategy');

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async hash(
        value: string,
        options: BcryptHashOptions | undefined
    ): Promise<HashString> {
        const hashedValue: string = await this.bcrypt.hash(value, options?.rounds ?? 10);
        return HashUtilities.contentToHash({ strategyName: this.name, version: this.version, hashedValue });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async equal(value: string, hash: HashString): Promise<boolean> {
        const content: HashContent = HashUtilities.hashToContent(hash);
        return await this.bcrypt.compare(value, content.hashedValue);
    }
}