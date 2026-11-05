// types only, which leave nothing behind in the build
import type { createRemoteJWKSet } from 'jose';

/**
 * The keys a JSON Web Key Set at a url holds, fetched when a token names one that is not known yet.
 */
export type JwtRemoteKeySet = ReturnType<typeof createRemoteJWKSet>;