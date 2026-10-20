import { createHash, generateKeyPairSync, JsonWebKey, KeyObject, randomUUID, sign } from 'node:crypto';

import { JsonUtilities } from 'zibri';

import { FakeDpopProofOptions } from './fake-dpop-proof-options.model.ts';

/**
 * The key pair a client signs its DPoP proofs with (RFC 9449), held the way a client holds it.
 *
 * It signs a proof for whatever request it is told about, so a test can ask for tokens bound to it and
 * send them, end to end. The key is an EC key on P-256, and the proofs are signed with ES256.
 */
export class FakeDpopKey {
    /**
     * The RFC 7638 thumbprint of the public key, which a token bound to it names as `jkt`.
     */
    readonly thumbprint: string;

    private readonly privateKey: KeyObject;
    private readonly publicJwk: JsonWebKey;

    constructor() {
        const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const exported: JsonWebKey = publicKey.export({ format: 'jwk' });
        this.privateKey = privateKey;
        this.publicJwk = { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y };
        // exactly the required members, in lexicographic order and without whitespace (RFC 7638, 3)
        this.thumbprint = createHash('sha256')
            .update(JsonUtilities.stringify({ crv: exported.crv, kty: exported.kty, x: exported.x, y: exported.y }))
            .digest('base64url');
    }

    /**
     * Signs a proof for a request, to be sent in its `DPoP` header.
     * @param method - The http method of the request.
     * @param url - The url of the request, as the application's `baseUrl` writes it.
     * @param options - The access token, the nonce, and what else the proof carries.
     * @returns The proof.
     */
    createProof(method: string, url: string, options: FakeDpopProofOptions = {}): string {
        const header: Record<string, unknown> = { typ: 'dpop+jwt', alg: 'ES256', jwk: this.publicJwk };
        const payload: Record<string, unknown> = {
            jti: options.jwtId ?? randomUUID(),
            htm: method,
            htu: url,
            iat: Math.floor((options.issuedAt ?? new Date()).getTime() / 1000),
            ...options.accessToken == undefined
                ? {}
                : {
                    ath: createHash('sha256')
                        .update(options.accessToken)
                        .digest('base64url')
                },
            ...options.nonce == undefined ? {} : { nonce: options.nonce }
        };
        const input: string = `${this.encode(header)}.${this.encode(payload)}`;
        // r and s side by side, which is how a jws carries an ecdsa signature (RFC 7518, 3.4)
        const signature: Buffer = sign('sha256', Buffer.from(input), { key: this.privateKey, dsaEncoding: 'ieee-p1363' });
        return `${input}.${signature.toString('base64url')}`;
    }

    /**
     * Encodes a part of the proof.
     * @param value - The header or the payload.
     * @returns Its json, base64url encoded.
     */
    private encode(value: Record<string, unknown>): string {
        return Buffer.from(JsonUtilities.stringify(value)).toString('base64url');
    }
}