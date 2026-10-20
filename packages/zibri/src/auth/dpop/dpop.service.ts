import { createHash } from 'node:crypto';

import { DpopServiceInterface } from './dpop-service.interface.ts';
import { HttpRequestContext } from '../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { type LeaseServiceInterface } from '../../leases/lease-service.interface.ts';
import { TranslatedString } from '../../localization/models/translated-string.model.ts';
import { $ts } from '../../localization/translate.function.ts';
import { Ms } from '../../utilities/ms.ts';
import { OAuth2ErrorCode } from '../authorization-server/oauth2-error-code.enum.ts';
import { OAuth2Error } from '../authorization-server/oauth2.error.ts';
import { AuthorizationToken } from '../strategies/authorization-token.model.ts';
import { JwtAsymmetricAlgorithm } from '../strategies/jwt/jwt-asymmetric-algorithm.type.ts';
import { type JwtServiceInterface } from '../strategies/jwt/jwt-service.interface.ts';
import { JwtUtilities } from '../strategies/jwt/jwt.utilities.ts';
import { VerifiedDpopProof } from '../strategies/jwt/verified-dpop-proof.model.ts';

/**
 * What a proof may be signed with.
 */
const DPOP_ALGORITHMS: JwtAsymmetricAlgorithm[] = ['ES256', 'ES384', 'ES512', 'EdDSA', 'RS256'];

/**
 * How long ago a proof may have been issued, and how far ahead of the clock it may claim to be. A proof
 * is remembered as presented for twice as long, so this bounds how long that is.
 */
const PROOF_MAX_AGE_IN_MS: number = 5 * Ms.MINUTE;

/**
 * How long a nonce the application issued is taken.
 */
const NONCE_LIFETIME_IN_MS: number = 5 * Ms.MINUTE;

/**
 * Default implementation of the service checking the DPoP proofs of requests.
 */
@Injectable({ register: 'onUse' })
export class DpopService implements DpopServiceInterface {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly algorithms: JwtAsymmetricAlgorithm[] = DPOP_ALGORITHMS;

    /**
     * What the proof of each request resolved to, by the access token it was checked against. Keyed by
     * the context, so an entry is gone when the request is: a proof is spent the first time it is
     * checked, and every later check of the same request has to give the same answer.
     */
    private readonly checked: WeakMap<
        HttpRequestContext | WebsocketRequestContext,
        Map<string, Promise<string | undefined>>
    > = new WeakMap();

    constructor(
        // a nonce costs a client a round trip, and keeps a proof it signed ahead of time from being
        // worth anything
        @Inject(ZIBRI_DI_TOKENS.DPOP_NONCES)
        private readonly nonces: boolean,
        @Inject(ZIBRI_DI_TOKENS.JWT_SERVICE)
        private readonly jwtService: JwtServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.LEASE_SERVICE)
        private readonly leaseService: LeaseServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveProofThumbprint(
        context: HttpRequestContext | WebsocketRequestContext,
        accessToken: string | undefined
    ): Promise<string | undefined> {
        const known: Map<string, Promise<string | undefined>> = this.checked.get(context) ?? new Map<string, Promise<string | undefined>>();
        const key: string = accessToken ?? '';
        const pending: Promise<string | undefined> = known.get(key) ?? this.resolveCheckedProof(context, accessToken);
        known.set(key, pending);
        this.checked.set(context, known);
        return await pending;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async isSentAsBound(
        context: HttpRequestContext | WebsocketRequestContext,
        token: AuthorizationToken,
        keyThumbprint: string | undefined
    ): Promise<boolean> {
        if (keyThumbprint == undefined) {
            // a bearer token sent with the DPoP scheme would be taken for one bound to a key (RFC 9449, 7.1)
            return token.scheme === 'Bearer';
        }
        // and a bound one sent as a bearer token is the downgrade the binding is there to refuse
        return token.scheme === 'DPoP' && await this.resolveProofThumbprint(context, token.value) === keyThumbprint;
    }

    /**
     * Checks the DPoP proof of a request, and spends it.
     * @param context - The context of the request.
     * @param accessToken - The access token the request sends, if it sends one.
     * @returns The thumbprint of the key the proof is signed with, or undefined when the request carries
     * none.
     * @throws An OAuth2Error when the proof is not valid, or carries no nonce the application issued.
     */
    private async resolveCheckedProof(
        context: HttpRequestContext | WebsocketRequestContext,
        accessToken: string | undefined
    ): Promise<string | undefined> {
        // a websocket message carries headers its client wrote into it, and has no method or url
        if (context.type !== 'http-request') {
            return undefined;
        }
        const header: string | undefined = context.request.headers[KnownHeader.DPOP];
        if (header == undefined) {
            return undefined;
        }
        // a header sent twice arrives joined by a comma, which no jwt holds
        const proof: VerifiedDpopProof | undefined = header.includes(',')
            ? undefined
            : await JwtUtilities.verifyDpopProof(header, this.algorithms, PROOF_MAX_AGE_IN_MS);
        const jwtId: unknown = proof?.payload['jti'];
        if (proof == undefined || typeof jwtId !== 'string' || !this.isForRequest(proof, context, accessToken)) {
            throw this.toRefusal(
                OAuth2ErrorCode.INVALID_DPOP_PROOF,
                $ts`The DPoP proof is not valid for this request.`,
                accessToken,
                undefined
            );
        }
        if (this.nonces && !await this.hasNonce(proof)) {
            throw this.toRefusal(
                OAuth2ErrorCode.USE_DPOP_NONCE,
                $ts`The DPoP proof carries no nonce the application issued.`,
                accessToken,
                await this.jwtService.sign({}, { type: 'dpop-nonce+jwt', expiresInMs: NONCE_LIFETIME_IN_MS, audience: undefined })
            );
        }
        // kept rather than handed back, for as long as the proof could be presented: it is the record
        // that the proof was spent, on every replica. Hashed, since the client chooses the id
        const first: boolean | undefined = await this.leaseService.withLease(
            {
                key: `dpop-proof:${proof.jwkThumbprint}:${createHash('sha256').update(jwtId)
                    .digest('base64url')}`,
                leaseInMs: 2 * PROOF_MAX_AGE_IN_MS,
                mode: 'skip',
                onCompletion: 'retain'
            },
            () => Promise.resolve(true)
        );
        if (first !== true) {
            throw this.toRefusal(OAuth2ErrorCode.INVALID_DPOP_PROOF, $ts`The DPoP proof was presented before.`, accessToken, undefined);
        }
        return proof.jwkThumbprint;
    }

    /**
     * Whether a proof is for the request it came with: its method, its url without the query, and the
     * access token it sends.
     * @param proof - The verified proof.
     * @param context - The context of the request.
     * @param accessToken - The access token the request sends, if it sends one.
     * @returns True when it is.
     */
    private isForRequest(proof: VerifiedDpopProof, context: HttpRequestContext, accessToken: string | undefined): boolean {
        const method: unknown = proof.payload['htm'];
        const url: unknown = proof.payload['htu'];
        if (method !== context.request.method || typeof url !== 'string' || !URL.canParse(url)) {
            return false;
        }
        // the url the client reaches the application at, which is below its baseUrl. Compared after
        // the normalizing parsing does, without query and fragment (RFC 9449, 4.3)
        const expected: URL = new URL(`${this.jwtService.issuer}${context.request.originalUrl.split('?')[0] ?? ''}`);
        const actual: URL = new URL(url);
        if (`${actual.origin}${actual.pathname}` !== `${expected.origin}${expected.pathname}`) {
            return false;
        }
        return accessToken == undefined || proof.payload['ath'] === createHash('sha256').update(accessToken)
            .digest('base64url');
    }

    /**
     * Whether a proof carries a nonce the application issued, which has not expired.
     * @param proof - The verified proof.
     * @returns True when it does.
     */
    private async hasNonce(proof: VerifiedDpopProof): Promise<boolean> {
        const nonce: unknown = proof.payload['nonce'];
        return typeof nonce === 'string'
            && await this.jwtService.verify(nonce, { type: 'dpop-nonce+jwt', audience: undefined }) != undefined;
    }

    /**
     * What a request with a proof that is refused is answered with.
     * @param error - Why it is refused.
     * @param description - Why, for whoever reads it.
     * @param accessToken - The access token the request sends, which makes it a request to a resource.
     * @param dpopNonce - A new nonce to sign the next proof with, if any.
     * @returns The error to throw.
     */
    private toRefusal(
        error: OAuth2ErrorCode,
        description: TranslatedString,
        accessToken: string | undefined,
        dpopNonce: string | undefined
    ): OAuth2Error {
        // a resource challenges with its scheme, and a route issuing tokens answers like a token endpoint
        return accessToken == undefined
            ? new OAuth2Error(error, description, { dpopNonce })
            : new OAuth2Error(error, description, {
                status: HttpStatus.UNAUTHORIZED,
                // cspell:disable-next-line
                challenge: `DPoP error="${error}", algs="${this.algorithms.join(' ')}"`,
                dpopNonce
            });
    }
}