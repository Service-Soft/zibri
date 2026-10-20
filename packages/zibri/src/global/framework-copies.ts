import { InternalError } from '../error-handling/internal-error.model.ts';

/**
 * The slot every copy of the framework counts itself into.
 *
 * `Symbol.for` reads a registry the whole realm shares, so two copies of zibri in `node_modules` -
 * each with its own modules, and therefore its own of everything those modules declare - still
 * arrive at the same symbol and can see that the other one is there.
 */
const LOADED_COPIES: unique symbol = Symbol.for('zibri.loaded-copies');

/**
 * `globalThis`, together with the single slot the framework keeps on it.
 */
type RealmGlobal = typeof globalThis & {
    /**
     * How many copies of zibri have been loaded into this realm.
     */
    [LOADED_COPIES]?: number
};

/**
 * An error for when more than one copy of zibri has been loaded into the same process.
 */
export class DuplicateFrameworkCopyError extends InternalError {
    constructor(copies: number, options?: ErrorOptions) {
        super([
            `${copies} copies of zibri are loaded in this process.`,
            'Each one has its own container, its own record of what is injectable and its own classes,',
            'so an injectable registered through one is invisible to the other, and an instanceof check',
            'across them says no about a value that is exactly what it claims to be.',
            'Run "npm ls zibri" to see which packages pulled in more than one of it.',
            'A package built on top of zibri should list it under "peerDependencies" rather than',
            '"dependencies", so that it uses the copy the application already has.'
        ], options);
        this.name = 'DuplicateFrameworkCopyError';
    }
}

/**
 * Counts the copy of the framework that this module belongs to.
 *
 * Runs once per copy, because a module is evaluated once per module registry it is loaded into -
 * which is the same thing the count is trying to measure.
 */
export function registerFrameworkCopy(): void {
    const realm: RealmGlobal = globalThis;
    realm[LOADED_COPIES] = (realm[LOADED_COPIES] ?? 0) + 1;
}

/**
 * Refuses to go on when more than one copy of the framework is loaded.
 *
 * The copies are deliberately not made to work with each other. Handing them one shared container
 * would still leave every class distinct, so `instanceof` would keep answering no across the
 * boundary for values that are what they claim to be - a residue much harder to find than the
 * install it came from. The install is the thing to fix, so this names it.
 * @throws A DuplicateFrameworkCopyError when a second copy has been loaded into this realm.
 */
export function validateSingleFrameworkCopy(): void {
    const realm: RealmGlobal = globalThis;
    const copies: number = realm[LOADED_COPIES] ?? 0;
    if (copies > 1) {
        throw new DuplicateFrameworkCopyError(copies);
    }
}