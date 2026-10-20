import { randomBytes, scrypt, ScryptOptions, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { HashStrategyInterface } from './hash-strategy.interface.ts';
import { Inject } from '../../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { HashContent, HashString, HashUtilities } from '../hash.utilities.ts';

/**
 * The cost of one scrypt derivation.
 *
 * `n` is the work factor and dominates both time and memory: a derivation needs roughly
 * `128 * n * r` bytes, so n=2^17 with r=8 is about 128MB **per concurrent hash**. That is the number
 * to think about when sizing a host, and the reason this is configurable rather than a constant.
 */
export type ScryptCost = {
    /**
     * CPU/memory cost. Must be a power of two.
     */
    n: number,
    /**
     * Block size.
     */
    r: number,
    /**
     * Parallelization.
     */
    p: number
};

/**
 * Options for hashing via the scrypt hash strategy.
 */
export type ScryptHashOptions = {
    /**
     * Salt length in bytes. Defaults to 16.
     */
    saltLength?: number,
    /**
     * What the derivation should cost. Defaults to {@link ZIBRI_DI_TOKENS.SCRYPT_COST}.
     */
    cost?: Partial<ScryptCost>
};

/**
 * A stored scrypt hash, taken apart.
 */
type ParsedScryptHash = {
    /**
     * What the stored hash was derived at, which is what verifying it has to use.
     */
    cost: ScryptCost,
    /**
     * The salt it was derived with.
     */
    salt: Buffer,
    /**
     * The derived key.
     */
    hash: Buffer
};

/**
 * What OWASP currently asks for: n=2^17, r=8, p=1.
 *
 * Node's own defaults are n=2^14, r=8, p=1 - eight times cheaper to attack, and what every hash
 * written before this was configurable used.
 */
export const defaultScryptCost: ScryptCost = { n: 131072, r: 8, p: 1 };

/**
 * Default scrypt hash strategy implementation of zibri.
 */
export class ScryptHashStrategy implements HashStrategyInterface<ScryptHashOptions> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly name: string = 'scrypt';
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly version: string = 'v1';
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly deterministic: boolean = false;

    private readonly keyLength: number = 32;
    // the options overload, which promisify does not pick on its own
    // eslint-disable-next-line typescript-js/typedef
    private readonly scrypt = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt);

    constructor(
        @Inject(ZIBRI_DI_TOKENS.SCRYPT_COST)
        private readonly defaultCost: ScryptCost
    ) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async hash(
        value: string,
        options: ScryptHashOptions | undefined
    ): Promise<HashString> {
        const cost: ScryptCost = { ...this.defaultCost, ...options?.cost };
        const salt: Buffer = randomBytes(options?.saltLength ?? 16);
        const hash: Buffer = await this.derive(value, salt, cost);
        // the cost is written into the value, so raising it later does not invalidate what is already
        // stored: an old hash is verified with the cost it was made at, and needsRehash is what says
        // it should be replaced.
        const hashedValue: string = [
            `n=${cost.n},r=${cost.r},p=${cost.p}`,
            salt.toString('hex'),
            hash.toString('hex')
        ].join(':');
        return HashUtilities.contentToHash({ strategyName: this.name, version: this.version, hashedValue });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async equal(value: string, hash: HashString): Promise<boolean> {
        const content: HashContent = HashUtilities.hashToContent(hash);
        const parsed: ParsedScryptHash | undefined = this.parse(content.hashedValue);

        if (!parsed) {
            return false;
        }

        const derived: Buffer = await this.derive(value, parsed.salt, parsed.cost);
        return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
    }

    /**
     * Whether this hash was made more cheaply than the current configuration asks for.
     *
     * Any of the three parameters being lower counts, including a hash written before the cost was
     * recorded at all - those were made at node's defaults, which is what the fallback describes.
     * @param hash - The stored hash.
     * @returns Whether it should be replaced the next time the plaintext is available.
     */
    needsRehash(hash: HashString): boolean {
        const parsed: ParsedScryptHash | undefined = this.parse(HashUtilities.hashToContent(hash).hashedValue);
        if (!parsed) {
            return true;
        }
        return parsed.cost.n < this.defaultCost.n
            || parsed.cost.r < this.defaultCost.r
            || parsed.cost.p < this.defaultCost.p;
    }

    /**
     * Whether a string looks like something this strategy produced.
     *
     * Checked past the envelope, on the encoding itself, so that a plaintext which merely starts
     * with `scrypt.v1.` is not mistaken for a hash.
     * @param hashedValue - The value part of an envelope carrying this strategy's name.
     * @returns Whether it parses as one of this strategy's hashes.
     */
    isHashedValue(hashedValue: string): boolean {
        return this.parse(hashedValue) != undefined;
    }

    private async derive(value: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
        return await this.scrypt(value, salt, this.keyLength, {
            N: cost.n,
            r: cost.r,
            p: cost.p,
            // scrypt refuses to allocate past maxmem, whose own default is 32MB - well under what the
            // cost above asks for. Derived from the parameters rather than configured separately,
            // since a maxmem that does not fit them can only ever mean a failed hash.
            maxmem: 256 * cost.n * cost.r
        });
    }

    /**
     * Reads a stored value in either the current or the original format.
     *
     * The original is `<salt>:<hash>` with no cost recorded, which means node's defaults - that is
     * what every hash written before the cost was configurable used, and they still have to verify.
     * @param hashedValue - The value part of the envelope.
     * @returns The cost, salt and hash, or undefined if it is not a scrypt value at all.
     */
    private parse(hashedValue: string): ParsedScryptHash | undefined {
        const parts: string[] = hashedValue.split(':');
        const legacy: boolean = parts.length === 2;
        const [costPart, saltHex, hashHex] = legacy ? ['n=16384,r=8,p=1', ...parts] : parts;

        if (!legacy && parts.length !== 3) {
            return undefined;
        }
        if (!costPart || !saltHex || !hashHex || !/^[\da-f]+$/.test(saltHex) || !/^[\da-f]+$/.test(hashHex)) {
            return undefined;
        }

        const cost: RegExpExecArray | null = /^n=(\d+),r=(\d+),p=(\d+)$/.exec(costPart);
        if (!cost) {
            return undefined;
        }

        return {
            cost: { n: Number(cost[1]), r: Number(cost[2]), p: Number(cost[3]) },
            salt: Buffer.from(saltHex, 'hex'),
            hash: Buffer.from(hashHex, 'hex')
        };
    }
}