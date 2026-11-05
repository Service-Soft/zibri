import assert from 'node:assert';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { PasswordCredentials, PasswordCredentialsCreateData } from './password-credentials.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { JwtTestAuthController } from '../../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { Migration } from '../../../data-source/migration/migration.model';
import { Repository } from '../../../data-source/repository/repository';
import { RepositoryClass } from '../../../data-source/repository/repository-class.type';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider, DiProvider } from '../../../di/models/di-provider.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { PasswordRefusedError } from '../../../error-handling/errors/password-refused.error';
import { HttpStatus } from '../../../http/http-status.enum';
import { $ts } from '../../../localization/translate.function';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { SemVerVersion } from '../../../utilities/sem-ver.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { type HashString, HashUtilities } from '../../hash/hash.utilities';
import { BcryptHashStrategy } from '../../hash/strategies/bcrypt.hash-strategy';
import { HashStrategyEntity, HashStrategyEntityCreateData, HashStrategyStatus } from '../../hash/strategies/hash-strategy-entity.model';
import { ScryptHashStrategy } from '../../hash/strategies/scrypt.hash-strategy';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';
import { PasswordPolicy } from '../../password-policy/password-policy.model';

/**
 * The providers of this repository's test servers, without a password policy.
 */
const withoutPolicy: DiProvider<unknown>[] = defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.PASSWORD_POLICY);

/**
 * The providers of this repository's test servers, with the given password policy, which keeps the
 * passwords it no longer takes.
 * @param policy - The policy.
 * @returns The providers.
 */
function withPolicy(policy: OmitStrict<PasswordPolicy, 'outdatedPasswords'>): DiProvider<unknown>[] {
    return [...withoutPolicy, defineProvider({ token: ZIBRI_DI_TOKENS.PASSWORD_POLICY, useValue: { ...policy, outdatedPasswords: 'keep' } })];
}

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

/**
 * The passwords of the users.
 * @returns Their repository.
 */
function passwords(): Repository<PasswordCredentials, PasswordCredentialsCreateData> {
    return inject(repositoryTokenFor(PasswordCredentials));
}

/**
 * Creates a user without a password.
 * @param email - Their email.
 * @returns The user.
 */
async function createUser(email: string = `${UUIDUtilities.generate()}@policy.test`): Promise<JwtUser> {
    return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
}

/**
 * Writes a password the policy refuses, the way an application creates its first user when it starts.
 * @returns The credentials, which it never gets to.
 */
async function createDefaultAdminCredentials(): Promise<PasswordCredentials> {
    const user: JwtUser = await createUser();
    return await passwords().create({ userId: user.id, password: 'short 1' });
}

/**
 * Writes a password the policy refuses while answering a request.
 */
// an orphan for the cases in this file that boot without it
@Controller('/refused-passwords', { allowOrphan: true })
class RefusedPasswordController {
    @Post('/short')
    async writeShortPassword(): Promise<void> {
        await passwords().create({ userId: UUIDUtilities.generate(), password: 'short 1' });
    }
}

// a password was stored at any length, down to a single character, wherever it was written
describe('PasswordAuthenticator - the password policy', () => {
    describe('starting', () => {
        // one for every server of the block, each starting with its own store
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: defaultTestServerEntities,
            repositories: defaultTestServerRepositories,
            allowOrphan: true
        });

        it('refuses to start without a policy when an entity holds a password', async () => {
            await expect(startTestServer({ dataSources: [dataSourceClass], providers: withoutPolicy }))
                .rejects.toThrow(/PasswordCredentials\.password[\S\s]*ZIBRI_DI_TOKENS\.PASSWORD_POLICY/);
        }, TestTimeouts.inMemory.start);

        it('refuses a policy whose lengths contradict each other or the longest password a login takes', async () => {
            for (const policy of [{ minLength: 0 }, { minLength: 20, maxLength: 10 }, { minLength: 15, maxLength: 2000 }]) {
                await expect(startTestServer({ dataSources: [dataSourceClass], providers: withPolicy(policy) }))
                    .rejects.toThrow(/ZIBRI_DI_TOKENS\.PASSWORD_POLICY/);
            }
        }, TestTimeouts.inMemory.start * 3);

        it('refuses a policy whose minLength is past the longest password it takes by default', async () => {
            await expect(startTestServer({ dataSources: [dataSourceClass], providers: withPolicy({ minLength: 200 }) }))
                .rejects.toThrow(/maxLength must be a whole number from minLength/);
        }, TestTimeouts.inMemory.start);

        it('refuses a password hashed by a strategy that hashes one value the same way every time', async () => {
            @Entity({ tenant: 'shared', allowOrphan: true })
            class FastPasswordCredentials extends BaseEntity {
                @Property.string({ format: 'uuid' })
                userId!: string;

                @Property.string({ password: true, hash: { strategy: Sha256HashStrategy } })
                password!: HashString;
            }
            const fastDataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
                entities: [...defaultTestServerEntities, FastPasswordCredentials],
                repositories: defaultTestServerRepositories,
                allowOrphan: true
            });

            await expect(startTestServer({ dataSources: [fastDataSourceClass], providers: withPolicy({ minLength: 15 }) }))
                .rejects.toThrow(/FastPasswordCredentials\.password, hashed with "sha256"/);
        }, TestTimeouts.inMemory.start);
    });

    describe('a password written', () => {
        let server: StartedTestServer;
        let baseUrl: string;

        beforeAll(async () => {
            server = await startTestServer({
                controllers: [JwtTestAuthController, RefusedPasswordController],
                // allowed to go unused, because the other cases in this file boot without it
                dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true })],
                providers: withPolicy({
                    minLength: 15,
                    maxLength: 64,
                    validatePassword: password => {
                        if (!/\d/.test(password)) {
                            throw new BadRequestError($ts`A password needs to hold at least one digit.`);
                        }
                    }
                })
            });
            baseUrl = await server.start();
        }, TestTimeouts.inMemory.start);

        afterAll(async () => {
            await server?.shutdown();
        }, TestTimeouts.inMemory.shutdown);

        it('refuses one shorter or longer than the policy says, counting characters rather than code units', async () => {
            const user: JwtUser = await createUser();

            for (const password of ['short 1', `${'1'.repeat(65)}`, '🔑'.repeat(13) + '1']) {
                const refused: Promise<unknown> = passwords().create({ userId: user.id, password });
                await expect(refused).rejects.toBeInstanceOf(PasswordRefusedError);
                await expect(refused).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
            }
            expect(await passwords().findAll({ where: { userId: user.id } })).toHaveLength(0);
        });

        it('refuses one the policy\'s own check refuses, with what that check says', async () => {
            const user: JwtUser = await createUser();

            await expect(passwords().create({ userId: user.id, password: 'correct horse battery staple' }))
                .rejects.toThrow('A password needs to hold at least one digit.');
        });

        it('stores one the policy takes, hashed, which logs in', async () => {
            const user: JwtUser = await createUser();

            await passwords().create({ userId: user.id, password: 'correct horse battery staple 1' });

            const stored: PasswordCredentials = await passwords().findOne({ where: { userId: user.id } });
            expect(HashUtilities.hashToContent(stored.password).strategyName).toBe('scrypt');
            expect(await login(baseUrl, user.email, 'correct horse battery staple 1')).toBe(200);
        });

        it('refuses one changed to something the policy does not take, however it is written', async () => {
            const user: JwtUser = await createUser();
            const stored: PasswordCredentials = await passwords().create({ userId: user.id, password: 'correct horse battery staple 1' });

            await expect(passwords().updateById(stored.id, { password: 'short 1' })).rejects.toBeInstanceOf(PasswordRefusedError);
            await expect(passwords().updateAll({ userId: user.id }, { password: 'short 1' })).rejects.toBeInstanceOf(PasswordRefusedError);
            expect(await login(baseUrl, user.email, 'correct horse battery staple 1')).toBe(200);
        });
    });

    // jest raises the limit for its own reports, so these boot on what a process starts with
    describe('the stack trace of a refused password', () => {
        const startWithLimit: (stackTraceLimit: number | undefined) => Promise<StartedTestServer> = async stackTraceLimit => {
            Error.stackTraceLimit = 10;
            return await startTestServer({
                dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true })],
                providers: withPolicy({ minLength: 15 }),
                stackTraceLimit
            });
        };
        const jestLimit: number = Error.stackTraceLimit;

        afterEach(() => {
            Error.stackTraceLimit = jestLimit;
        });

        it('reaches the code that wrote the password', async () => {
            const server: StartedTestServer = await startWithLimit(undefined);
            try {
                const refused: unknown = await createDefaultAdminCredentials().catch((error: unknown) => error);

                assert(refused instanceof PasswordRefusedError);
                expect(refused.stack).toContain('createDefaultAdminCredentials');
            }
            finally {
                await server.shutdown();
            }
        }, TestTimeouts.inMemory.start);

        it('keeps as many frames as the application says', async () => {
            const server: StartedTestServer = await startWithLimit(5);
            try {
                const refused: unknown = await createDefaultAdminCredentials().catch((error: unknown) => error);

                assert(refused instanceof PasswordRefusedError);
                expect(refused.stack).not.toContain('createDefaultAdminCredentials');
            }
            finally {
                await server.shutdown();
            }
        }, TestTimeouts.inMemory.start);
    });

    // the longest password defaulted to what a login takes, 1024 characters, where ASVS 2.1.2 refuses
    // anything past 128
    describe('a policy without a maxLength', () => {
        let server: StartedTestServer;

        beforeAll(async () => {
            server = await startTestServer({
                // allowed to go unused, because the other cases in this file boot without it
                dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true })],
                providers: withPolicy({ minLength: 15 })
            });
        }, TestTimeouts.inMemory.start);

        afterAll(async () => {
            await server?.shutdown();
        }, TestTimeouts.inMemory.shutdown);

        it('takes passwords of up to 128 characters', async () => {
            const user: JwtUser = await createUser();

            await expect(passwords().create({ userId: user.id, password: 'a'.repeat(129) })).rejects.toBeInstanceOf(PasswordRefusedError);
            await passwords().create({ userId: user.id, password: 'a'.repeat(128) });
        });
    });

    describe('a password stored before the policy asked for longer ones', () => {
        const email: string = 'stored-before-the-policy@example.com';
        const password: string = 'secure123';
        const migrations: Newable<Migration>[] = [];

        /**
         * The data source of both deployments. Allowed to go unused, because the other cases in this file
         * boot without it.
         */
        @DataSource({ allowOrphan: true })
        class UpgradedDataSource extends InMemoryDataSource {
            override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
            override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
            override readonly migrations: Newable<Migration>[] = migrations;
        }

        /**
         * Retires bcrypt, which makes the next login hash the password again.
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

        beforeAll(async () => {
            // the earlier deployment, which took short passwords and hashed them with bcrypt
            server = await startTestServer({
                dataSources: [UpgradedDataSource],
                controllers: [JwtTestAuthController],
                providers: [
                    ...withPolicy({ minLength: 8 }),
                    // eslint-disable-next-line typescript/no-deprecated
                    defineProvider({ token: ZIBRI_DI_TOKENS.HASH_STRATEGIES, useValue: [BcryptHashStrategy, Sha256HashStrategy] })
                ]
            });
            const user: JwtUser = await createUser(email);
            await passwords().create({ password, userId: user.id });

            migrations.push(RetireBcryptMigration);
            await server.reInit({
                providers: [
                    ...withPolicy({ minLength: 15 }),
                    // eslint-disable-next-line typescript/no-deprecated
                    defineProvider({ token: ZIBRI_DI_TOKENS.HASH_STRATEGIES, useValue: [ScryptHashStrategy, Sha256HashStrategy, BcryptHashStrategy] })
                ]
            });
            baseUrl = await server.start();
        }, TestTimeouts.inMemory.start * 2);

        afterAll(async () => {
            await server?.shutdown();
        }, TestTimeouts.inMemory.shutdown);

        it('still logs in, and keeps the hash it has without trying to write the password again', async () => {
            const warned: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');
            try {
                expect(await login(baseUrl, email, password)).toBe(200);

                const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).findOne({ where: { email } });
                const stored: PasswordCredentials = await passwords().findOne({ where: { userId: user.id } });
                expect(HashUtilities.hashToContent(stored.password).strategyName).toBe('bcrypt');
                expect(await login(baseUrl, email, password)).toBe(200);
                // a write the policy refuses on every login would warn on every login
                expect(warned.mock.calls.map(([message]) => String(message)).filter(m => m.includes('Could not upgrade'))).toEqual([]);
            }
            finally {
                warned.mockRestore();
            }
        });
    });
});