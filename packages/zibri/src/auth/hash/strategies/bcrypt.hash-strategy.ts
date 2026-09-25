import { HashStrategyInterface } from './hash-strategy.interface';
import { optionalPeer } from '../../../utilities/optional-peer.function';
import { HashContent, HashString, HashUtilities } from '../hash.utilities';

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
 * Default bcrypt hash strategy implementation of zibri.
 */
export class BcryptHashStrategy implements HashStrategyInterface<BcryptHashOptions> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'bcrypt';
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly version: string = 'v1';
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly deterministic: boolean = false;

    /**
     * Loaded when the strategy is constructed, which is when a consumer wires it into their options
     * - so an application that asks for bcrypt without having installed it fails on the way up,
     * rather than on the first password it is handed.
     */
    private readonly bcrypt: typeof import('bcryptjs') = optionalPeer('bcryptjs', 'The bcrypt hash strategy');

    // eslint-disable-next-line jsdoc/require-jsdoc
    async hash(
        value: string,
        options: BcryptHashOptions | undefined
    ): Promise<HashString> {
        const hashedValue: string = await this.bcrypt.hash(value, options?.rounds ?? 10);
        return HashUtilities.contentToHash({ strategyName: this.name, version: this.version, hashedValue });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async equal(value: string, hash: HashString): Promise<boolean> {
        const content: HashContent = HashUtilities.hashToContent(hash);
        return await this.bcrypt.compare(value, content.hashedValue);
    }
}