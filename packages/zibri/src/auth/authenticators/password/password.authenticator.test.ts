import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { PasswordCredentials, PasswordCredentialsCreateData } from './password-credentials.model.ts';
import { PasswordAuthenticator } from './password.authenticator.ts';
import { JwtTestAuthController } from '../../../__testing__/mocks/controllers/jwt-test-auth.controller.ts';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers.ts';
import { startAndStopTestServerWithout } from '../../../__testing__/test-server/start-and-stop-test-server-without.function.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { DataSource } from '../../../data-source/decorators/data-source.decorator.ts';
import { Migration } from '../../../data-source/migration/migration.model.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { Injectable } from '../../../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { defineProvider } from '../../../di/models/di-provider.model.ts';
import { Email } from '../../../email/models/email.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';
import { Controller } from '../../../routing/decorators/controller.decorator.ts';
import { Newable } from '../../../types/newable.type.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { SemVerVersion } from '../../../versioning/sem-ver.utilities.ts';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method.ts';
import { AuthController } from '../../auth-controller/auth-controller.model.ts';
import { type HashString, HashUtilities } from '../../hash/hash.utilities.ts';
import { BcryptHashStrategy } from '../../hash/strategies/bcrypt.hash-strategy.ts';
import { HashStrategyEntity, HashStrategyEntityCreateData, HashStrategyStatus } from '../../hash/strategies/hash-strategy-entity.model.ts';
import { ScryptCost, ScryptHashStrategy } from '../../hash/strategies/scrypt.hash-strategy.ts';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy.ts';
import { PasswordResetToken } from '../../models/password-reset-token.model.ts';
import { CookieAuthRefreshSession } from '../../strategies/cookie/cookie-auth-refresh-session.model.ts';
import { CookieAuthSession } from '../../strategies/cookie/cookie-auth-session.model.ts';
import { CookieAuthStrategy } from '../../strategies/cookie/cookie-auth.auth-strategy.ts';
import { JwtRefreshToken } from '../../strategies/jwt/jwt-refresh-token.model.ts';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy.ts';

/**
 * Logs in over http.
 * @param baseUrl - Where the server is reachable.
 * @param email - The email to log in with.
 * @param password - The password to log in with.
 * @returns The status of the response.
 */
async function login(baseUrl: string, email: string, password: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JsonUtilities.stringify({ email, password })
    });
    return res.status;
}

// first, for the reason on startAndStopTestServerWithout
describe('PasswordAuthenticator — starting', () => {
    it('refuses to start without its entities, and names them', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([PasswordCredentials, PasswordResetToken], {
            controllers: [JwtTestAuthController]
        });

        await expect(start).rejects.toThrow(/Error initializing PasswordAuthenticator[\S\s]*PasswordCredentials[\S\s]*PasswordResetToken/);
    }, 30000);
});

/**
 * The auth routes of an application logging in with jwts and with cookies.
 */
// an orphan for the cases in this file that boot without it
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class JwtAndCookieAuthController extends AuthController({
        strategies: [JwtAuthStrategy, CookieAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

describe('PasswordAuthenticator — a confirmed reset', () => {
    const email: string = 'reset-ends-every-login@example.com';
    const password: string = 'secure123';
    // allowed to go unused, because the other cases in this file boot without it
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, CookieAuthSession, CookieAuthRefreshSession],
        allowOrphan: true
    });
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy, CookieAuthStrategy],
            controllers: [JwtAndCookieAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' })
            ]
        });
        baseUrl = await server.start();
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('ends the logins of every strategy, not only of the one whose controller took it', async () => {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password, userId: user.id });

        // one login per strategy: a token pair over http, and a cookie session started directly
        const loginRes: Response = await fetch(`${baseUrl}/auth/login?strategy=jwt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ email, password })
        });
        expect(loginRes.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const tokens: { refreshToken: { value: string } } = await loginRes.json();
        await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).login(PasswordAuthenticator<Roles>, CookieAuthStrategy<Roles>, { email, password }, undefined);
        expect(await inject(repositoryTokenFor(CookieAuthRefreshSession)).findAll({ where: { userId: user.id } })).toHaveLength(1);

        // the reset, through the auth routes
        await fetch(`${baseUrl}/auth/request-password-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ email })
        });
        const emails: Email[] = await inject(repositoryTokenFor(Email)).findAll({ where: { recipients: { includes: [email] } } });
        const resetToken: string | undefined = /confirm-password-reset\/([\da-f]+)/.exec(emails.at(-1)?.html ?? '')?.[1];
        const confirmRes: Response = await fetch(`${baseUrl}/auth/confirm-password-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ resetToken, newPassword: 'newPass456' })
        });
        expect(confirmRes.status).toBe(204);

        // nothing of either login can be refreshed into a new one
        expect(await inject(repositoryTokenFor(JwtRefreshToken)).findAll({ where: { userId: user.id } })).toHaveLength(0);
        expect(await inject(repositoryTokenFor(CookieAuthRefreshSession)).findAll({ where: { userId: user.id } })).toHaveLength(0);
        expect(await inject(repositoryTokenFor(CookieAuthSession)).findAll({ where: { userId: user.id } })).toHaveLength(0);
        const refreshRes: Response = await fetch(`${baseUrl}/auth/refresh-login?strategy=jwt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ refreshToken: tokens.refreshToken.value })
        });
        expect(refreshRes.status).toBe(401);
    });
});

describe('PasswordAuthenticator — passwords 2.x stored', () => {
    /**
     * The credentials the jwt strategy of 2.x stored, a copy of the entity it shipped.
     */
    @Entity({ tenant: 'shared', allowOrphan: true, tableName: 'jwt_credentials' })
    class LegacyJwtCredentials extends BaseEntity {
        @Property.string({ format: 'uuid' })
        userId!: string;

        @Property.string({ unique: true, format: 'email' })
        email!: string;

        @Property.string({ hash: true })
        password!: HashString;
    }

    /**
     * The credentials the cookie strategy of 2.x stored, a copy of the entity it shipped.
     */
    @Entity({ tenant: 'shared', allowOrphan: true, tableName: 'cookie_auth_credentials' })
    class LegacyCookieAuthCredentials extends BaseEntity {
        @Property.string({ format: 'uuid' })
        userId!: string;

        @Property.string({ unique: true, format: 'email' })
        email!: string;

        @Property.string({ hash: true })
        password!: HashString;
    }

    /**
     * What 2.x created the credentials of either strategy from.
     */
    class LegacyCredentialsCreateData extends OmitClass(LegacyJwtCredentials, ['id', 'password']) {
        @Property.string({ hash: true })
        password!: string;
    }

    // changed in place by the upgrade below, so that 3.x starts on the same data source class - and
    // so on the same store, which belongs to the class
    const entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, LegacyJwtCredentials, LegacyCookieAuthCredentials];
    const migrations: Newable<Migration>[] = [];

    /**
     * The data source of both versions. Allowed to go unused, because the other cases in this file
     * boot without it.
     */
    @DataSource({ allowOrphan: true })
    class UpgradedDataSource extends InMemoryDataSource {
        override readonly entities: Newable<BaseEntity>[] = entities;
        override readonly migrations: Newable<Migration>[] = migrations;
    }

    /**
     * The step of the upgrade migration that moves the passwords, as the upgrade guide gives it.
     */
    @Injectable()
    class MovePasswordsMigration extends Migration {
        version: SemVerVersion = '1.0.0';

        constructor() {
            super(UpgradedDataSource);
        }

        override async up(transaction: Transaction): Promise<void> {
            await this.dataSource.mergeEntity({ entity: PasswordCredentials, currentTableName: 'jwt_credentials', transaction });
            await this.dataSource.mergeEntity({ entity: PasswordCredentials, currentTableName: 'cookie_auth_credentials', transaction });
            await this.dataSource.removePropertyFromEntity({ entity: PasswordCredentials, propertyKey: 'email', transaction });
        }

        // eslint-disable-next-line typescript/require-await
        override async down(): Promise<void> {
            throw new Error('Not needed for this test.');
        }
    }

    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [UpgradedDataSource], controllers: [JwtTestAuthController] });
        const users: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const jwtCredentials: Repository<LegacyJwtCredentials, LegacyCredentialsCreateData> = inject(repositoryTokenFor(LegacyJwtCredentials));
        const cookieCredentials: Repository<LegacyCookieAuthCredentials, LegacyCredentialsCreateData> = inject(
            repositoryTokenFor(LegacyCookieAuthCredentials)
        );
        const jwtOnly: JwtUser = await users.create({ email: 'jwt-only@example.com', roles: [Roles.USER] });
        const cookieOnly: JwtUser = await users.create({ email: 'cookie-only@example.com', roles: [Roles.USER] });
        const both: JwtUser = await users.create({ email: 'both@example.com', roles: [Roles.USER] });
        await jwtCredentials.createAll([
            { userId: jwtOnly.id, email: jwtOnly.email, password: 'jwt-password' },
            { userId: both.id, email: both.email, password: 'jwt-password' }
        ]);
        await cookieCredentials.createAll([
            { userId: cookieOnly.id, email: cookieOnly.email, password: 'cookie-password' },
            { userId: both.id, email: both.email, password: 'cookie-password' }
        ]);

        // the first start of 3.x, on the same store
        entities.splice(entities.indexOf(LegacyJwtCredentials), 2);
        migrations.push(MovePasswordsMigration);
        await server.reInit();
        baseUrl = await server.start();
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('signs in with the password of either strategy once the upgrade migration moved them', async () => {
        expect(await login(baseUrl, 'jwt-only@example.com', 'jwt-password')).toBe(200);
        expect(await login(baseUrl, 'cookie-only@example.com', 'cookie-password')).toBe(200);
    });

    it('keeps the password of the table merged first for a user who had one in both', async () => {
        expect(await login(baseUrl, 'both@example.com', 'jwt-password')).toBe(200);
        expect(await login(baseUrl, 'both@example.com', 'cookie-password')).toBe(401);
    });

    it('stores one password per user, without the email', async () => {
        const stored: PasswordCredentials[] = await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(
            repositoryTokenFor(PasswordCredentials)
        ).findAll({ take: 'all' });

        expect(stored.map(c => Object.keys(c).sort())).toStrictEqual([0, 1, 2].map(() => ['id', 'password', 'userId']));
    });
});

describe('PasswordAuthenticator — passwords 2.x hashed with bcrypt', () => {
    const email: string = 'hashed-by-2x@example.com';
    const password: string = 'secure123';
    const migrations: Newable<Migration>[] = [];

    /**
     * The data source of both versions. Allowed to go unused, because the other cases in this file
     * boot without it.
     */
    @DataSource({ allowOrphan: true })
    class UpgradedDataSource extends InMemoryDataSource {
        override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
        override readonly migrations: Newable<Migration>[] = migrations;
    }

    /**
     * The step of the upgrade migration that retires bcrypt, as the upgrade guide gives it.
     */
    @Injectable()
    class RetireBcryptMigration extends Migration {
        version: SemVerVersion = '1.0.0';

        constructor() {
            super(UpgradedDataSource);
        }

        override async up(transaction: Transaction): Promise<void> {
            const strategies: Repository<HashStrategyEntity, HashStrategyEntityCreateData> = this.dataSource.getRepository(HashStrategyEntity);
            await strategies.updateAll({ name: 'bcrypt' }, { status: HashStrategyStatus.DEPRECATED }, { transaction });
            await strategies.create({ name: 'scrypt', version: 'v1', status: HashStrategyStatus.DEFAULT }, { transaction });
        }

        // eslint-disable-next-line typescript/require-await
        override async down(): Promise<void> {
            throw new Error('Not needed for this test.');
        }
    }

    let server: StartedTestServer;
    let baseUrl: string;

    /**
     * The strategy the stored password of a user was hashed with.
     * @param userEmail - The email of the user.
     * @returns The name of the strategy, eg. `scrypt`.
     */
    async function findStoredStrategy(userEmail: string): Promise<string> {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).findOne({ where: { email: userEmail } });
        const stored: PasswordCredentials = await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(
            repositoryTokenFor(PasswordCredentials)
        ).findOne({ where: { userId: user.id } });
        return HashUtilities.hashToContent(stored.password).strategyName;
    }

    beforeAll(async () => {
        // 2.x hashed with bcrypt alone, which its first hash recorded as the default strategy.
        // sha256 too, since the entities of 3.x name it
        server = await startTestServer({
            dataSources: [UpgradedDataSource],
            controllers: [JwtTestAuthController],
            providers: [
                ...defaultTestServerProviders,
                // eslint-disable-next-line typescript/no-deprecated
                defineProvider({ token: ZIBRI_DI_TOKENS.HASH_STRATEGIES, useValue: [BcryptHashStrategy, Sha256HashStrategy] })
            ]
        });
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password, userId: user.id });

        // the first start of 3.x, with bcrypt kept as the upgrade guide says
        migrations.push(RetireBcryptMigration);
        await server.reInit({
            providers: [
                ...defaultTestServerProviders,
                // eslint-disable-next-line typescript/no-deprecated
                defineProvider({ token: ZIBRI_DI_TOKENS.HASH_STRATEGIES, useValue: [ScryptHashStrategy, Sha256HashStrategy, BcryptHashStrategy] })
            ]
        });
        baseUrl = await server.start();
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('moves a password to scrypt the next time its user signs in', async () => {
        expect(await findStoredStrategy(email)).toBe('bcrypt');

        expect(await login(baseUrl, email, password)).toBe(200);

        expect(await findStoredStrategy(email)).toBe('scrypt');
        expect(await login(baseUrl, email, password)).toBe(200);
    });

    it('hashes a password set after the upgrade with scrypt', async () => {
        // the table named bcrypt the default, so without the upgrade every new password stayed bcrypt
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: 'after-the-upgrade@example.com', roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password, userId: user.id });

        expect(await findStoredStrategy('after-the-upgrade@example.com')).toBe('scrypt');
    });
});

describe('PasswordAuthenticator — a password stored at a cost that has since been raised', () => {
    let server: StartedTestServer;
    let userId: string;

    const email: string = 'password-upgrade@example.com';
    const password: string = 'secure123';

    /**
     * The stored hash's cost part, which scrypt writes first in the value.
     * @returns What the stored password was derived at, e.g. `n=16384,r=8,p=1`.
     */
    async function findStoredCost(): Promise<string | undefined> {
        const credentialsRepo: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
        const stored: PasswordCredentials = await credentialsRepo.findOne({ where: { userId } });
        return HashUtilities.hashToContent(stored.password).hashedValue.split(':')[0];
    }

    beforeAll(async () => {
        // the earlier deployment: the same application, configured more cheaply
        server = await startTestServer({
            controllers: [JwtTestAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.SCRYPT_COST, useFactory: (): ScryptCost => ({ n: 1024, r: 8, p: 1 }) })
            ]
        });
        const userRepo: Repository<JwtUser> = inject(repositoryTokenFor(JwtUser));
        const credentialsRepo: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
        const user: JwtUser = await userRepo.create({ email, roles: [Roles.USER] });
        userId = user.id;
        await credentialsRepo.create({ password, userId });
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('rewrites the hash at the current cost on the next successful login', async () => {
        expect(await findStoredCost()).toBe('n=1024,r=8,p=1');

        // redeployed on the same database with the cost raised
        await server.reInit({ providers: defaultTestServerProviders });
        const baseUrl: string = await server.start();

        expect(await login(baseUrl, email, password)).toBe(200);
        // needsRehash had no production caller, so a stored hash stayed at whatever it was made
        // with for as long as the account existed, and raising the cost upgraded nobody
        expect(await findStoredCost()).toBe('n=16384,r=8,p=1');
        expect(await login(baseUrl, email, password)).toBe(200);
    });
});