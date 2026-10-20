import type { Batch, GlideClient, Script, TimeUnit } from '@valkey/valkey-glide';

import { optionalPeer } from '../../../utilities/optional-peer.function.ts';

/**
 * The parts of the valkey client that are used as values rather than as types.
 */
type ValKeyGlide = {
    /**
     * The client itself, whose `createClient` opens a connection.
     */
    GlideClient: typeof GlideClient,
    /**
     * A group of commands sent together.
     */
    Batch: typeof Batch,
    /**
     * A lua script, hashed once and invoked by that hash afterwards.
     */
    Script: typeof Script,
    /**
     * The unit an expiry is expressed in.
     */
    TimeUnit: typeof TimeUnit
};

/**
 * The valkey client, loaded on demand.
 *
 * `@valkey/valkey-glide` is an optional peer dependency, and every module that spoke to valkey used
 * to import it at the top - which, through the barrel, made a postgres-only application install a
 * valkey client it would never open. A type import costs nothing because it is erased; only the
 * handful of places that use one of these as a *value* need the package to be there.
 *
 * Everything that calls this is reached through a `ValKeyDataSource`, which a consumer declares in
 * their options, so the package is wanted by the time an application has finished starting.
 * @returns The client's value exports.
 * @throws If `@valkey/valkey-glide` is not installed.
 */
export function valKeyGlide(): ValKeyGlide {
    return optionalPeer<ValKeyGlide>('@valkey/valkey-glide', 'Talking to valkey');
}