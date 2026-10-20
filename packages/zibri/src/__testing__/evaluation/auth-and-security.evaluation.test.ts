import assert from 'node:assert';
import { CipherGCM, createCipheriv, createDecipheriv, DecipherGCM, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi, MockInstance } from 'vitest';

import { OtpCredentials } from '../../auth/2fa/methods/otp/otp-credentials.model.ts';
import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method.ts';
import { type TwoFactorServiceInterface } from '../../auth/2fa/two-factor-service.interface.ts';
import { PasswordCredentials } from '../../auth/authenticators/password/password-credentials.model.ts';
import { Auth } from '../../auth/decorators/auth.decorator.ts';
import { EncryptionKey, EncryptionKeyStatus } from '../../auth/encryption/encryption-key.model.ts';
import { EncryptionMasterOptions } from '../../auth/encryption/encryption-master-options.model.ts';
import { EncryptionRotationCronJob } from '../../auth/encryption/encryption-rotation.cron-job.ts';
import { type EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface.ts';
import { EncryptionContent, EncryptionString, EncryptionUtilities } from '../../auth/encryption/encryption.utilities.ts';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy.ts';
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionStrategyInterface } from '../../auth/encryption/strategies/encryption-strategy.interface.ts';
import { type HashServiceInterface } from '../../auth/hash/hash-service.interface.ts';
import { BaseUser } from '../../auth/models/base-user.model.ts';
import { PasswordResetToken } from '../../auth/models/password-reset-token.model.ts';
import { CookieAuthRefreshSession } from '../../auth/strategies/cookie/cookie-auth-refresh-session.model.ts';
import { CookieAuthSession } from '../../auth/strategies/cookie/cookie-auth-session.model.ts';
import { JwtRefreshToken } from '../../auth/strategies/jwt/jwt-refresh-token.model.ts';
import { type HttpRequestContext } from '../../context/request/http-request.context.ts';
import { type WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model.ts';
import { Log } from '../../logging/log.model.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { type RateLimiterInterface } from '../../rate-limiting/limiter/rate-limiter.interface.ts';
import { InMemoryRateLimiterStore } from '../../rate-limiting/stores/in-memory.rate-limiter-store.ts';
import { type BaseRateLimitState, type RateLimiterStoreInterface } from '../../rate-limiting/stores/rate-limiter-store.interface.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Post } from '../../routing/decorators/post.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { Ms } from '../../utilities/ms.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { JwtTestAuthController } from '../mocks/controllers/jwt-test-auth.controller.ts';
import { JwtUser } from '../mocks/entities/jwt-user.entity.ts';
import { Roles } from '../mocks/entities/roles.enum.ts';
import { createTestDataSource } from '../test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders, testMasterKey } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * Executable form of evaluation/03-auth-and-security.md.
 *
 * Observations are made against real state: the Log table the framework writes through its real db
 * transport, the entity metadata the framework itself reads, and real HTTP round trips. Findings
 * that need a flow this file cannot drive (a full login, an enrolled second factor, a configured
 * cookie strategy) are tested in the file that can, and named in a comment here. The `it.todo`s left
 * are capabilities that do not exist yet.
 *
 * Every expectation describes the fixed behavior, so this file is red until the corresponding
 * finding is closed. See ./README.md for why.
 */

/**
 * A route with no auth metadata at all, beside one that says it has none on purpose.
 *
 * The pair is the point: an application that declared `requireLogin` has to be able to tell the
 * route somebody forgot from the route somebody meant, and a decorator is the only place that
 * distinction can live.
 */
@Controller('/evaluation-unprotected')
class EvaluationUnprotectedController {
    @Get('/resource')
    resource(): string {
        return 'anyone can read this';
    }

    @Get('/declared-public')
    @Auth.skip()
    declaredPublic(): string {
        return 'and this one says so';
    }
}

/**
 * Hands back what the cookie middleware made of the request's Cookie header.
 *
 * Over http rather than by calling the parser directly, because the claim in F3 is about what a
 * session lookup sees after express has joined the header - not about what one function returns.
 */
@Controller('/evaluation-cookies')
class EvaluationCookieController {
    @Get('/parsed')
    @Auth.skip()
    parsed(): Record<string, string> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (context?.type !== 'http-request') {
            throw new Error('expected an http request context');
        }
        // express types req.cookies as any, and this is the one place the test has to touch it
        // eslint-disable-next-line typescript/no-unsafe-return
        return context.request.cookies;
    }

    /**
     * A public route that changes something on the cookie's authority, which is the shape F4 says the
     * csrf check never reaches: it resolves no session, so the cookie strategy never runs.
     * @returns Anything at all - only the status is read.
     */
    @Post('/act')
    @Auth.skip()
    act(): string {
        return 'acted';
    }
}

/**
 * What a strategy backed by a kms or an hsm is handed instead of key material.
 */
type RemoteKeyHandle = {
    /**
     * What the remote store knows this key as. An arn, a label, a slot - never the bytes.
     */
    keyRef: string
};

const remoteMasterKeyRef: string = 'projects/zibri/keys/master';

/**
 * Stands in for the key store a kms would be.
 *
 * Deliberately not reachable from anything the framework touches: the point of the test is that the
 * only thing crossing into the application is `remoteMasterKeyRef`.
 */
const remoteKeyStore: Map<string, Buffer> = new Map([[remoteMasterKeyRef, randomBytes(32)]]);

/**
 * A master strategy whose key never enters the process.
 *
 * Written out rather than wrapping `AesGcmEncryptionStrategy`, because what is being demonstrated is
 * that `EncryptionStrategyInterface` is implementable by something that resolves its key elsewhere
 * and answers asynchronously - and reusing the builtin would hide exactly that.
 */
class RemoteMasterStrategy implements EncryptionStrategyInterface<RemoteKeyHandle> {
    readonly name: string = 'remote-kms';
    readonly version: string = 'v1';
    readonly usableInMigrations: boolean = false;

    async encrypt(value: string, options: BaseEncryptOptions<RemoteKeyHandle>): Promise<EncryptionString> {
        const key: Buffer = await this.resolve(options.key);
        const iv: Buffer = randomBytes(12);
        const cipher: CipherGCM = createCipheriv('aes-256-gcm', key, iv);
        const encrypted: Buffer = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

        return EncryptionUtilities.contentToEncryptionString({
            strategyName: this.name,
            version: this.version,
            keyId: options.keyId,
            encryptedValue: [
                iv.toString('base64'),
                cipher.getAuthTag().toString('base64'),
                encrypted.toString('base64')
            ].join('.')
        });
    }

    async decrypt(value: EncryptionString, options: BaseDecryptOptions<RemoteKeyHandle>): Promise<string> {
        const key: Buffer = await this.resolve(options.key);
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(value);
        const [ivB64, tagB64, contentB64] = content.encryptedValue.split('.');
        if (ivB64 == undefined || tagB64 == undefined || contentB64 == undefined) {
            throw new Error('not a value this strategy wrote');
        }

        const decipher: DecipherGCM = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([
            decipher.update(Buffer.from(contentB64, 'base64')),
            decipher.final()
        ]).toString('utf8');
    }

    // a master strategy wraps data keys, which belong to no row
    isBoundToRow(): boolean {
        return false;
    }

    generateRandomKey(): RemoteKeyHandle {
        const keyRef: string = `${remoteMasterKeyRef}/${UUIDUtilities.generate()}`;
        remoteKeyStore.set(keyRef, randomBytes(32));
        return { keyRef };
    }

    serializeKey(key: RemoteKeyHandle): Buffer {
        return Buffer.from(key.keyRef, 'utf8');
    }

    deserializeKey(raw: Buffer): RemoteKeyHandle {
        return { keyRef: raw.toString('utf8') };
    }

    /**
     * The one place key material exists, standing in for a call to the remote service.
     * @param handle - The reference the application was configured with.
     * @returns The key the reference names.
     * @throws When the remote store does not know the reference.
     */
    private async resolve(handle: RemoteKeyHandle): Promise<Buffer> {
        const key: Buffer | undefined = remoteKeyStore.get(handle.keyRef);
        if (!key) {
            throw new Error(`no key behind "${handle.keyRef}"`);
        }
        return await Promise.resolve(key);
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;
let logRepository: Repository<Log>;

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        // the framework's own auth routes, because B4, E1 and G1 are all about what those answer.
        // Without them every one of those tests failed on its own 404 guard rather than on the
        // finding it describes.
        controllers: [EvaluationUnprotectedController, EvaluationCookieController, JwtTestAuthController],
        // the posture A1 is about being able to declare at all. The rest of this file is unaffected
        // by it: every route it drives is either on JwtTestAuthController, which states its own, or is
        // the undecorated one A1 exists to talk about.
        defaultAuth: 'requireLogin',
        // the numbers the framework ships with, since E1 is about what a deployment gets by default.
        // The test server otherwise raises them out of the way so that suites which merely *use* the
        // auth endpoints are not answered 429 halfway through.
        providers: [
            ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS),
            defineProvider({
                token: ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS,
                useFactory: () => ({ maxAttempts: 20, windowInMs: Ms.MINUTE * 10 })
            })
        ]
    });
    baseUrl = await server.start();
    logRepository = inject(repositoryTokenFor(Log));
}, 60000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

/**
 * Empties the log table, including anything still queued.
 *
 * Flushed first: the logger hands its transports work later, so an entry produced by an earlier test
 * can still be in the buffer when this runs and would land *after* the delete - showing up as a row
 * the test under way never caused.
 */
async function clearLogs(): Promise<void> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    await logRepository.deleteAll({});
}

/**
 * Everything logged so far, oldest first.
 *
 * Flushed rather than read straight away: the logger queues and hands its transports work later, so
 * a test that reads the table immediately is reading it before the write - which matters most for
 * the assertions that expect to find nothing.
 * @returns The persisted log entries.
 */
async function allLogs(): Promise<Log[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return await logRepository.findAll({});
}

/**
 * The audit blocks of everything logged so far.
 * @returns Whatever each entry carries under `context.metadata.audit`.
 */
async function auditEvents(): Promise<unknown[]> {
    return (await allLogs()).map(l => l.context.metadata?.['audit']);
}

/**
 * Gives the caller its attempts back.
 *
 * The limit is per caller and every test here is the same caller, so a suite that deliberately
 * exhausts it (E1) would otherwise decide what every later test observes. `delete` on the store
 * exists for exactly this.
 */
async function resetAuthRateLimit(): Promise<void> {
    // the di token is declared as RateLimiterInterface<any>, so naming the state here is the only
    // way to get a typed store back out of it. Nothing below touches the state itself.
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const limiter: RateLimiterInterface<BaseRateLimitState> = inject(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER);
    for (const key of await limiter.config.store.keys()) {
        await limiter.config.store.delete(key);
    }
}

describe('evaluation/03-auth-and-security', () => {

    describe('A1 - routes must not be open by default', () => {
        it('refuses an undecorated route to an anonymous caller', async () => {
            const res: Response = await fetch(`${baseUrl}/evaluation-unprotected/resource`);

            // the finding: every branch of checkAccess was skipped for a route carrying no @Auth
            // metadata, so a forgotten @Auth.hasRole shipped a world writable endpoint with no
            // build error, no warning and no failing test. This server declares `requireLogin`,
            // which is the answer to "what should a route that says nothing get".
            //
            // Also the fixture guard the old first case was: 404 would fail this outright, so a
            // renamed route cannot pass by accident.
            expect(res.status).toBe(401);
        });

        it('serves a route that declares itself public', async () => {
            const res: Response = await fetch(`${baseUrl}/evaluation-unprotected/declared-public`);

            // the other half, and the reason the default cannot simply be "deny": a public endpoint
            // has to stay expressible, and saying so has to be something a reader can see on the
            // route rather than infer from its absence
            expect(res.status).toBe(200);
        });

        it('leaves the framework\'s own auth routes reachable', async () => {
            const res: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JsonUtilities.stringify({ email: 'definitely-not-registered@example.com' })
            });

            // a controller shipped by the framework cannot know which default the application
            // picked, and these are the routes a caller uses to stop being anonymous - if the
            // application wide requirement reached them, `requireLogin` would be an api nobody
            // could ever log into.
            //
            // Asserted as "not 401" rather than as a success on purpose: what this route answers
            // for an unknown address is B4's business and B4 is still open, so pinning the status
            // here would make this test fail for somebody else's finding. Only the handler can
            // produce anything other than 401, which is the whole claim.
            expect(res.status).not.toBe(401);
        });
    });

    // A3 - access tokens must be revocable - is asserted in
    // ./auth-sessions-and-2fa.evaluation.test.ts, which boots a server with a login flow and can
    // therefore obtain a real token and then change the account behind its back. Both halves live
    // there: a revoked role and a deleted account.

    describe('B5 / C1 - credentials at rest', () => {
        it('does not store password reset tokens in plaintext', () => {
            const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(PasswordResetToken);

            // a read replica leak or an over-privileged support query yields live reset tokens for
            // every pending reset, which is account takeover with no cracking required
            expect(props['value']).not.toMatchObject({ hash: false });
        });

        it('does not store refresh tokens in plaintext', () => {
            const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(JwtRefreshToken);

            expect(props['value']).not.toMatchObject({ hash: false });
        });

        it('does not store TOTP secrets in plaintext', () => {
            const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(OtpCredentials);

            // the seed is the second factor - a database read reproduces it indefinitely
            expect(props['secret']).not.toMatchObject({ encryption: false });
        });
    });

    describe('B7 - a cookie session is its row\'s id', () => {
        it('stores what the session cookies carry hashed, and no csrf token at all', () => {
            const sessionProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(CookieAuthSession);
            const refreshProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(CookieAuthRefreshSession);

            // the cookie used to carry the primary key, which cannot be hashed - so a backup, a replica
            // or a support query held a working login for every session in the tables
            expect(sessionProps['token']).toMatchObject({ hash: expect.anything() });
            expect(sessionProps['token']).not.toMatchObject({ hash: false });
            expect(refreshProps['token']).toMatchObject({ hash: expect.anything() });
            expect(refreshProps['token']).not.toMatchObject({ hash: false });
            expect(refreshProps['csrfToken']).toBeUndefined();
        });
    });

    describe('B6 - token lifetime defaults', () => {
        it('does not default refresh credentials to a 100 day lifetime', () => {
            const jwtRefreshMs: number = inject(ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS).refreshTokenExpiresInMs;
            const cookieRefreshMs: number = inject(ZIBRI_DI_TOKENS.COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS);

            // both default to 100 days out of the box, and docs/auth.md never mentions either of
            // them - a team following the documentation ships 100 day sessions without seeing it
            expect(jwtRefreshMs).toBeLessThanOrEqual(Ms.DAY * 30);
            expect(cookieRefreshMs).toBeLessThanOrEqual(Ms.DAY * 30);
        });
    });

    describe('C2 - unconfirmed TOTP enrollments must not satisfy 2FA', () => {
        it('does not accumulate an unbounded number of enrollments per user', async () => {
            const otpRepository: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            const twoFactorService: TwoFactorServiceInterface = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
            const otpMethod: OtpTwoFactorMethod = inject(OtpTwoFactorMethod);
            const user: BaseUser<string> = { id: '00000000-0000-4000-8000-000000000001', email: 'c2@example.com', roles: [] };
            await otpRepository.deleteAll({ userId: user.id });

            // through the enrollment flow rather than by inserting rows, which is the whole point:
            // what has to be bounded is what a user starting setup twice leaves behind, and rows
            // written directly say nothing about that
            await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
            await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);

            const stored: OtpCredentials[] = await otpRepository.findAll({ where: { userId: user.id } });
            const unconfirmed: OtpCredentials[] = stored.filter(c => !c.confirmed);

            // an abandoned enrollment must not leave a valid-looking secret behind for as long as the
            // account exists
            expect(unconfirmed.length).toBeLessThanOrEqual(1);
        });

        // the other half of C2 - validate() never reading `confirmed` - is asserted in
        // ./auth-sessions-and-2fa.evaluation.test.ts, which boots a server with a two factor
        // method registered and can therefore send the OTP header on a real protected route.
    });

    describe('B3 - reuse detection must not hand out a working session', () => {
        // CLOSED by construction: the reuse branch in rotateSessions logs out and throws
        // CredentialReusedError, so there is nothing after it to fall through to. It used to delete
        // the family and then mint a fresh refresh and access session in it.
        //
        // What a caller sees is held over http by ../../auth/auth-controller/auth-controller.cookie.test.ts,
        // "rejects a refresh once the refresh session has been blacklisted", and by B2's concurrency
        // cases in ./auth-sessions-and-2fa.evaluation.test.ts. Both callers check `blacklisted` before
        // rotateSessions runs, so no request reaches the branch itself - which is why the fix is one
        // that holds by construction rather than one a test would have to catch.
    });

    describe('B4 - auth endpoints must not be enumeration oracles', () => {
        /**
         * Asks for a password reset over http.
         * @param email - The address to ask for.
         * @returns The raw response, since the whole finding is about what the status says.
         */
        async function requestReset(email: string): Promise<Response> {
            return await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JsonUtilities.stringify({ email })
            });
        }

        it('answers a password reset request identically for known and unknown addresses', async () => {
            const known: string = 'reset-oracle@example.com';
            const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: known, roles: [Roles.USER] });
            await inject(repositoryTokenFor(PasswordCredentials)).create({ password: 'secure123', userId: user.id });

            // the guard, and it has to be the address that exists: a missing route and the oracle
            // below both answer 404, so guarding on the unknown address could not tell them apart
            const registered: Response = await requestReset(known);
            expect(registered.status).not.toBe(404);

            const unknown: Response = await requestReset('definitely-not-registered@example.com');

            // today known gives 204, unknown gives 404 and known-with-an-active-token gives 429,
            // which is an unauthenticated account existence and state oracle
            expect(unknown.status).toBe(registered.status);
            expect(unknown.status).toBeLessThan(400);
        });

        it('compares a password even when the address is unknown', async () => {
            const hashService: HashServiceInterface = inject(ZIBRI_DI_TOKENS.HASH_SERVICE);
            // eslint-disable-next-line typescript-js/typedef
            const equalSpy = vi.spyOn(hashService, 'equal');

            await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JsonUtilities.stringify({ email: 'no-such-account@example.com', password: 'whatever' })
            });

            // the other half of this finding, and the half identical response bodies do not fix: an
            // unknown address used to return before any key derivation ran while a known one waited
            // for a full scrypt, so the response time answered a question the body refused to.
            // Asserted as "a comparison happened" rather than by measuring, because a timing
            // assertion is a flaky test of a real property.
            expect(equalSpy).toHaveBeenCalled();
            equalSpy.mockRestore();
        }, 30000);
    });

    describe('E1 - auth endpoints must be rate limited', () => {
        it('starts rejecting repeated failed logins', async () => {
            const statuses: number[] = [];
            for (let i: number = 0; i < 25; i++) {
                const res: Response = await fetch(`${baseUrl}/auth/login`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JsonUtilities.stringify({ email: 'brute@example.com', password: `guess-${i}` })
                });
                statuses.push(res.status);
            }

            // guard so a renamed route fails loudly instead of passing by accident
            expect(statuses[0]).not.toBe(404);

            // scrypt on the event loop plus no throttle makes this both open to brute force and a
            // CPU exhaustion vector
            expect(statuses).toContain(429);
        }, 120000);

        // E2 is CLOSED and tested for real in ../../rate-limiting/rate-limit-keys.test.ts: a route
        // naming no key counts per caller, and the shared bucket is something a route asks for. The
        // default key used to be the literal string 'global', so one attacker exhausted the bucket
        // for every user at once.
    });

    describe('E3 / E4 - what a limiter costs and what it does when it cannot answer', () => {
        it('does not grow without bound when the key space does', () => {
            const store: InMemoryRateLimiterStore<BaseRateLimitState> = new InMemoryRateLimiterStore<BaseRateLimitState>({ maxKeys: 3 });
            const write: (key: string) => void = key => {
                store.atomicUpdate(key, () => ({ expiresAtMs: Date.now() + Ms.MINUTE, reservations: [] }));
            };

            for (const key of ['ip:1', 'ip:2', 'ip:3']) {
                write(key);
            }

            // spoofing a source address is free, so a key space keyed on it has no natural bound.
            // Refusing rather than growing is what keeps that from being a way to exhaust memory,
            // and refusing rather than evicting is what keeps it from being a way to reset a limit
            expect(() => write('ip:4')).toThrow();
            expect(store.size()).toBe(3);
            expect(() => write('ip:1')).not.toThrow();
        });

        it('costs the same number of store operations whether it holds three keys or three thousand', async () => {
            const limiter: RateLimiterInterface<BaseRateLimitState> | undefined = inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE)
                .limiters.find(l => l.config.name === 'AuthRateLimiter');
            expect(limiter).toBeDefined();
            assert(limiter);

            const store: RateLimiterStoreInterface<BaseRateLimitState> = limiter.config.store;
            const atomicUpdate: MockInstance<RateLimiterStoreInterface<BaseRateLimitState>['atomicUpdate']>
                = vi.spyOn(store, 'atomicUpdate');

            for (let i: number = 0; i < 200; i++) {
                await store.atomicUpdate(`evaluation-e3:${i}`, () => ({ expiresAtMs: Date.now() - 1, reservations: [] }));
            }
            atomicUpdate.mockClear();

            await limiter.cleanup();

            // the cron runs this every ten seconds on every instance. A get plus an atomic update per
            // key means a shared store pays a lock round trip per key per ten seconds, which is a
            // denial of service the app performs on itself
            expect(atomicUpdate).not.toHaveBeenCalled();
            atomicUpdate.mockRestore();
        });
    });

    describe('D1 / D2 / D3 - cryptography', () => {
        // D1 is CLOSED and tested in ../../auth/hash/strategies/scrypt.hash-strategy.test.ts: the cost
        // is an option, ships at n=2^17, and is written into the hash so raising it locks nobody out.
        // ScryptHashOptions used to expose only saltLength.
        //
        // D2's hash half is CLOSED and tested over http in
        // ../../auth/strategies/jwt/jwt-auth.password-upgrade.test.ts: a server redeployed with a
        // higher cost rewrites a stored hash on the next login. needsRehash used to have no
        // production caller. The encryption half is the case below.
        //
        // The residue D2 and D4 shared - nothing reported how much is still under an old data key or
        // master key - is CLOSED (2026-10-13) and tested in
        // ../../auth/encryption/encryption.service.retired-keys.test.ts and the backup suites
        // ../../backup/backup-service.encryption.test.ts and backup-service.several-resources.test.ts:
        // resolveRetiredKeyUsage counts stored values per deprecated key, and data keys and recorded
        // backups per old master, a backup counting by the keys it recorded when it was taken.

        it('re-encrypts a value protected by a deprecated key', async () => {
            const repository: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            const encryptionService: EncryptionServiceInterface = inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
            const created: OtpCredentials = await repository.create({ userId: UUIDUtilities.generate(), secret: 'rotate-me' });

            // `<iv>.<ciphertext>.<keyId>`, so the third part is the key the row was written with
            const keyId: string | undefined = (await repository.findById(created.id, { autoDecrypt: false })).secret.split('.')[2];
            assert(keyId, 'the stored secret carries no key id');
            const replacement: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
                status: EncryptionKeyStatus.ACTIVE
            });
            await encryptionService.markKeyAsDefaultForStrategy(replacement.id, AesGcmEncryptionStrategy);
            await encryptionService.deprecateKey(keyId);

            // deprecating a key has to actually move the data off it, or the key can never be
            // deleted and the rotation is one only the documentation performs. Built by hand because
            // the test server runs no cron jobs
            assert(server);
            const rotationJob: EncryptionRotationCronJob = new EncryptionRotationCronJob(encryptionService);
            rotationJob.onAppInit(server['app']);
            await rotationJob.onTick();

            expect((await repository.findById(created.id, { autoDecrypt: false })).secret.split('.')[2]).not.toBe(keyId);
            await expect(repository.findById(created.id)).resolves.toMatchObject({ secret: 'rotate-me' });

            await repository.deleteAll({});
        }, 20000);

        it('refuses to decrypt a value that was moved to a different row', async () => {
            const repository: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            const victim: OtpCredentials = await repository.create({ userId: UUIDUtilities.generate(), secret: 'victim-seed' });
            const attacker: OtpCredentials = await repository.create({ userId: UUIDUtilities.generate(), secret: 'attacker-seed' });

            // a raw write is what an attacker with sql injection or an over permissive admin screen
            // has. The value moves exactly as stored, so nothing the application does to it applies
            const raw: Repository<OtpCredentials>['driver'] = repository['driver'];
            const stored: OtpCredentials[] = await raw.find({});
            const victimRow: OtpCredentials | undefined = stored.find(c => c.id === victim.id);
            assert(victimRow);
            await raw.save([{ id: attacker.id, secret: victimRow.secret }] as OtpCredentials[], undefined, false);

            await expect(repository.findById(attacker.id)).rejects.toThrow();
            await expect(repository.findById(victim.id)).resolves.toMatchObject({ secret: 'victim-seed' });

            // through the driver, because the tampered row is precisely one the repository refuses to
            // read - and reading is what deleting through it starts with
            await raw.remove(await raw.findIds({}), undefined);
        });
    });

    describe('F2 / F3 / F4 - transport and cookies', () => {
        it('does not 500 on a malformed cookie', async () => {
            const res: Response = await fetch(`${baseUrl}/evaluation-unprotected/resource`, {
                headers: { cookie: 'broken=%' }
            });

            // decodeURIComponent runs on raw input with no try/catch, so a URIError reaches the
            // error handler, which logs it to the database - an unauthenticated client can fill
            // the logs table at request rate
            expect(res.status).toBeLessThan(500);
        });

        it('writes no log for a malformed cookie', async () => {
            await clearLogs();

            // the declared-public route rather than the undecorated one, because refusing the
            // undecorated one is itself an audited event (G1) and would be the row this finds
            await fetch(`${baseUrl}/evaluation-unprotected/declared-public`, { headers: { cookie: 'broken=%' } });

            // not answering 500 is only half of it: the finding is the write, and a status the
            // caller never sees is still a row per request.
            expect(await allLogs()).toEqual([]);
        }, 60000);

        // F2 is CLOSED and tested in ../../auth/auth-controller/auth-controller.cookie.test.ts, the
        // suite with a configured cookie strategy: `secure` can be stated outright, and a derived one
        // ignores an X-Forwarded-Proto the client sent. The flag used to fall back to reading that
        // header, because trust proxy was never enabled.

        it('keeps the first cookie when a name is sent twice', async () => {
            const res: Response = await fetch(`${baseUrl}/evaluation-cookies/parsed`, {
                headers: { cookie: 'sessionId=the-victims; sessionId=the-attackers' }
            });
            expect(res.status).toBe(200);

            // Object.fromEntries kept the last duplicate where cookie-parser keeps the first, so
            // anything able to set a cookie on the parent domain - a compromised sibling
            // subdomain, xss anywhere under it - shadowed the victim's session with one the
            // framework would happily verify, because it was signed by their own login.
            expect(await res.json()).toEqual({ sessionId: 'the-victims' });
        });

        // F4's rotation is CLOSED and tested against a real rotation in
        // ../../auth/auth-controller/auth-controller.cookie.test.ts: the token changes, the retired
        // one is refused, and the new one arrives on the x-csrf-token response header. The
        // cross-origin cases beyond the one below are in ../../http/cross-origin-cookie.middleware.test.ts.

        it('refuses a write another site sends with cookies to a route that resolves no session', async () => {
            await clearLogs();

            const res: Response = await fetch(`${baseUrl}/evaluation-cookies/act`, {
                method: 'POST',
                headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example.com', cookie: 'sessionId=the-victims' }
            });

            // the csrf token is checked inside the cookie strategy, so a route that never asked who
            // the caller is ran on the browser's cookies with nothing checking where it came from
            expect(res.status).toBe(403);
            expect(await auditEvents()).toContainEqual({
                action: AuditAction.AUTHORIZATION,
                outcome: AuditOutcome.FAILURE,
                reason: AuditReason.CROSS_ORIGIN
            });
        }, 60000);
    });

    describe('G1 - authentication failures must be auditable', () => {
        it('records a failed login, naming the account that was tried', async () => {
            await clearLogs();
            // E1 above deliberately spends the whole budget, and a 429 never reaches the login this
            // is about
            await resetAuthRateLimit();

            const res: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JsonUtilities.stringify({ email: 'audit@example.com', password: 'wrong-password' })
            });
            expect(res.status).toBe(401);

            // UnauthorizedError extends HttpError extends ExternalError, and handleLogging skips
            // every ExternalError, so a failed login left no record at all. The subject is what
            // makes the record usable: one client against many accounts and many clients against
            // one account are different attacks, and neither is visible without it.
            expect(await auditEvents()).toContainEqual({
                action: AuditAction.LOGIN,
                outcome: AuditOutcome.FAILURE,
                reason: AuditReason.REFUSED,
                subject: 'audit@example.com'
            });
        }, 60000);

        it('records a password reset request even though the endpoint says nothing', async () => {
            await clearLogs();

            await resetAuthRateLimit();

            const res: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JsonUtilities.stringify({ email: 'audit@example.com' })
            });
            // B4: the same answer whether or not the address exists, so the caller learns nothing
            expect(res.status).toBe(204);

            // which makes the trail the only place that says an address was asked about at all.
            // Nobody holds this address, so no reset went out - and a run of exactly these is what
            // probing a list of addresses looks like from the inside.
            expect(await auditEvents()).toContainEqual({
                action: AuditAction.PASSWORD_RESET_REQUESTED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditReason.NO_SUCH_SUBJECT,
                subject: 'audit@example.com'
            });
        }, 60000);

        it('records that a route refused an anonymous caller, and why', async () => {
            await clearLogs();

            const res: Response = await fetch(`${baseUrl}/evaluation-unprotected/resource`);
            expect(res.status).toBe(401);

            // an access review asks who was refused what. Denials only - a line per allowed request
            // would be an access log, and burying these in one defeats the purpose.
            expect(await auditEvents()).toContainEqual({
                action: AuditAction.AUTHORIZATION,
                outcome: AuditOutcome.FAILURE,
                reason: AuditReason.NOT_LOGGED_IN
            });
        }, 60000);

        // the refused / error split is tested for real in
        // ../../auth/user/user-service.store-outage.test.ts: a login while one user store is down is
        // answered 500 and recorded as `error`. Writing it found the split unreachable - the user
        // service turned every failed lookup into "not found", so an outage was still refused like a
        // wrong password, to the caller and in the trail.
    });

    // G2 - authorization errors must not describe the authorization model - is observed in
    // ./auth-sessions-and-2fa.evaluation.test.ts instead, which boots a server with a login flow: a
    // role refusal needs a caller who is logged in and holds the wrong role, and every account this
    // file has is anonymous.
    //
    // The belongsTo branch the finding also names is gone rather than answered - ownership is
    // declared as a `scope` on the entity and enforced by the repository, so no authorization check
    // has an entity class left to name.

    // H1 - access tokens signed only with a shared secret - is CLOSED and tested over http in
    // ../../auth/strategies/jwt/jwt-auth.asymmetric.test.ts: an access token signed with an
    // ES256/384/512 or RS256 key pair verifies against the public key alone, which
    // JwksController publishes at /.well-known/jwks.json under an RFC 7638 kid; hmac over the
    // public key and a stranger's key naming a known kid are both refused; a previous key keeps
    // verifying after a rotation. The allowlist was widened per key rather than per token, so the
    // algorithm is always the configured key's and never the header's.

    // H2 - sign-in through an OpenID Connect provider - is CLOSED and tested over http in
    // ../../auth/authenticators/oidc/base-oidc.authenticator.test.ts against an in-process fake
    // provider (both handovers, the browser binding, single use, a wrong audience, nonce or auth_time,
    // the redirect allowlist, the registration) and in
    // ../../auth/authenticators/oidc/providers/base-keycloak.authenticator.test.ts against a real
    // Keycloak, private_key_jwt and prompt=login included.

    // H3 - SAML 2.0 service provider - is CLOSED and tested over http in
    // ../../auth/authenticators/saml/base-saml.authenticator.test.ts against an in-process fake identity
    // provider (only an answer to this browser's request, signatures, issuer and audience, encrypted
    // assertions, signed requests, a sign-in too old, single logout both ways, cookie and jwt) and in
    // ../../auth/authenticators/oidc/providers/base-keycloak.authenticator.test.ts against a real
    // Keycloak.

    // H4 - LDAP / Active Directory bind - is CLOSED and tested over http in
    // ../../auth/authenticators/ldap/base-ldap.authenticator.test.ts against an in-process fake
    // directory (search then bind, TLS and StartTLS, an empty password, a name read as a filter, a
    // locked account by every code, the first sign-in hook and its race) and in
    // ../../auth/authenticators/ldap/base-ldap.authenticator.heavy.test.ts and
    // ../../auth/authenticators/ldap/providers/base-active-directory.authenticator.heavy.test.ts
    // against 389 Directory Server and a Samba domain controller.

    // H5 - identity for machines - is CLOSED and tested over http in
    // ../../auth/strategies/api-key/api-key.auth-strategy.test.ts: a key acts as its user with only the
    // roles it may use that the user still has, also for the handler, is kept hashed, expires, and is
    // revoked on its own or with every other key of the user. The client credentials grant moved to H8.

    // H6 - client certificate authentication - is CLOSED and tested over http in
    // ../../auth/strategies/client-certificate/base-client-certificate.auth-strategy.test.ts: a
    // certificate forwarded by a trusted proxy acts as the user the application finds for it, and only
    // when an authority it names issued it and it is valid; from anywhere else the header is ignored.
    // Behind a real nginx and a real Envoy in base-client-certificate.auth-strategy.nginx.test.ts and
    // .envoy.test.ts beside it.

    // H7 - provisioning and deprovisioning - is CLOSED and tested over http in
    // ../../auth/scim/scim-controller.model.test.ts: an identity provider provisions users and groups,
    // a user set inactive is deactivated (logins ended, api keys revoked, no login or request until
    // reactivated), group membership sets roles, and a deleted user goes through the provisioner.
    // Deactivation itself in ../../auth/auth.service.deactivation.test.ts.

    // H8 - OAuth2 token endpoints - is CLOSED and tested over http in
    // ../../auth/authorization-server/authorization-server-controller.model.test.ts: a service exchanges
    // its api key for an access token by a secret, a signed jwt or a client certificate (bound to it),
    // for the roles and services it may ask for; introspection answers for every kind of token to a
    // caller holding a role; revocation takes a token back, at once when access tokens are revoked
    // immediately, and a client only its own.

    // H9 - step-up authentication - is WITHDRAWN: @Auth.require2fa asks for a second factor on every
    // request to the route it guards, never once per session. Tested over http in
    // ./auth-sessions-and-2fa.evaluation.test.ts, where a logged in session without a code is
    // refused and the same session with one is let through; the replay test beside it shows a
    // code is spent by the operation it opened.

    // H10 - WebAuthn / passkeys - is CLOSED and tested over http in ./auth-passkey.evaluation.test.ts:
    // a sign-up with nothing but a passkey logs in and signs in again later, a passkey used on another
    // origin is refused, and a passkey is the second factor of a require2fa route. The cases of each
    // check are in ../../auth/authenticators/passkey/passkey.authenticator.test.ts.

    // H11 - SMS or email code as a second factor - is CLOSED and tested in
    // ../../auth/2fa/methods/code/code.two-factor-method.test.ts: enrolling with a delivered code, a code
    // taken once and kept encrypted, the throttle on wrong codes and on sending, for both channels.

    // H12 - EdDSA for access tokens - is CLOSED and tested in
    // ../../auth/strategies/jwt/jwt-auth.asymmetric.test.ts: an Ed25519 key signs, verifies with the
    // public key alone and is published as an OKP key; a key of another type is refused at boot.

    // H13 - a fresh login in place of a second factor - is CLOSED and tested over http in
    // ./auth-sessions-and-2fa.evaluation.test.ts: refused unless the route or the application allows
    // it, accepted inside the window and refused past it, accepted as a fallback only from a user
    // without a confirmed factor, kept across a refresh, refused for a strategy that cannot say when
    // its caller logged in. The cookie strategy's half is in
    // ../../auth/auth-controller/auth-controller.cookie.test.ts.

    // H14 - an identity provider's tokens as bearer credentials - is CLOSED and tested over http in
    // ./auth-provider-tokens.evaluation.test.ts: a mobile app's access token from the company's provider
    // acts as the user its identity is linked to. Audiences, types, ID tokens, binding and the login
    // time are in ../../auth/strategies/provider-token/provider-token.auth-strategy.test.ts.

    // H15 - sign-in through a plain OAuth2 provider - is CLOSED and tested over http in
    // ./auth-oauth2.evaluation.test.ts: a provider that issues no ID token signs a linked user in, who
    // is read from its api. The login time and GitHub are in ../../auth/authenticators/oauth2.

    // H16 - adding an identity provider to an existing account - is CLOSED and tested over http in
    // ./auth-oauth-connect.evaluation.test.ts: a user logged in with a password connects a provider,
    // whose next sign-in logs into that account. The attacks and refusals are in
    // ../../auth/authenticators/oidc/base-oidc.authenticator.test.ts.

    // H18 - connecting a provider for access to its apis - is CLOSED and tested over http in
    // ./auth-oauth-api-access.evaluation.test.ts: a user connects a provider for its calendar only, the
    // application reads it with refreshed access tokens, and the connection signs nobody in. Rotation,
    // declined scopes and revocation are in ../../auth/authenticators/oidc/base-oidc.authenticator.test.ts.

    // H19 - auth routes built from what is registered - is CLOSED and tested over http in
    // ../../auth/auth-controller/auth-controller.model.test.ts: one controller defined from the
    // strategies, authenticators and two factor methods serves the routes they call for, chosen per
    // request, and the application refuses to start when its options and the registered ones differ.

    // last in the file on purpose: it replaces the running application with one configured
    // differently, and nothing after it would be looking at the server the tests above started
    describe('D4 - master key material must be able to live outside the process', () => {
        it('boots, rotates and reads with a master strategy that is only ever given a key handle', async () => {
            assert(server);
            const repository: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            // written under the aes-gcm master, before this process has any notion of a remote one
            const before: OtpCredentials = await repository.create({
                userId: UUIDUtilities.generate(),
                secret: 'kms-seed'
            });

            await server.reInit({
                providers: [
                    ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS),
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
                        useValue: {
                            currentMasterStrategy: new RemoteMasterStrategy(),
                            currentMasterKey: { id: 'remote-mk1', value: { keyRef: remoteMasterKeyRef } },
                            // what the application was using a moment ago. Without it the key rows
                            // already in the table are unreadable, which is true of any master change
                            oldMasterStrategies: [new AesGcmEncryptionStrategy()],
                            oldMasterKeys: [testMasterKey]
                        }
                    })
                ]
            });

            // the framework was handed a reference and nothing else. Whether that reference resolves
            // to bytes is the strategy's business, and this one keeps them somewhere the application
            // cannot reach
            const masterOptions: EncryptionMasterOptions<RemoteKeyHandle> | undefined = inject(
                ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS
            );
            expect(masterOptions?.currentMasterKey.value).toEqual({ keyRef: remoteMasterKeyRef });

            // every data key was rewritten under the remote master while starting, which is the part
            // that has to work before any of the rest can
            const keys: EncryptionKey[] = await inject<Repository<EncryptionKey>>(repositoryTokenFor(EncryptionKey)).findAll({});
            expect(keys.length).toBeGreaterThan(0);
            expect(keys.every(k => k.value.startsWith('remote-kms.v1.'))).toBe(true);

            const rotated: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            // a value written before the change still reads, so unwrapping went through the handle
            await expect(rotated.findById(before.id)).resolves.toMatchObject({ secret: 'kms-seed' });

            // and a new one round trips, so wrapping did too
            const after: OtpCredentials = await rotated.create({
                userId: UUIDUtilities.generate(),
                secret: 'kms-seed-2'
            });
            await expect(rotated.findById(after.id)).resolves.toMatchObject({ secret: 'kms-seed-2' });

            await rotated.deleteAll({});
        }, 60000);
    });

    describe('H20 - a tenant cannot bring its own sign-in', () => {
        // deferred: every authenticator is configured in code for the whole application, and nothing
        // models a connection per tenant for a login to resolve
        it.todo('signs a member of a tenant in through the identity provider their tenant connected at runtime');
        it.todo('refuses a sign-in through one tenant\'s identity provider for a user who is not a member there');
    });
});