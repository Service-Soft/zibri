import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakeOAuthProvider, startFakeOAuthProvider } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { EmailTwoFactorMethod } from './2fa/methods/code/email.two-factor-method';
import { TwoFactorCodeCredentials, TwoFactorCodeCredentialsCreateData } from './2fa/methods/code/two-factor-code-credentials.model';
import { TwoFactorCode, TwoFactorCodeCreateData } from './2fa/methods/code/two-factor-code.model';
import { OtpCredentials, OtpCredentialsCreateData } from './2fa/methods/otp/otp-credentials.model';
import { OtpTwoFactorMethod } from './2fa/methods/otp/otp.two-factor-method';
import { PasskeyTwoFactorMethod } from './2fa/methods/passkey/passkey.two-factor-method';
import { RecoveryCodeTwoFactorMethod } from './2fa/methods/recovery-code/recovery-code.two-factor-method';
import { TwoFactorRecoveryCode, TwoFactorRecoveryCodeCreateData } from './2fa/methods/recovery-code/two-factor-recovery-code.model';
import { CreateTwoFactorFailureStreakData, TwoFactorFailureStreak } from './2fa/two-factor-failure-streak.model';
import { FederatedConnectionCode, FederatedConnectionCodeCreateData } from './authenticators/federated/federated-connection-code.model';
import { FederatedHandoverCode, FederatedHandoverCodeCreateData } from './authenticators/federated/federated-handover-code.model';
import { FederatedIdentity, FederatedIdentityCreateData } from './authenticators/federated/federated-identity.model';
import { FederatedLoginAttempt, FederatedLoginAttemptCreateData } from './authenticators/federated/federated-login-attempt.model';
import { FederatedRegistrationTicket } from './authenticators/federated/federated-registration-ticket.model';
import { BaseLdapAuthenticator } from './authenticators/ldap/base-ldap.authenticator';
import { LdapEntry } from './authenticators/ldap/ldap-entry.model';
import { LdapIdentity, LdapIdentityCreateData } from './authenticators/ldap/ldap-identity.model';
import { LdapServiceAccount } from './authenticators/ldap/ldap-service-account.model';
import { OAuthClientAuthentication } from './authenticators/oauth/oauth-client-authentication.model';
import { OAuthProviderTokens, OAuthProviderTokensCreateData } from './authenticators/oauth/oauth-provider-tokens.model';
import { BaseOidcAuthenticator } from './authenticators/oidc/base-oidc.authenticator';
import { OidcAuthenticationTime } from './authenticators/oidc/oidc-authentication-time.type';
import { OidcDiscoveryAtBoot } from './authenticators/oidc/oidc-discovery-at-boot.type';
import { PasskeyCeremony } from './authenticators/passkey/passkey-ceremony.enum';
import { PasskeyChallenge, PasskeyChallengeCreateData } from './authenticators/passkey/passkey-challenge.model';
import { PasskeyRegistrationTicket, PasskeyRegistrationTicketCreateData } from './authenticators/passkey/passkey-registration-ticket.model';
import { PasskeyAuthenticator } from './authenticators/passkey/passkey.authenticator';
import { Passkey, PasskeyCreateData } from './authenticators/passkey/passkey.model';
import { PasswordCredentials, PasswordCredentialsCreateData } from './authenticators/password/password-credentials.model';
import { PasswordFailureStreak, PasswordFailureStreakCreateData } from './authenticators/password/password-failure-streak.model';
import { PasswordAuthenticator } from './authenticators/password/password.authenticator';
import { BaseUserEntity } from './models/base-user.model';
import { LoginTicket, LoginTicketCreateData } from './models/login-ticket.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from './models/password-reset-token.model';
import { ApiKeyAuthenticationMethod } from './strategies/api-key/api-key-authentication-method.enum';
import { ApiKeyAuthStrategy } from './strategies/api-key/api-key.auth-strategy';
import { ApiKey, ApiKeyCreateDto } from './strategies/api-key/api-key.model';
import { CookieAuthRefreshSession, CookieAuthRefreshSessionCreateData } from './strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession, CookieAuthSessionCreateData } from './strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from './strategies/cookie/cookie-auth.auth-strategy';
import { JwtRefreshToken, JwtRefreshTokenCreateDto } from './strategies/jwt/jwt-refresh-token.model';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';
import { BaseUserRepository } from './user/base-user-repository.model';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { SoftDeleteEntity } from '../data-source/change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../data-source/change-sets/soft-delete-repository';
import { Repository } from '../data-source/repository/repository';
import { RepositoryFor } from '../data-source/repository/repository-for.decorator';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider } from '../di/models/di-provider.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { RateLimitStateEntity } from '../rate-limiting/stores/rate-limit-state-entity.model';

/**
 * The provider identities are linked at, whose metadata the application reads while it starts.
 */
let provider: FakeOAuthProvider;

/**
 * A provider an identity is linked at, whose apis are called for it, so its tokens are kept.
 */
class ExampleProviderAuthenticator extends BaseOidcAuthenticator<string, JwtUser> {
    readonly name: string = 'example';

    get issuer(): string {
        return provider.issuer;
    }

    readonly clientId: string = 'zibri-test-client';

    readonly clientAuthentication: OAuthClientAuthentication = { method: 'client_secret_basic', clientSecret: 'zibri-test-secret' };

    readonly authenticationTime: OidcAuthenticationTime = 'auth_time';

    readonly discoveryAtBoot: OidcDiscoveryAtBoot = 'required';

    override readonly apiScopes: string[] = ['calendar.read'];
}

/**
 * A directory a user logs in at. Nothing here reaches it: its rows are written directly.
 */
class CompanyDirectory extends BaseLdapAuthenticator<string, JwtUser> {
    readonly name: string = 'company';

    readonly urls: string[] = ['ldaps://ldap.example.com'];

    readonly serviceAccount: LdapServiceAccount = { dn: 'cn=zibri,dc=example,dc=com', password: 'secret' };

    readonly searchBase: string = 'ou=people,dc=example,dc=com';

    readonly entryFilter: string = '(objectClass=inetOrgPerson)';

    readonly usernameAttributes: string[] = ['uid'];

    readonly groupSearchBase: string | undefined = undefined;

    readonly refreshCheckIntervalInMs: number = 0;

    async resolveFirstLogin(): Promise<JwtUser> {
        return Promise.reject(new Error('not reached'));
    }

    async resolveLogin(_: LdapEntry, user: JwtUser): Promise<JwtUser> {
        return Promise.resolve(user);
    }
}

/**
 * A user entity that soft deletes, so that a delete keeps the user, and with them their rows.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class ArchivedUser extends BaseUserEntity(SoftDeleteEntity, { deletedUserKeepsEmail: false }) {}

@RepositoryFor(ArchivedUser)
class ArchivedUserRepository extends BaseUserRepository<ArchivedUser>(SoftDeleteRepository) {}

/**
 * Every table the framework keeps rows of a user in, beside their memberships.
 */
const USER_TABLES: Newable<BaseEntity & { userId?: string | null }>[] = [
    PasswordCredentials,
    PasswordResetToken,
    PasswordFailureStreak,
    OtpCredentials,
    TwoFactorCodeCredentials,
    TwoFactorRecoveryCode,
    TwoFactorFailureStreak,
    Passkey,
    PasskeyChallenge,
    PasskeyRegistrationTicket,
    FederatedIdentity,
    FederatedConnectionCode,
    FederatedHandoverCode,
    FederatedLoginAttempt,
    LdapIdentity,
    ApiKey,
    JwtRefreshToken,
    CookieAuthSession,
    CookieAuthRefreshSession,
    LoginTicket
];

/**
 * Every table a user with one row of each kind has a row in, as `findTablesWithRows` names them.
 */
const ALL_TABLES: string[] = [...USER_TABLES.map(table => table.name), OAuthProviderTokens.name, TwoFactorCode.name];

const later: Date = new Date(Date.now() + Ms.HOUR);

/**
 * The rows of a user that name them only through another row of theirs.
 */
type IndirectRows = {
    /**
     * Their federated identity, whose provider tokens are kept by its id.
     */
    identityId: string,
    /**
     * Their code credentials, whose codes are kept by its id.
     */
    codeCredentialsId: string
};

/**
 * Gives a user one row in every table the framework keeps rows of a user in.
 * @param userId - The user.
 * @returns The ids the rows that name them only indirectly are kept by.
 */
async function giveRows(userId: string): Promise<IndirectRows> {
    const tag: string = UUIDUtilities.generate();
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ userId, password: 'a long enough password' });
    await inject<Repository<PasswordResetToken, PasswordResetTokenCreateData>>(repositoryTokenFor(PasswordResetToken))
        .create({ userId, value: tag, expirationDate: later });
    await inject<Repository<PasswordFailureStreak, PasswordFailureStreakCreateData>>(repositoryTokenFor(PasswordFailureStreak))
        .create({ userId, count: 1 });
    await inject<Repository<OtpCredentials, OtpCredentialsCreateData>>(repositoryTokenFor(OtpCredentials))
        // eslint-disable-next-line cspell/spellchecker
        .create({ userId, secret: 'JBSWY3DPEHPK3PXP' });
    const codeCredentials: TwoFactorCodeCredentials = await inject<Repository<TwoFactorCodeCredentials, TwoFactorCodeCredentialsCreateData>>(
        repositoryTokenFor(TwoFactorCodeCredentials)
    ).create({ userId, channel: 'email' });
    await inject<Repository<TwoFactorCode, TwoFactorCodeCreateData>>(repositoryTokenFor(TwoFactorCode))
        .create({ credentialsId: codeCredentials.id, value: '123456', expirationDate: later });
    await inject<Repository<TwoFactorRecoveryCode, TwoFactorRecoveryCodeCreateData>>(repositoryTokenFor(TwoFactorRecoveryCode))
        .create({ userId, code: tag });
    await inject<Repository<TwoFactorFailureStreak, CreateTwoFactorFailureStreakData>>(repositoryTokenFor(TwoFactorFailureStreak))
        .create({ userId, count: 1, retryAt: later });
    await inject<Repository<Passkey, PasskeyCreateData>>(repositoryTokenFor(Passkey)).create({
        userId, credentialId: tag, publicKey: 'key', counter: 0, transports: [], aaguid: 'aaguid', userHandle: tag, synced: false, createdAt: new Date()
    });
    await inject<Repository<PasskeyChallenge, PasskeyChallengeCreateData>>(repositoryTokenFor(PasskeyChallenge)).create({
        value: tag, ceremony: PasskeyCeremony.ADDITION, userId, spent: false, expirationDate: later
    });
    await inject<Repository<PasskeyRegistrationTicket, PasskeyRegistrationTicketCreateData>>(repositoryTokenFor(PasskeyRegistrationTicket)).create({
        value: tag,
        userId,
        userName: 'ada',
        credentialId: tag,
        publicKey: 'key',
        counter: 0,
        transports: [],
        aaguid: 'aaguid',
        userHandle: tag,
        synced: false,
        authenticatedAt: new Date(),
        spent: false,
        expirationDate: later
    });
    const identity: FederatedIdentity = await inject<Repository<FederatedIdentity, FederatedIdentityCreateData>>(
        repositoryTokenFor(FederatedIdentity)
    ).create({ issuer: provider.issuer, subject: tag, userId, forLogin: true, grantedScopes: ['calendar.read'] });
    await inject<Repository<OAuthProviderTokens, OAuthProviderTokensCreateData>>(repositoryTokenFor(OAuthProviderTokens)).create({
        identityId: identity.id, accessToken: 'access', refreshToken: 'refresh', accessTokenExpirationDate: later
    });
    await inject<Repository<FederatedConnectionCode, FederatedConnectionCodeCreateData>>(repositoryTokenFor(FederatedConnectionCode)).create({
        value: tag, provider: 'example', userId, redirectTo: 'https://app.example.com', forLogin: true, apiScopes: [], spent: false, expirationDate: later
    });
    await inject<Repository<FederatedHandoverCode, FederatedHandoverCodeCreateData>>(repositoryTokenFor(FederatedHandoverCode)).create({
        value: tag,
        binding: undefined,
        provider: 'example',
        userId,
        authenticatedAt: new Date(),
        claims: {},
        providerAuthentication: undefined,
        subjectKey: undefined,
        sessionKey: undefined,
        sessionLogout: undefined,
        bindingCookie: undefined,
        codeChallenge: undefined,
        spent: false,
        expirationDate: later
    });
    await inject<Repository<FederatedLoginAttempt, FederatedLoginAttemptCreateData>>(repositoryTokenFor(FederatedLoginAttempt)).create({
        state: tag,
        binding: tag,
        provider: 'example',
        redirectTo: 'https://app.example.com',
        reauthenticate: false,
        codeChallenge: undefined,
        strategy: undefined,
        userId,
        forLogin: true,
        apiScopes: [],
        spent: false,
        expirationDate: later
    });
    await inject<Repository<LdapIdentity, LdapIdentityCreateData>>(repositoryTokenFor(LdapIdentity))
        .create({ directory: 'company', entryId: tag, userId });
    await inject<Repository<ApiKey, ApiKeyCreateDto>>(repositoryTokenFor(ApiKey)).create({
        userId,
        name: 'ci',
        value: tag,
        permissions: [],
        tenantId: undefined,
        authenticationMethod: ApiKeyAuthenticationMethod.SECRET,
        publicKey: undefined,
        jwksUrl: undefined,
        certificateThumbprint: undefined,
        requireDpop: false,
        expiresAt: undefined
    });
    await inject<Repository<JwtRefreshToken, JwtRefreshTokenCreateDto>>(repositoryTokenFor(JwtRefreshToken)).create({
        userId,
        value: tag,
        blacklisted: false,
        expirationDate: later,
        familyId: UUIDUtilities.generate(),
        federatedProvider: undefined,
        federatedSubjectKey: undefined,
        federatedSessionKey: undefined,
        federatedLogout: undefined,
        dpopKeyThumbprint: undefined,
        providerAuthentication: undefined
    });
    await inject<Repository<CookieAuthSession, CookieAuthSessionCreateData>>(repositoryTokenFor(CookieAuthSession)).create({
        token: tag, userId, expirationDate: later, familyId: UUIDUtilities.generate()
    });
    await inject<Repository<CookieAuthRefreshSession, CookieAuthRefreshSessionCreateData>>(repositoryTokenFor(CookieAuthRefreshSession)).create({
        token: tag,
        userId,
        expirationDate: later,
        blacklisted: false,
        familyId: UUIDUtilities.generate(),
        authenticatedAt: new Date(),
        federatedProvider: undefined,
        federatedSubjectKey: undefined,
        federatedSessionKey: undefined,
        federatedLogout: undefined,
        providerAuthentication: undefined
    });
    await inject<Repository<LoginTicket, LoginTicketCreateData>>(repositoryTokenFor(LoginTicket)).create({
        value: tag,
        userId,
        subject: undefined,
        authenticatedAt: new Date(),
        federatedProvider: undefined,
        federatedSubjectKey: undefined,
        federatedSessionKey: undefined,
        federatedLogout: undefined,
        spent: false,
        expirationDate: later
    });
    return { identityId: identity.id, codeCredentialsId: codeCredentials.id };
}

/**
 * The tables that hold a row of the user, by name, so a failure says which kept one.
 * @param userId - The user.
 * @param indirect - The ids the rows that name them only indirectly are kept by.
 * @returns The names of the tables with a row of theirs.
 */
async function findTablesWithRows(userId: string, indirect: IndirectRows): Promise<string[]> {
    const holding: string[] = [];
    for (const table of USER_TABLES) {
        if ((await inject(repositoryTokenFor(table)).findAll({ where: { userId } })).length) {
            holding.push(table.name);
        }
    }
    if ((await inject(repositoryTokenFor(OAuthProviderTokens)).findAll({ where: { identityId: indirect.identityId } })).length) {
        holding.push(OAuthProviderTokens.name);
    }
    if ((await inject(repositoryTokenFor(TwoFactorCode)).findAll({ where: { credentialsId: indirect.codeCredentialsId } })).length) {
        holding.push(TwoFactorCode.name);
    }
    return holding;
}

/**
 * A user deleted for good is gone with everything the framework kept for them: their password hash,
 * their second factors, passkeys, api keys, identities at providers and directories with the tokens
 * kept for them, and their sessions. A delete removed their memberships and left every other row
 * behind, growing with each user ever deleted and keeping their personal data (04 §A18).
 */
describe('deleting a user', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        provider = await startFakeOAuthProvider({ clientId: 'zibri-test-client', clientSecret: 'zibri-test-secret' });
        server = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [
                        ...defaultTestServerEntities,
                        ArchivedUser,
                        PasswordFailureStreak,
                        TwoFactorCodeCredentials,
                        TwoFactorCode,
                        RateLimitStateEntity,
                        TwoFactorRecoveryCode,
                        Passkey,
                        PasskeyChallenge,
                        PasskeyRegistrationTicket,
                        FederatedLoginAttempt,
                        FederatedIdentity,
                        FederatedHandoverCode,
                        FederatedRegistrationTicket,
                        FederatedConnectionCode,
                        OAuthProviderTokens,
                        LdapIdentity,
                        ApiKey,
                        CookieAuthSession,
                        CookieAuthRefreshSession
                    ],
                    repositories: [...defaultTestServerRepositories, ArchivedUserRepository],
                    allowOrphan: true
                })
            ],
            authStrategies: [JwtAuthStrategy, CookieAuthStrategy, ApiKeyAuthStrategy],
            authenticators: [PasswordAuthenticator, PasskeyAuthenticator, ExampleProviderAuthenticator, CompanyDirectory],
            twoFactorMethods: [OtpTwoFactorMethod, EmailTwoFactorMethod, RecoveryCodeTwoFactorMethod, PasskeyTwoFactorMethod],
            twoFactorAtLogin: 'ifEnrolled',
            passwordFailureLimit: { maxFailures: 5, lockForInMs: Ms.MINUTE },
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.PASSKEY_OPTIONS,
                    useValue: { relyingPartyId: 'example.com', relyingPartyName: 'Example', origins: ['https://app.example.com'] }
                }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                    useValue: {
                        allowedRedirects: ['https://app.example.com'],
                        registrationUrl: 'https://app.example.com/register',
                        errorUrl: 'https://app.example.com/login-failed',
                        loggedOutUrl: 'https://app.example.com/logged-out',
                        maxAuthenticationAgeInMs: Ms.HOUR
                    }
                })
            ]
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await provider?.stop();
    }, TestTimeouts.inMemory.shutdown);

    it('deletes every row the framework keeps for them, and no row of anyone else', async () => {
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const leaving: JwtUser = await users.create({ email: 'leaving@example.com', roles: [Roles.USER] });
        const staying: JwtUser = await users.create({ email: 'staying@example.com', roles: [Roles.USER] });
        const leavingRows: IndirectRows = await giveRows(leaving.id);
        const stayingRows: IndirectRows = await giveRows(staying.id);

        await users.deleteById(leaving.id);

        expect(await findTablesWithRows(leaving.id, leavingRows)).toEqual([]);
        expect(await findTablesWithRows(staying.id, stayingRows)).toEqual(ALL_TABLES);
    });

    it('keeps them while the user is only soft deleted, so a restore brings the user back whole, and deletes them with a hard delete', async () => {
        const users: ArchivedUserRepository = inject(ArchivedUserRepository);
        const archived: ArchivedUser = await users.create({ email: 'archived@example.com', roles: [] });
        const rows: IndirectRows = await giveRows(archived.id);

        await users.deleteById(archived.id);
        expect(await findTablesWithRows(archived.id, rows)).toEqual(ALL_TABLES);

        await users.deleteById(archived.id, { hardDelete: true });
        expect(await findTablesWithRows(archived.id, rows)).toEqual([]);
    });
});