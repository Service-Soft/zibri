import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { AuthServiceInterface } from './auth-service.interface';
import { Auth } from './decorators/auth.decorator';
import { BelongsToMetadata } from './models/belongs-to-metadata.model';
import { HasRoleMetadata } from './models/has-role-metadata.model';
import { IsLoggedInMetadata } from './models/is-logged-in-metadata.model';
import { IsNotLoggedInMetadata } from './models/is-not-logged-in-metadata.model';
import { Require2faMetadata } from './models/require-2fa-metadata.model';
import { AuthStrategies } from './strategies/auth-strategies.model';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { HttpRequestContext } from '../context/request/http-request.context';
import { Repository } from '../data-source/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from './models/password-reset-token.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Newable } from '../types/newable.type';
import { JwtAuthData } from './strategies/jwt/jwt-auth-data.model';
import { JwtCredentials, JwtCredentialsCreateData } from './strategies/jwt/jwt-credentials.model';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';
import { DefaultTestServerUserRepository } from '../__testing__/test-server/user-repository';
import { Transaction } from '../data-source/transaction/transaction.model';

@Entity()
class Note extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.string({ format: 'uuid' })
    userId!: string;
}

// ----- dummy controller with auth decorators -----
@Controller('/dummy')
class DummyController {
    @Get('/open')
    open(): void {}

    @Get('/login-required')
    @Auth.isLoggedIn([JwtAuthStrategy])
    loginRequired(): void {}

    @Get('/admin-only')
    @Auth.hasRole([Roles.ADMIN], [JwtAuthStrategy])
    adminOnly(): void {}

    @Get('/note/:id')
    @Auth.belongsTo(Note, 'id', 'userId', [JwtAuthStrategy])
    belongsToNote(): void {}

    @Get('/2fa-required')
    @Auth.require2fa([])
    require2fa(): void {}

    @Get('/logged-out-only')
    @Auth.isNotLoggedIn([JwtAuthStrategy])
    loggedOutOnly(): void {}

    @Get('/skip-auth')
    @Auth.skip()
    skipAuth(): void {}
}

// ---- helper to build contexts ----
function buildContext(accessToken?: string, params?: Record<string, string>): HttpRequestContext {
    return {
        request: {
            headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
            params: params ?? {}
        },
        has: () => false
        // minimal other properties as needed by your actual HttpRequestContext interface
    } as unknown as HttpRequestContext;
}

let server: StartedTestServer;
let authService: AuthServiceInterface;
let userRepo: DefaultTestServerUserRepository;
let credentialsRepository: Repository<JwtCredentials, JwtCredentialsCreateData>;
let noteRepo: Repository<Note>;
const strategies: AuthStrategies = [JwtAuthStrategy];

const adminEmail: string = 'auth-test@example.com';
const adminPassword: string = 'secure123';
const userEmail: string = 'auth-test2@example.com';
const userPassword: string = 'secure123';

describe('AuthService contract', () => {
    let testAdmin: JwtUser;
    let testUser: JwtUser;
    let adminAuthData: JwtAuthData<Roles>;
    let userAuthData: JwtAuthData<Roles>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Note] })],
            controllers: [DummyController]
        });
        authService = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        userRepo = inject(DefaultTestServerUserRepository);
        credentialsRepository = inject(repositoryTokenFor(JwtCredentials));
        noteRepo = inject(repositoryTokenFor(Note));
    }, 15000);

    afterAll(async () => {
        await server.shutdown();
    });

    beforeEach(async () => {
        await noteRepo.deleteAll({});
        await userRepo.deleteAll({});
        await credentialsRepository.deleteAll({});

        testAdmin = await userRepo.create({
            email: adminEmail,
            roles: [Roles.USER, Roles.ADMIN]
        });
        await credentialsRepository.create({ email: adminEmail, password: adminPassword, userId: testAdmin.id });
        testUser = await userRepo.create({
            email: userEmail,
            roles: [Roles.USER]
        });
        await credentialsRepository.create({ email: userEmail, password: userPassword, userId: testUser.id });

        adminAuthData = await authService.login(
            JwtAuthStrategy<Roles>,
            { email: adminEmail, password: adminPassword }
        );
        userAuthData = await authService.login(
            JwtAuthStrategy<Roles>,
            { email: userEmail, password: userPassword }
        );
    });

    // --------- login & logout ----------
    describe('login / logout / refresh', () => {
        it('login returns valid auth data', () => {
            expect(adminAuthData.accessToken).toBeTruthy();
            expect(adminAuthData.refreshToken).toBeTruthy();
            expect(adminAuthData.roles).toBeTruthy();
            expect(adminAuthData.userId).toBeTruthy();
        });

        it('refreshLogin returns fresh auth data', async () => {
            const transaction: Transaction = await userRepo.dataSource.startTransaction();
            const refreshed: JwtAuthData<Roles> = await authService.refreshLogin(
                JwtAuthStrategy<Roles>,
                { refreshToken: adminAuthData.refreshToken.value, transaction }
            );
            await transaction.commit();

            expect(refreshed).toHaveProperty('accessToken');
            expect(refreshed.accessToken).not.toBe(adminAuthData.accessToken);
        });

        it('logout invalidates the refresh token (refreshLogin fails)', async () => {
            await authService.logout(
                JwtAuthStrategy,
                { refreshToken: adminAuthData.refreshToken.value }
            );
            // Attempt to refresh after logout – must throw.
            await expect(
                authService.refreshLogin(
                    JwtAuthStrategy<Roles>,
                    { refreshToken: adminAuthData.refreshToken.value, transaction: await userRepo.dataSource.startTransaction() }
                )
            ).rejects.toThrow();
        });
    });

    // --------- getCurrentUser ----------
    describe('getCurrentUser', () => {
        it('returns the logged in user', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value);
            const current: JwtUser = await authService.getCurrentUser(ctx, strategies, true);
            expect(current.id).toBe(testAdmin.id);
            expect(current.email).toBe(adminEmail);
        });

        it('required=false returns undefined without token', async () => {
            const ctx: HttpRequestContext = buildContext();
            const current: JwtUser | undefined = await authService.getCurrentUser(ctx, strategies, false);
            expect(current).toBeUndefined();
        });

        it('required=true throws without token', async () => {
            const ctx: HttpRequestContext = buildContext();
            await expect(
                authService.getCurrentUser(ctx, strategies, true)
            ).rejects.toThrow();
        });
    });

    // --------- isLoggedIn / hasRole ----------
    describe('isLoggedIn / hasRole', () => {
        it('isLoggedIn returns true with valid token', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value);
            expect(await authService.isLoggedIn(ctx, strategies)).toBe(true);
        });

        it('isLoggedIn returns false without token', async () => {
            const ctx: HttpRequestContext = buildContext();
            expect(await authService.isLoggedIn(ctx, strategies)).toBe(false);
        });

        it('hasRole returns true if role present', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value);
            expect(await authService.hasRole(ctx, strategies, [Roles.ADMIN])).toBe(true);
        });

        it('hasRole returns false if role missing', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value);
            expect(await authService.hasRole(ctx, strategies, ['nonexistent'])).toBe(false);
        });

        it('hasRole returns false without token', async () => {
            const ctx: HttpRequestContext = buildContext();
            expect(await authService.hasRole(ctx, strategies, [Roles.USER])).toBe(false);
        });
    });

    // --------- belongsTo ----------
    describe('belongsTo', () => {
        let note: Note;

        beforeEach(async () => {
            note = await noteRepo.create({ title: 'my note', userId: testAdmin.id });
        });

        it('returns true for owned resource', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value, { id: note.id });
            const result: boolean = await authService.belongsTo(ctx, strategies, Note, 'userId', 'id');
            expect(result).toBe(true);
        });

        it('returns false for resource owned by someone else', async () => {
            const ctx: HttpRequestContext = buildContext(userAuthData.accessToken.value, { id: note.id });
            const result: boolean = await authService.belongsTo(ctx, strategies, Note, 'userId', 'id');
            expect(result).toBe(false);
        });
    });

    // --------- metadata resolvers ----------
    describe('resolve*Metadata', () => {
        it('resolveIsLoggedInMetadata reads @Auth.isLoggedIn', async () => {
            const meta: IsLoggedInMetadata | undefined = await authService.resolveIsLoggedInMetadata(DummyController, 'loginRequired');
            expect(meta).toBeDefined();
            expect((meta as IsLoggedInMetadata).allowedStrategies).toEqual([JwtAuthStrategy]);
        });

        it('resolveIsNotLoggedInMetadata reads @Auth.isNotLoggedIn', async () => {
            const meta: IsNotLoggedInMetadata | undefined = await authService.resolveIsNotLoggedInMetadata(DummyController, 'loggedOutOnly');
            expect(meta).toBeDefined();
        });

        it('resolveHasRoleMetadata reads @Auth.hasRole', async () => {
            const meta: HasRoleMetadata | undefined = await authService.resolveHasRoleMetadata(DummyController, 'adminOnly');
            expect(meta).toBeDefined();
            const hasRoleMeta: HasRoleMetadata = meta as HasRoleMetadata;
            expect(hasRoleMeta.allowedRoles).toEqual([Roles.ADMIN]);
        });

        it('resolveBelongsToMetadata reads @Auth.belongsTo', async () => {
            const meta: BelongsToMetadata<Newable<BaseEntity>> | undefined = await authService.resolveBelongsToMetadata(DummyController, 'belongsToNote');
            expect(meta).toBeDefined();
            const belongsMeta: BelongsToMetadata<Newable<BaseEntity>> = meta as BelongsToMetadata<Newable<BaseEntity>>;
            expect(belongsMeta.targetEntity).toBe(Note);
            expect(belongsMeta.targetUserIdKey).toBe('userId');
        });

        it('resolveRequire2faMetadata reads @Auth.require2fa', async () => {
            const meta: Require2faMetadata | undefined = await authService.resolveRequire2faMetadata(DummyController, 'require2fa');
            expect(meta).toBeDefined();
        });
    });

    // --------- checkAccess ----------
    describe('checkAccess', () => {
        it('throws when not logged in for loginRequired', async () => {
            const ctx: HttpRequestContext = buildContext();
            await expect(
                authService.checkAccess(DummyController, 'loginRequired', ctx)
            ).rejects.toThrow();
        });

        it('succeeds when logged in for loginRequired', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value);
            await expect(
                authService.checkAccess(DummyController, 'loginRequired', ctx)
            ).resolves.toBeUndefined();
        });

        it('throws when missing role for adminOnly', async () => {
            const ctx: HttpRequestContext = buildContext(userAuthData.accessToken.value);
            await expect(
                authService.checkAccess(DummyController, 'adminOnly', ctx)
            ).rejects.toThrow();
        });

        it('succeeds when role present for adminOnly', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value);
            await expect(
                authService.checkAccess(DummyController, 'adminOnly', ctx)
            ).resolves.toBeUndefined();
        });

        it('skip auth always succeeds', async () => {
            const ctx: HttpRequestContext = buildContext();
            await expect(
                authService.checkAccess(DummyController, 'skipAuth', ctx)
            ).resolves.toBeUndefined();
        });
    });

    // --------- password reset ----------
    describe('requestPasswordReset / confirmPasswordReset', () => {
        let resetTokenRepo: Repository<PasswordResetToken, PasswordResetTokenCreateData>;

        beforeAll(() => {
            resetTokenRepo = inject(repositoryTokenFor(PasswordResetToken));
        });

        beforeEach(async () => {
            await resetTokenRepo.deleteAll({});
        });

        it('requestPasswordReset creates a reset token', async () => {
            const transaction: Transaction = await userRepo.dataSource.startTransaction();
            await authService.requestPasswordReset(
                JwtAuthStrategy,
                { user: testAdmin, transaction }
            );
            await transaction.commit();

            const tokens: PasswordResetToken[] = await resetTokenRepo.findAll({ where: { userId: testAdmin.id } });
            expect(tokens).toHaveLength(1);
            expect(tokens[0].value).toBeTruthy();
            expect(tokens[0].expirationDate).toBeInstanceOf(Date);
        });

        it('confirmPasswordReset with valid token updates password', async () => {
            // 1. Request reset → token created
            const transaction: Transaction = await userRepo.dataSource.startTransaction();
            await authService.requestPasswordReset(
                JwtAuthStrategy,
                { user: testAdmin, transaction }
            );
            await transaction.commit();
            const tokens: PasswordResetToken[] = await resetTokenRepo.findAll({ where: { userId: testAdmin.id } });
            const resetValue: string = tokens[0].value;

            // 2. Confirm reset with new password
            const transaction2: Transaction = await userRepo.dataSource.startTransaction();
            await authService.confirmPasswordReset(
                JwtAuthStrategy,
                { resetToken: resetValue, newPassword: 'newPass456', transaction: transaction2 }
            );
            await transaction2.commit();

            // 3. Verify the token is consumed (deleted / no longer valid)
            const afterTokens: PasswordResetToken[] = await resetTokenRepo.findAll({ where: { userId: testAdmin.id } });
            expect(afterTokens).toHaveLength(0);

            // 4. Verify login with new password works
            const authData: JwtAuthData<Roles> = await authService.login(
                JwtAuthStrategy<Roles>,
                { email: adminEmail, password: 'newPass456' }
            );
            expect(authData.accessToken).toBeTruthy();
        });
    });
});