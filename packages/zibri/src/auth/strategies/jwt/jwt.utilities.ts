import { createHash, createPrivateKey, createPublicKey, createSecretKey, JsonWebKey, KeyObject, webcrypto, X509Certificate } from 'node:crypto';

// types only, which leave nothing behind in the build: the package itself is an optional peer,
// loaded through optionalPeer where a token is signed or verified
import type { JWK, JWTPayload, JWTVerifyResult } from 'jose';

import { EncodedJwt } from './encoded-jwt-access-token.model';
import { Jwk } from './jwk.model';
import { JwtAssertionVerifyOptions } from './jwt-assertion-verify-options.model';
import { JwtAsymmetricAlgorithm } from './jwt-asymmetric-algorithm.type';
import { JwtAsymmetricKey } from './jwt-asymmetric-key.model';
import { JwtKey } from './jwt-key.model';
import { JwtProviderTokenVerifyOptions } from './jwt-provider-token-verify-options.model';
import { JwtRemoteKeySet } from './jwt-remote-key-set.type';
import { JwtSignOptions } from './jwt-sign-options.model';
import { JwtVerifyOptions } from './jwt-verify-options.model';
import { VerifiedDpopProof } from './verified-dpop-proof.model';
import { OmitStrict } from '../../../types/omit-strict.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { Ms } from '../../../utilities/ms';
import { optionalPeer } from '../../../utilities/optional-peer.function';

/**
 * The exports of the `jose` package.
 */
type Jose = typeof import('jose');

/**
 * What a key has to be for an algorithm to sign with it.
 */
type KeyRequirement = {
    /**
     * The `asymmetricKeyType` node reports for a fitting key.
     */
    keyType: 'rsa' | 'ec' | 'ed25519',
    /**
     * The curve an elliptic curve key has to be on.
     */
    namedCurve?: string
};

const KEY_REQUIREMENTS: Record<JwtAsymmetricAlgorithm, KeyRequirement> = {
    ES256: { keyType: 'ec', namedCurve: 'prime256v1' },
    ES384: { keyType: 'ec', namedCurve: 'secp384r1' },
    ES512: { keyType: 'ec', namedCurve: 'secp521r1' },
    EdDSA: { keyType: 'ed25519' },
    RS256: { keyType: 'rsa' }
};

/**
 * The smallest RSA key tokens may be signed or verified with, in bits.
 */
const MIN_RSA_MODULUS_LENGTH: number = 2048;

/**
 * Every algorithm a key pair may sign with.
 */
const ASYMMETRIC_ALGORITHMS: JwtAsymmetricAlgorithm[] = ['ES256', 'ES384', 'ES512', 'EdDSA', 'RS256'];

/**
 * Signs, verifies and describes the keys of JSON Web Tokens.
 */
export abstract class JwtUtilities {
    /**
     * Signs the given payload into a JSON Web Token.
     *
     * The algorithm is the key's, and a key pair also writes its `kid` into the header.
     * @param payload - What to put inside the token.
     * @param key - The key to sign with.
     * @param options - How long the token is valid, who issued it and who it is for.
     * @returns The jwt.
     */
    static async sign(payload: Record<string, unknown>, key: JwtKey, options: JwtSignOptions): Promise<string> {
        const jose: Jose = JwtUtilities.resolveJose();
        const jwt: InstanceType<Jose['SignJWT']> = new jose.SignJWT(payload)
            .setProtectedHeader({ alg: key.algorithm, typ: options.type, ...key.algorithm === 'HS256' ? {} : { kid: key.kid } })
            .setIssuedAt()
            .setIssuer(options.issuer)
            // seconds since the epoch rather than a Date: jose is loaded through node's own require,
            // outside whatever realm the caller runs in, and checks a Date with instanceof. A number
            // is the same in every realm
            .setExpirationTime(Math.floor((Date.now() + options.expiresInMs) / Ms.SECOND));
        if (options.audience != undefined) {
            jwt.setAudience(options.audience);
        }
        if (options.jwtId != undefined) {
            jwt.setJti(options.jwtId);
        }
        return await jwt.sign(JwtUtilities.resolveKeyInput(key));
    }

    /**
     * Asynchronously verify a given token against the given keys to get a decoded token.
     *
     * Three things are pinned rather than left to the library's defaults:
     *
     * - **`algorithms`**, to the one algorithm of the key a token is checked against. A token naming
     * any other is refused, so neither an unsigned token nor one signed with hmac over a public key
     * verifies.
     * - **`issuer`.** Two applications sharing a key would otherwise accept each other's tokens.
     * - **`exp`.** A token without one is refused rather than taken to never expire.
     *
     * The audience and the `typ` of the header are checked as the options say.
     *
     * The payload comes back as `unknown`. What verification establishes is that this application
     * issued the token and nobody changed it since - not that the contents are shaped the way the
     * caller expects, which is a separate question with a separate answer per token type.
     *
     * More than one key may be handed in, which is what makes replacing a key possible without
     * invalidating every token in circulation. A token is only checked against the keys whose `kid`
     * is the one in its header, so a token signed with a secret is only checked against secrets.
     * They are tried in order and the first that verifies wins, so put the current one first.
     * @param token - The token to verify.
     * @param keys - The keys it may have been signed with, current one first.
     * @param options - Who the token must say issued it, who it must be for, and its `typ`.
     * @returns The decoded token, or undefined if it does not verify against any of the keys.
     */
    static async verify(
        token: string,
        keys: JwtKey[],
        options: JwtVerifyOptions
    ): Promise<EncodedJwt | undefined> {
        const jose: Jose = JwtUtilities.resolveJose();
        // read before it is verified, and only to choose which of our own keys to check it against.
        // Whatever the header says, the algorithm is the key's
        let kid: string | undefined;
        try {
            kid = jose.decodeProtectedHeader(token).kid;
        }
        catch {
            return undefined;
        }
        for (const key of keys.filter(k => k.kid === kid)) {
            try {
                const verified: JWTVerifyResult = await jose.jwtVerify(token, JwtUtilities.resolveKeyInput(key), {
                    algorithms: [key.algorithm],
                    issuer: options.issuer,
                    audience: options.audience,
                    typ: options.type,
                    // every token signed here carries one. Without this a token that lacks it would
                    // be taken to never expire, which is what the libraries do by default
                    requiredClaims: ['exp']
                });
                return {
                    header: { alg: verified.protectedHeader.alg, kid: verified.protectedHeader.kid, typ: verified.protectedHeader.typ },
                    payload: verified.payload
                };
            }
            catch {
                continue;
            }
        }
        return undefined;
    }

    /**
     * Builds the key tokens are signed with from a configured secret or key pair.
     * @param secretOrKey - A shared secret, or a key pair holding the private key.
     * @returns The key to sign with.
     * @throws When a key pair holds no private key, or a key that does not fit its algorithm.
     */
    static resolveSigningKey(secretOrKey: string | JwtAsymmetricKey): JwtKey {
        if (typeof secretOrKey === 'string') {
            return { algorithm: 'HS256', secret: secretOrKey };
        }
        const privateKey: KeyObject = typeof secretOrKey.key === 'string' ? createPrivateKey(secretOrKey.key) : secretOrKey.key;
        if (privateKey.type !== 'private') {
            throw new Error(`Tokens are signed with this key, so it has to be a private key rather than a ${privateKey.type} one.`);
        }
        const publicKey: KeyObject = createPublicKey(privateKey);
        JwtUtilities.validateKeyFitsAlgorithm(publicKey, secretOrKey.algorithm);
        return { algorithm: secretOrKey.algorithm, key: privateKey, kid: JwtUtilities.resolveThumbprint(publicKey) };
    }

    /**
     * Builds a key tokens are verified with from a configured secret or key pair.
     * @param secretOrKey - A shared secret, or a key pair holding either of its keys.
     * @returns The key to verify with, holding only the public key of a key pair.
     * @throws When the key does not fit its algorithm.
     */
    static resolveVerificationKey(secretOrKey: string | JwtAsymmetricKey): JwtKey {
        if (typeof secretOrKey === 'string') {
            return { algorithm: 'HS256', secret: secretOrKey };
        }
        const publicKey: KeyObject = JwtUtilities.resolvePublicKey(secretOrKey.key);
        JwtUtilities.validateKeyFitsAlgorithm(publicKey, secretOrKey.algorithm);
        return { algorithm: secretOrKey.algorithm, key: publicKey, kid: JwtUtilities.resolveThumbprint(publicKey) };
    }

    /**
     * Writes the public key of a key pair as a JSON Web Key.
     * @param key - The key to write.
     * @returns The JSON Web Key, or undefined for a shared secret, which has nothing to publish.
     */
    static resolveJwk(key: JwtKey): Jwk | undefined {
        if (key.algorithm === 'HS256') {
            return undefined;
        }
        // built member by member from the public key rather than spread from an export: a private
        // key exports its private members too, and this is what gets published
        const exported: webcrypto.JsonWebKey = JwtUtilities.resolvePublicKey(key.key).export({ format: 'jwk' });
        return { kty: exported.kty ?? '', kid: key.kid, alg: key.algorithm, use: 'sig', ...JwtUtilities.getPublicMembers(exported) };
    }

    /**
     * Verifies a jwt a client signed to authenticate itself (RFC 7523): signed with its key, issued by
     * it and about it, for one of the audiences, with an `exp` and a `jti`.
     * @param token - The jwt.
     * @param key - The client's public key, or the key set it publishes.
     * @param options - The client, and who the jwt must be for.
     * @returns The payload, or undefined when the jwt does not verify.
     */
    static async verifyAssertion(
        token: string,
        key: KeyObject | JwtRemoteKeySet,
        options: JwtAssertionVerifyOptions
    ): Promise<Record<string, unknown> | undefined> {
        const jose: Jose = JwtUtilities.resolveJose();
        const verifyOptions: Parameters<Jose['jwtVerify']>[2] = {
            // a key pair's algorithm, never hmac: the client holds the private key and nobody else
            algorithms: key instanceof KeyObject ? [JwtUtilities.resolveAlgorithm(key)] : ASYMMETRIC_ALGORITHMS,
            issuer: options.clientId,
            subject: options.clientId,
            audience: options.audiences,
            // the jti is what a jwt is spent by, so a captured one cannot be presented again
            requiredClaims: ['exp', 'jti']
        };
        try {
            const verified: JWTVerifyResult = await jose.jwtVerify(token, key, verifyOptions);
            return verified.payload;
        }
        catch {
            return undefined;
        }
    }

    /**
     * Verifies a jwt an identity provider signed, such as an access token it issued for an api: signed
     * with a key of the set the provider publishes, by one of the algorithms, issued by it, for one of
     * the audiences, with an `exp` and a `sub`.
     *
     * The `typ` of the header is left to the caller, which knows which kind of token it takes for
     * which audience.
     * @param token - The jwt.
     * @param keySet - The key set the provider publishes.
     * @param options - The provider, who the jwt must be for, and the algorithms.
     * @returns The decoded jwt, or undefined when it does not verify.
     */
    static async verifyProviderToken(
        token: string,
        keySet: JwtRemoteKeySet,
        options: JwtProviderTokenVerifyOptions
    ): Promise<EncodedJwt<JWTPayload> | undefined> {
        const jose: Jose = JwtUtilities.resolveJose();
        try {
            const verified: JWTVerifyResult = await jose.jwtVerify(token, keySet, {
                algorithms: options.algorithms,
                issuer: options.issuer,
                audience: options.audiences,
                // the subject is who the token signs in as, which a token without one names nobody
                requiredClaims: ['exp', 'sub']
            });
            return {
                header: { alg: verified.protectedHeader.alg, kid: verified.protectedHeader.kid, typ: verified.protectedHeader.typ },
                payload: verified.payload
            };
        }
        catch {
            return undefined;
        }
    }

    /**
     * Verifies a DPoP proof (RFC 9449, 4.3): a jwt of `typ` `dpop+jwt`, signed with the private key of
     * the public key its header carries, with a `jti`, `htm`, `htu` and an `iat` within the age given.
     * @param proof - The proof.
     * @param algorithms - What it may be signed with.
     * @param maxAgeInMs - How long ago it may have been issued, which is also how far ahead it may claim.
     * @returns Its payload and the RFC 7638 thumbprint of its key, or undefined when it does not verify.
     */
    static async verifyDpopProof(
        proof: string,
        algorithms: JwtAsymmetricAlgorithm[],
        maxAgeInMs: number
    ): Promise<VerifiedDpopProof | undefined> {
        const jose: Jose = JwtUtilities.resolveJose();
        try {
            const verified: JWTVerifyResult = await jose.jwtVerify(proof, jose.EmbeddedJWK, {
                typ: 'dpop+jwt',
                algorithms,
                requiredClaims: ['jti', 'htm', 'htu', 'iat'],
                maxTokenAge: Math.floor(maxAgeInMs / Ms.SECOND),
                clockTolerance: Math.floor(maxAgeInMs / Ms.SECOND)
            });
            const jwk: JWK | undefined = verified.protectedHeader.jwk;
            // a private key in the header would be one the client handed to everybody it sends a proof to
            if (jwk == undefined || 'd' in jwk) {
                return undefined;
            }
            return { payload: verified.payload, jwkThumbprint: await jose.calculateJwkThumbprint(jwk, 'sha256') };
        }
        catch {
            return undefined;
        }
    }

    /**
     * The keys a JSON Web Key Set at a url holds, fetched with the given function when a token names
     * a key that is not known yet, and kept for a while after.
     * @param url - The url of the key set.
     * @param fetchKeys - Fetches the key set, the way the global `fetch` does.
     * @returns The key set.
     */
    static createRemoteKeySet(url: string, fetchKeys: (url: string, init: RequestInit) => Promise<Response>): JwtRemoteKeySet {
        const jose: Jose = JwtUtilities.resolveJose();
        return jose.createRemoteJWKSet(new URL(url), { [jose.customFetch]: fetchKeys });
    }

    /**
     * Reads a public key given as PEM or as a JSON Web Key.
     * @param key - The key.
     * @returns The key.
     * @throws When it is no public key, or a key that cannot sign tokens.
     */
    static resolveClientKey(key: string | JsonWebKey): KeyObject {
        const publicKey: KeyObject = typeof key === 'string' ? createPublicKey(key) : createPublicKey({ key, format: 'jwk' });
        JwtUtilities.resolveAlgorithm(publicKey);
        return publicKey;
    }

    /**
     * The algorithm a public key verifies tokens with: by its type, and for an elliptic curve by its curve.
     * @param publicKey - The key.
     * @returns The algorithm.
     * @throws When the key is of no type tokens are signed with, or an RSA key that is too short.
     */
    static resolveAlgorithm(publicKey: KeyObject): JwtAsymmetricAlgorithm {
        const algorithm: JwtAsymmetricAlgorithm | undefined = ASYMMETRIC_ALGORITHMS.find(a => {
            const requirement: KeyRequirement = KEY_REQUIREMENTS[a];
            return publicKey.asymmetricKeyType === requirement.keyType
                && (requirement.namedCurve == undefined || publicKey.asymmetricKeyDetails?.namedCurve === requirement.namedCurve);
        });
        if (algorithm == undefined) {
            throw new Error(`An ${publicKey.asymmetricKeyType ?? 'unknown'} key signs no tokens: it has to be an EC, Ed25519 or RSA key.`);
        }
        JwtUtilities.validateKeyFitsAlgorithm(publicKey, algorithm);
        return algorithm;
    }

    /**
     * Reads the payload of a jwt without verifying it, for a decision that verifying it afterwards
     * settles anyway.
     * @param token - The token.
     * @returns The payload, or undefined when the token is no jwt.
     */
    static findUnverifiedPayload(token: string): unknown {
        const parts: string[] = token.split('.');
        if (parts.length !== 3 || parts[1] == undefined) {
            return undefined;
        }
        try {
            return JsonUtilities.parse<unknown>(Buffer.from(parts[1], 'base64url').toString('utf8'));
        }
        catch {
            return undefined;
        }
    }

    /**
     * The SHA-256 thumbprint of a certificate, which a token bound to it names as `x5t#S256` (RFC 8705).
     * @param certificate - The certificate.
     * @returns The base64url encoded SHA-256 of its DER encoding.
     */
    static resolveCertificateThumbprint(certificate: X509Certificate): string {
        return createHash('sha256').update(certificate.raw)
            .digest('base64url');
    }

    /**
     * Loads `jose`, which signs and verifies.
     * @returns The package's exports.
     * @throws When it is not installed.
     */
    private static resolveJose(): Jose {
        return optionalPeer<Jose>('jose', 'Jwt auth');
    }

    /**
     * The key in the form jose takes it.
     *
     * Always a `KeyObject`, a secret included. The `jose` package recognizes a secret handed over as
     * bytes with instanceof, and it is loaded through node's own require, outside whatever realm the
     * caller runs in - bytes from a test runner's realm would be refused as no key at all. A
     * `KeyObject` is recognized the same way in every realm.
     * @param key - The key to sign or verify with.
     * @returns The key as a `KeyObject`.
     */
    private static resolveKeyInput(key: JwtKey): KeyObject {
        return key.algorithm === 'HS256' ? createSecretKey(Buffer.from(key.secret, 'utf8')) : key.key;
    }

    /**
     * The members of a public JSON Web Key that describe the key itself, by key type.
     * @param exported - The public key, exported as a JSON Web Key.
     * @returns The key's own members.
     */
    private static getPublicMembers(exported: webcrypto.JsonWebKey): OmitStrict<Jwk, 'kty' | 'kid' | 'alg' | 'use'> {
        if (exported.kty === 'EC') {
            return { crv: exported.crv, x: exported.x, y: exported.y };
        }
        if (exported.kty === 'OKP') {
            return { crv: exported.crv, x: exported.x };
        }
        return { n: exported.n, e: exported.e };
    }

    /**
     * The public half of a key, whichever half it was given as.
     * @param key - A public or private key, as a `KeyObject` or PEM encoded.
     * @returns The public key.
     */
    private static resolvePublicKey(key: KeyObject | string): KeyObject {
        // node derives a public key from a private one or from pem, but refuses to be handed a
        // KeyObject that is already public
        return key instanceof KeyObject && key.type === 'public' ? key : createPublicKey(key);
    }

    /**
     * Refuses a key the given algorithm cannot sign or verify with.
     *
     * Checked when the key is configured rather than left to the first token, which for a previous
     * key would be the moment every token it signed stops verifying.
     * @param publicKey - The public key to check.
     * @param algorithm - The algorithm it is meant for.
     * @throws When the key is of the wrong type, on the wrong curve, or an RSA key that is too short.
     */
    private static validateKeyFitsAlgorithm(publicKey: KeyObject, algorithm: JwtAsymmetricAlgorithm): void {
        const requirement: KeyRequirement = KEY_REQUIREMENTS[algorithm];
        if (publicKey.asymmetricKeyType !== requirement.keyType) {
            throw new Error(`${algorithm} needs an ${requirement.keyType} key, not an ${publicKey.asymmetricKeyType ?? 'unknown'} one.`);
        }
        const namedCurve: string | undefined = publicKey.asymmetricKeyDetails?.namedCurve;
        if (requirement.namedCurve != undefined && namedCurve !== requirement.namedCurve) {
            throw new Error(`${algorithm} needs a key on the curve ${requirement.namedCurve}, not ${namedCurve ?? 'unknown'}.`);
        }
        const modulusLength: number = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
        if (requirement.keyType === 'rsa' && modulusLength < MIN_RSA_MODULUS_LENGTH) {
            throw new Error(`${algorithm} needs an RSA key of at least ${MIN_RSA_MODULUS_LENGTH} bits, not ${modulusLength}.`);
        }
    }

    /**
     * The RFC 7638 thumbprint of a public key, which is what identifies it as a `kid`.
     *
     * Computed rather than configured, so a key has the same id in every process that holds it and
     * nobody has to name one.
     * @param publicKey - The key to identify.
     * @returns The base64url encoded sha256 of the key's required members.
     */
    private static resolveThumbprint(publicKey: KeyObject): string {
        const exported: webcrypto.JsonWebKey = publicKey.export({ format: 'jwk' });
        return createHash('sha256').update(JsonUtilities.stringify(JwtUtilities.getThumbprintMembers(exported)))
            .digest('base64url');
    }

    /**
     * Exactly the members RFC 7638 requires of a key type, in the lexicographic order it requires.
     *
     * The order matters because the thumbprint is a hash of their serialization, and
     * `JsonUtilities.stringify` keeps insertion order and writes no whitespace.
     * @param exported - The public key, exported as a JSON Web Key.
     * @returns The members to hash.
     */
    private static getThumbprintMembers(exported: webcrypto.JsonWebKey): Record<string, string | undefined> {
        if (exported.kty === 'EC') {
            return { crv: exported.crv, kty: exported.kty, x: exported.x, y: exported.y };
        }
        if (exported.kty === 'OKP') {
            return { crv: exported.crv, kty: exported.kty, x: exported.x };
        }
        return { e: exported.e, kty: exported.kty, n: exported.n };
    }
}