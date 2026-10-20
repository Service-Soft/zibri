import { createHash, generateKeyPairSync, JsonWebKey, KeyObject, randomBytes, sign } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { JsonUtilities, KnownHeader, MimeType } from 'zibri';

import { FakeJwtAccessTokenOptions } from './fake-jwt-access-token-options.model.ts';
import { FakeOAuthApiRequest } from './fake-oauth-api-request.model.ts';
import { FakeOAuthIdentity } from './fake-oauth-identity.model.ts';
import { FakeOAuthProviderOptions } from './fake-oauth-provider-options.model.ts';

/**
 * The claims of an ID token, before it is signed.
 */
export type FakeOidcIdTokenClaims = Record<string, unknown>;

/**
 * The keys the provider signs its ID tokens with.
 */
type SigningKeyPair = {
    /**
     * Signs.
     */
    privateKey: KeyObject,
    /**
     * Is published in the key set.
     */
    publicKey: KeyObject
};

/**
 * A code the provider handed out, and what it was handed out for.
 */
type IssuedCode = {
    /**
     * The callback the sign-in was started with, which the exchange has to name again.
     */
    redirectUri: string,
    /**
     * The PKCE challenge the sign-in was started with.
     */
    codeChallenge: string,
    /**
     * The nonce the sign-in was started with, which the ID token carries.
     */
    nonce: string | undefined,
    /**
     * Who signed in.
     */
    identity: FakeOAuthIdentity,
    /**
     * When they signed in.
     */
    authenticatedAt: Date,
    /**
     * The scopes the user granted.
     */
    scopes: string[],
    /**
     * Whether the sign-in asked for access while the user is away, which a refresh token gives.
     */
    offline: boolean
};

/**
 * What the user allowed the client, which a refresh token stands for.
 */
type Grant = {
    /**
     * Who allowed it.
     */
    identity: FakeOAuthIdentity,
    /**
     * The scopes they granted.
     */
    scopes: string[]
};

/**
 * An access token the provider handed out.
 */
type IssuedAccessToken = {
    /**
     * Who it was issued for.
     */
    identity: FakeOAuthIdentity,
    /**
     * When it stops being accepted, in milliseconds since the epoch.
     */
    expiresAt: number,
    /**
     * The refresh token of the grant it was issued under, if any.
     */
    refreshToken: string | undefined
};

/**
 * A provider running in the test's own process. It speaks OpenID Connect, or plain OAuth2 when it
 * issues no ID tokens.
 *
 * It signs in whoever `identity` says without asking anything, and keeps what it was asked, so a test
 * can drive a sign-in end to end and see what the application sent.
 */
export class FakeOAuthProvider {
    /**
     * Who the next sign-in signs in as.
     */
    identity: FakeOAuthIdentity = { subject: 'fake-subject', email: 'fake@example.com', emailVerified: true };

    /**
     * When the next sign-in says the user signed in at the provider. Now, when undefined.
     */
    authenticatedAt: Date | undefined;

    /**
     * The query of every sign-in the provider was asked for, in order.
     */
    readonly authorizationRequests: URLSearchParams[] = [];

    /**
     * The body of every request to the token endpoint, in order: the exchanges of codes, and the
     * refreshes.
     */
    readonly tokenRequests: URLSearchParams[] = [];

    /**
     * What every sign-in answered with posted to the callback, in order, when the provider answers with a
     * form post.
     */
    readonly formPosts: URLSearchParams[] = [];

    /**
     * The scopes the user leaves out whenever they are asked for them, the way a consent screen with a
     * checkbox per scope lets them.
     */
    declinedScopes: string[] = [];

    /**
     * Every token the client handed back at the revocation endpoint, in order.
     */
    readonly revokedTokens: string[] = [];

    /**
     * Every request to the provider's api, in order, whether the provider answers it or not.
     */
    readonly apiRequests: FakeOAuthApiRequest[] = [];

    private readonly server: Server;
    private readonly codes: Map<string, IssuedCode> = new Map();
    // whoever each access token was issued for, which the resources answer about
    private readonly accessTokens: Map<string, IssuedAccessToken> = new Map();
    private readonly refreshTokens: Map<string, Grant> = new Map();
    private readonly keyId: string = randomBytes(8).toString('hex');
    private readonly privateKey: KeyObject;
    private readonly publicKey: KeyObject;
    private readonly algorithm: 'ES256' | 'RS256' | 'EdDSA';
    private deniedWith: string | undefined;
    private nextAnswerFields: Record<string, string> = {};
    private rewriteIdToken: ((claims: FakeOidcIdTokenClaims) => FakeOidcIdTokenClaims) | undefined;
    private url: string | undefined;

    constructor(private readonly options: FakeOAuthProviderOptions) {
        this.algorithm = options.algorithm ?? 'ES256';
        const pair: SigningKeyPair = this.algorithm === 'ES256'
            ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
            : this.algorithm === 'RS256'
                ? generateKeyPairSync('rsa', { modulusLength: 2048 })
                : generateKeyPairSync('ed25519');
        this.privateKey = pair.privateKey;
        this.publicKey = pair.publicKey;
        this.server = createServer((req, res) => void this.handle(req, res));
    }

    /**
     * The issuer url, which is where the provider is reached.
     * @returns The issuer.
     * @throws When the provider has not been started.
     */
    get issuer(): string {
        if (this.url == undefined) {
            throw new Error('The fake provider has not been started.');
        }
        return this.url;
    }

    /**
     * Starts listening on a free port of the loopback interface.
     */
    async listen(): Promise<void> {
        await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
        const address: AddressInfo | string | null = this.server.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('The fake provider is not listening on a port.');
        }
        this.url = `http://127.0.0.1:${address.port}`;
    }

    /**
     * Answers the next sign-in with the given error rather than a code, as a provider does when the user
     * declines or something goes wrong there.
     * @param error - The error, eg. `access_denied`.
     */
    denyNext(error: string): void {
        this.deniedWith = error;
    }

    /**
     * Adds fields to the next answer, next to the code, the way Apple sends the user's name.
     * @param fields - The fields, by name.
     */
    addToNextAnswer(fields: Record<string, string>): void {
        this.nextAnswerFields = { ...this.nextAnswerFields, ...fields };
    }

    /**
     * Changes the claims of the next ID token before it is signed, to see that the application refuses a
     * token that is wrong.
     * @param rewrite - Gets the claims and returns the ones to sign.
     */
    rewriteNextIdToken(rewrite: (claims: FakeOidcIdTokenClaims) => FakeOidcIdTokenClaims): void {
        this.rewriteIdToken = rewrite;
    }

    /**
     * Signs an access token for an api as a jwt (RFC 9068), for whoever `identity` says, the way a
     * provider issues one to a mobile app or a service that then calls the api with it.
     * @param options - The api it is for, its `typ`, and claims on top.
     * @returns The token.
     */
    createJwtAccessToken(options: FakeJwtAccessTokenOptions): string {
        const now: number = Math.floor(Date.now() / 1000);
        return this.signJwt(options.type ?? 'at+jwt', {
            iss: this.issuer,
            sub: this.identity.subject,
            aud: options.audience,
            client_id: this.options.clientId,
            iat: now,
            exp: now + 300,
            jti: randomBytes(12).toString('hex'),
            auth_time: Math.floor((this.authenticatedAt ?? new Date()).getTime() / 1000),
            ...options.claims
        });
    }

    /**
     * Signs an ID token for whoever `identity` says, issued to the given client, the way a mobile app
     * holds one once the user signed in there.
     * @param audience - The `aud` claim: the client the app signed in as.
     * @param claims - Claims put in on top of the ones every ID token carries, or in their place.
     * @returns The token.
     */
    createIdToken(audience: string, claims: FakeOidcIdTokenClaims = {}): string {
        const now: number = Math.floor(Date.now() / 1000);
        return this.signJwt('JWT', {
            iss: this.issuer,
            sub: this.identity.subject,
            aud: audience,
            iat: now,
            exp: now + 300,
            auth_time: Math.floor((this.authenticatedAt ?? new Date()).getTime() / 1000),
            email: this.identity.email,
            ...claims
        });
    }

    /**
     * Withdraws everything a user allowed the client, the way removing an app from the account at the
     * provider does: their refresh tokens are refused from then on, and so are their access tokens.
     * @param subject - Who the user is at the provider.
     */
    revokeGrantsOf(subject: string): void {
        for (const [token, grant] of this.refreshTokens) {
            if (grant.identity.subject === subject) {
                this.refreshTokens.delete(token);
            }
        }
        for (const [token, issued] of this.accessTokens) {
            if (issued.identity.subject === subject) {
                this.accessTokens.delete(token);
            }
        }
    }

    /**
     * Stops the provider.
     */
    async stop(): Promise<void> {
        await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url: URL = new URL(req.url ?? '/', this.issuer);
        switch (url.pathname) {
            case '/.well-known/openid-configuration': {
                this.sendJson(res, 200, {
                    issuer: this.issuer,
                    authorization_endpoint: `${this.issuer}/authorize`,
                    token_endpoint: `${this.issuer}/token`,
                    jwks_uri: `${this.issuer}/jwks`,
                    revocation_endpoint: `${this.issuer}/revoke`,
                    response_types_supported: ['code'],
                    subject_types_supported: ['public'],
                    id_token_signing_alg_values_supported: [this.algorithm],
                    code_challenge_methods_supported: ['S256'],
                    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
                    scopes_supported: ['openid', 'email', 'profile']
                });
                return;
            }
            case '/jwks': {
                const jwk: JsonWebKey = this.publicKey.export({ format: 'jwk' });
                this.sendJson(res, 200, { keys: [{ ...jwk, kid: this.keyId, alg: this.algorithm, use: 'sig' }] });
                return;
            }
            case '/authorize': {
                this.authorize(url.searchParams, res);
                return;
            }
            case '/token': {
                await this.token(new URLSearchParams(await this.readBody(req)), req.headers.authorization, res);
                return;
            }
            case '/revoke': {
                await this.revoke(new URLSearchParams(await this.readBody(req)), req.headers.authorization, res);
                return;
            }
            default: {
                this.apiRequests.push({
                    method: req.method ?? 'GET',
                    path: url.pathname,
                    authorization: req.headers.authorization,
                    body: await this.readBody(req)
                });
                this.answerResource(url.pathname, req.headers.authorization, res);
            }
        }
    }

    private answerResource(path: string, authorization: string | undefined, res: ServerResponse): void {
        const resource: ((identity: FakeOAuthIdentity) => unknown) | undefined = this.options.resources?.[path];
        if (resource == undefined) {
            this.sendJson(res, 404, { error: 'not_found' });
            return;
        }
        const issued: IssuedAccessToken | undefined = authorization?.startsWith('Bearer ') === true
            ? this.accessTokens.get(authorization.slice('Bearer '.length))
            : undefined;
        if (issued == undefined || issued.expiresAt <= Date.now()) {
            this.sendJson(res, 401, { error: 'invalid_token' });
            return;
        }
        res.writeHead(200, { [KnownHeader.CONTENT_TYPE]: MimeType.JSON });
        res.end(JsonUtilities.stringify(resource(issued.identity)));
    }

    private authorize(query: URLSearchParams, res: ServerResponse): void {
        this.authorizationRequests.push(query);
        const redirectUri: string | null = query.get('redirect_uri');
        const codeChallenge: string | null = query.get('code_challenge');
        if (query.get('client_id') !== this.options.clientId || redirectUri == undefined) {
            this.sendJson(res, 400, { error: 'invalid_request' });
            return;
        }
        const prompts: string[] = query.get('prompt')?.split(' ') ?? [];
        const unsupported: string | undefined = prompts.find(prompt => this.options.supportedPrompts?.includes(prompt) === false);
        if (unsupported != undefined) {
            // an error page shown to the user rather than an answer sent back to the application, as
            // Google does
            this.sendJson(res, 400, { error: 'invalid_request', error_description: `Invalid prompt: ${unsupported}` });
            return;
        }
        const answer: URLSearchParams = new URLSearchParams();
        const state: string | null = query.get('state');
        if (state != undefined) {
            answer.set('state', state);
        }
        if (this.deniedWith != undefined) {
            answer.set('error', this.deniedWith);
            this.deniedWith = undefined;
        }
        else if (codeChallenge == undefined || query.get('code_challenge_method') !== 'S256' || query.get('response_type') !== 'code') {
            answer.set('error', 'invalid_request');
        }
        else {
            const code: string = randomBytes(24).toString('base64url');
            const scopes: string[] = (query.get('scope') ?? '').split(' ').filter(scope => scope !== '');
            this.codes.set(code, {
                redirectUri,
                codeChallenge,
                nonce: query.get('nonce') ?? undefined,
                identity: { ...this.identity },
                authenticatedAt: this.authenticatedAt ?? new Date(),
                scopes: scopes.filter(scope => !this.declinedScopes.includes(scope)),
                // the two ways providers are asked for it: OpenID Connect's scope, and Google's parameter
                offline: scopes.includes('offline_access') || query.get('access_type') === 'offline'
            });
            answer.set('code', code);
        }
        for (const [name, value] of Object.entries(this.nextAnswerFields)) {
            answer.set(name, value);
        }
        this.nextAnswerFields = {};

        if (this.options.formPost === true) {
            this.formPosts.push(answer);
            const fields: string = [...answer.entries()]
                .map(([name, value]) => `<input type="hidden" name="${name}" value="${value}">`)
                .join('');
            res.writeHead(200, { [KnownHeader.CONTENT_TYPE]: MimeType.HTML });
            res.end(`<form method="post" action="${redirectUri}">${fields}</form><script>document.forms[0].submit()</script>`);
            return;
        }
        res.writeHead(302, { [KnownHeader.LOCATION]: `${redirectUri}?${answer.toString()}` });
        res.end();
    }

    private async token(body: URLSearchParams, authorization: string | undefined, res: ServerResponse): Promise<void> {
        this.tokenRequests.push(body);
        if (!await this.isClientAuthenticated(body, authorization)) {
            this.sendJson(res, 401, { error: 'invalid_client' });
            return;
        }
        if (body.get('grant_type') === 'refresh_token') {
            this.refresh(body.get('refresh_token'), res);
            return;
        }
        const code: string | null = body.get('code');
        const issued: IssuedCode | undefined = code == undefined ? undefined : this.codes.get(code);
        const verifier: string | null = body.get('code_verifier');
        if (
            body.get('grant_type') !== 'authorization_code'
            || code == undefined
            || issued?.redirectUri !== body.get('redirect_uri')
            || verifier == undefined
            || createHash('sha256').update(verifier).digest('base64url') !== issued.codeChallenge
        ) {
            this.sendJson(res, 400, { error: 'invalid_grant' });
            return;
        }
        this.codes.delete(code);

        const now: number = Math.floor(Date.now() / 1000);
        const claims: FakeOidcIdTokenClaims = {
            iss: this.issuer,
            sub: issued.identity.subject,
            aud: this.options.clientId,
            iat: now,
            exp: now + 300,
            auth_time: Math.floor(issued.authenticatedAt.getTime() / 1000),
            nonce: issued.nonce,
            email: issued.identity.email,
            email_verified: issued.identity.emailVerified,
            name: issued.identity.name,
            given_name: issued.identity.givenName,
            family_name: issued.identity.familyName
        };
        const rewrite: ((claims: FakeOidcIdTokenClaims) => FakeOidcIdTokenClaims) | undefined = this.rewriteIdToken;
        this.rewriteIdToken = undefined;
        const grant: Grant = { identity: issued.identity, scopes: issued.scopes };
        const refreshToken: string | undefined = issued.offline ? this.issueRefreshToken(grant) : undefined;
        this.sendJson(res, 200, {
            ...this.issueAccessToken(grant, refreshToken),
            ...refreshToken == undefined ? {} : { refresh_token: refreshToken },
            ...this.options.issuesIdToken === false
                ? {}
                : { id_token: this.signJwt('JWT', rewrite == undefined ? claims : rewrite(claims)) }
        });
    }

    private refresh(refreshToken: string | null, res: ServerResponse): void {
        const grant: Grant | undefined = refreshToken == undefined ? undefined : this.refreshTokens.get(refreshToken);
        if (refreshToken == undefined || grant == undefined) {
            this.sendJson(res, 400, { error: 'invalid_grant' });
            return;
        }
        let current: string = refreshToken;
        if (this.options.rotatesRefreshTokens === true) {
            this.refreshTokens.delete(refreshToken);
            current = this.issueRefreshToken(grant);
        }
        this.sendJson(res, 200, {
            ...this.issueAccessToken(grant, current),
            ...current === refreshToken ? {} : { refresh_token: current }
        });
    }

    private async revoke(body: URLSearchParams, authorization: string | undefined, res: ServerResponse): Promise<void> {
        if (!await this.isClientAuthenticated(body, authorization)) {
            this.sendJson(res, 401, { error: 'invalid_client' });
            return;
        }
        const token: string | null = body.get('token');
        if (token != undefined) {
            this.revokedTokens.push(token);
            // a refresh token stands for the whole grant, so handing it back ends its access tokens too
            this.refreshTokens.delete(token);
            this.accessTokens.delete(token);
            for (const [accessToken, issued] of this.accessTokens) {
                if (issued.refreshToken === token) {
                    this.accessTokens.delete(accessToken);
                }
            }
        }
        // answered with success whether the token was known or not, as RFC 7009 has it
        res.writeHead(200);
        res.end();
    }

    private issueAccessToken(grant: Grant, refreshToken: string | undefined): Record<string, unknown> {
        const accessToken: string = randomBytes(24).toString('base64url');
        const expiresIn: number = this.options.accessTokenExpiresInSeconds ?? 300;
        this.accessTokens.set(accessToken, { identity: grant.identity, expiresAt: Date.now() + (expiresIn * 1000), refreshToken });
        return { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn, scope: grant.scopes.join(' ') };
    }

    private issueRefreshToken(grant: Grant): string {
        const refreshToken: string = randomBytes(24).toString('base64url');
        this.refreshTokens.set(refreshToken, grant);
        return refreshToken;
    }

    private async isClientAuthenticated(body: URLSearchParams, authorization: string | undefined): Promise<boolean> {
        const [id, secret] = authorization?.startsWith('Basic ') === true
            ? Buffer.from(authorization.slice('Basic '.length), 'base64')
                .toString('utf8')
                .split(':')
                .map(part => decodeURIComponent(part.replaceAll('+', ' ')))
            : [body.get('client_id'), body.get('client_secret')];
        if (id !== this.options.clientId || secret == undefined) {
            return false;
        }
        return typeof this.options.clientSecret === 'string'
            ? secret === this.options.clientSecret
            : await this.options.clientSecret(secret);
    }

    private signJwt(type: string, claims: FakeOidcIdTokenClaims): string {
        const encode: (value: object) => string = value => Buffer.from(JsonUtilities.stringify(value)).toString('base64url');
        const input: string = `${encode({ alg: this.algorithm, typ: type, kid: this.keyId })}.${encode(claims)}`;
        const signature: Buffer = this.algorithm === 'EdDSA'
            ? sign(undefined, Buffer.from(input), this.privateKey)
            : sign(
                'sha256',
                Buffer.from(input),
                this.algorithm === 'ES256' ? { key: this.privateKey, dsaEncoding: 'ieee-p1363' } : this.privateKey
            );
        return `${input}.${signature.toString('base64url')}`;
    }

    private async readBody(req: IncomingMessage): Promise<string> {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        return Buffer.concat(chunks).toString('utf8');
    }

    private sendJson(res: ServerResponse, status: number, body: object): void {
        res.writeHead(status, { [KnownHeader.CONTENT_TYPE]: MimeType.JSON });
        res.end(JsonUtilities.stringify(body));
    }
}