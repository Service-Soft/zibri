import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AuthServiceInterface } from './auth-service.interface';
import { Auth } from './decorators/auth.decorator';
import { HasRoleMetadata } from './models/has-role-metadata.model';
import { IsLoggedInMetadata } from './models/is-logged-in-metadata.model';
import { IsNotLoggedInMetadata } from './models/is-not-logged-in-metadata.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from './models/password-reset-token.model';
import { Require2faMetadata } from './models/require-2fa-metadata.model';
import { AuthStrategies } from './strategies/auth-strategies.model';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DefaultTestServerUserRepository } from '../__testing__/test-server/user-repository';
import { HttpRequestContext } from '../context/request/http-request.context';
import { Repository } from '../data-source/repository/repository';
import { Transaction } from '../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Email } from '../email/models/email.model';
import { InvalidDecoratorCombinationError } from '../error-handling/errors/invalid-decorator-combination.error';
import { LoggerInterface } from '../logging/logger.interface';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { JwtAuthData } from './strategies/jwt/jwt-auth-data.model';
import { JwtCredentials, JwtCredentialsCreateData } from './strategies/jwt/jwt-credentials.model';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';

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

    @Get('/2fa-required')
    @Auth.require2fa([])
    require2fa(): void {}

    @Get('/logged-out-only')
    @Auth.isNotLoggedIn([JwtAuthStrategy])
    loggedOutOnly(): void {}

    @Get('/skip-auth')
    @Auth.skip()
    skipAuth(): void {}

    @Get('/skip-auth-allowed-redundant')
    @Auth.skip({ allowRedundant: true })
    skipAuthAllowedRedundant(): void {}
}

// ----- controller with conflicting route-level decorator combinations -----
// orphans on purpose: an application that registers a route whose declaration nothing can satisfy
// does not boot, so these are resolved directly rather than mounted
@Controller('/route-conflict', { allowOrphan: true })
class RouteConflictController {
    @Get('/is-logged-in-and-skip')
    @Auth.isLoggedIn([JwtAuthStrategy])
    @Auth.skip()
    isLoggedInAndSkip(): void {}

    @Get('/is-logged-in-and-is-logged-in-skip')
    @Auth.isLoggedIn([JwtAuthStrategy])
    @Auth.isLoggedIn.skip()
    isLoggedInAndIsLoggedInSkip(): void {}

    @Get('/is-not-logged-in-and-skip')
    @Auth.isNotLoggedIn([JwtAuthStrategy])
    @Auth.skip()
    isNotLoggedInAndSkip(): void {}

    @Get('/is-not-logged-in-and-is-not-logged-in-skip')
    @Auth.isNotLoggedIn([JwtAuthStrategy])
    @Auth.isNotLoggedIn.skip()
    isNotLoggedInAndIsNotLoggedInSkip(): void {}

    @Get('/has-role-and-skip')
    @Auth.hasRole([Roles.ADMIN], [JwtAuthStrategy])
    @Auth.skip()
    hasRoleAndSkip(): void {}

    @Get('/has-role-and-has-role-skip')
    @Auth.hasRole([Roles.ADMIN], [JwtAuthStrategy])
    @Auth.hasRole.skip()
    hasRoleAndHasRoleSkip(): void {}

    @Get('/require-2fa-and-skip')
    @Auth.require2fa([])
    @Auth.skip()
    require2faAndSkip(): void {}

    @Get('/require-2fa-and-require-2fa-skip')
    @Auth.require2fa([])
    @Auth.require2fa.skip()
    require2faAndRequire2faSkip(): void {}
}

// ----- controller with conflicting controller-level decorator combinations -----
// Each pair only conflicts with its own counterpart (distinct metadata namespaces), so they can
// all be stacked on one controller instead of needing five near-identical classes.
@Auth.isLoggedIn([JwtAuthStrategy])
@Auth.isLoggedIn.skip()
@Auth.isNotLoggedIn([JwtAuthStrategy])
@Auth.isNotLoggedIn.skip()
@Auth.hasRole([Roles.ADMIN], [JwtAuthStrategy])
@Auth.hasRole.skip()
@Auth.require2fa([])
@Auth.require2fa.skip()
@Controller('/controller-conflict', { allowOrphan: true })
class ControllerLevelConflictController {
    @Get('/x')
    x(): void {}
}

// ----- controller-level check beside a controller-level @Auth.skip -----
// Only expressible since @Auth.skip gained a class form. The two say opposite things, and without a
// conflict check the check wins silently - leaving a skip that reads like it opens the controller
// and does nothing. Stacked like the controller above, for the same reason.
@Auth.isLoggedIn([JwtAuthStrategy])
@Auth.isNotLoggedIn([JwtAuthStrategy])
@Auth.hasRole([Roles.ADMIN], [JwtAuthStrategy])
@Auth.require2fa([])
@Auth.skip()
@Controller('/controller-skip-conflict', { allowOrphan: true })
class ControllerSkipConflictController {
    @Get('/x')
    x(): void {}
}

// ----- a controller-level @Auth.skip with nothing to skip -----
@Auth.skip()
@Controller('/controller-skip')
class ControllerSkipController {
    @Get('/x')
    x(): void {}
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
            dataSources: [createTestDataSource({ entities: defaultTestServerEntities })],
            // the three conflict controllers are deliberately not registered: a route whose
            // declaration nothing can satisfy is refused while it is being registered, so an
            // application carrying one does not boot. They are resolved directly below instead,
            // which is the same call the router makes.
            controllers: [DummyController, ControllerSkipController]
        });
        authService = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        userRepo = inject(DefaultTestServerUserRepository);
        credentialsRepository = inject(repositoryTokenFor(JwtCredentials));
    }, 15000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    beforeEach(async () => {
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

        it('resolveRequire2faMetadata reads @Auth.require2fa', async () => {
            const meta: Require2faMetadata | undefined = await authService.resolveRequire2faMetadata(DummyController, 'require2fa');
            expect(meta).toBeDefined();
        });
    });

    // --------- conflicting decorator combinations ----------
    describe('rejects conflicting decorator combinations', () => {
        describe('route-level: @Auth.X + @Auth.skip()', () => {
            it('resolveIsLoggedInMetadata throws for @Auth.isLoggedIn + @Auth.skip', async () => {
                await expect(
                    async () => await authService.resolveIsLoggedInMetadata(RouteConflictController, 'isLoggedInAndSkip')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveIsNotLoggedInMetadata throws for @Auth.isNotLoggedIn + @Auth.skip', async () => {
                await expect(
                    async () => await authService.resolveIsNotLoggedInMetadata(RouteConflictController, 'isNotLoggedInAndSkip')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveHasRoleMetadata throws for @Auth.hasRole + @Auth.skip', async () => {
                await expect(
                    async () => await authService.resolveHasRoleMetadata(RouteConflictController, 'hasRoleAndSkip')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveRequire2faMetadata throws for @Auth.require2fa + @Auth.skip', async () => {
                await expect(
                    async () => await authService.resolveRequire2faMetadata(RouteConflictController, 'require2faAndSkip')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });
        });

        describe('route-level: @Auth.X + @Auth.X.skip()', () => {
            it('resolveIsLoggedInMetadata throws for @Auth.isLoggedIn + @Auth.isLoggedIn.skip', async () => {
                await expect(
                    async () => await authService.resolveIsLoggedInMetadata(RouteConflictController, 'isLoggedInAndIsLoggedInSkip')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveIsNotLoggedInMetadata throws for @Auth.isNotLoggedIn + @Auth.isNotLoggedIn.skip', async () => {
                await expect(
                    async () => await authService.resolveIsNotLoggedInMetadata(RouteConflictController, 'isNotLoggedInAndIsNotLoggedInSkip')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveHasRoleMetadata throws for @Auth.hasRole + @Auth.hasRole.skip', async () => {
                await expect(
                    async () => await authService.resolveHasRoleMetadata(RouteConflictController, 'hasRoleAndHasRoleSkip')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveRequire2faMetadata throws for @Auth.require2fa + @Auth.require2fa.skip', async () => {
                await expect(
                    async () => await authService.resolveRequire2faMetadata(RouteConflictController, 'require2faAndRequire2faSkip')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });
        });

        describe('controller-level: @Auth.X + @Auth.X.skip()', () => {
            it('resolveIsLoggedInMetadata throws for @Auth.isLoggedIn + @Auth.isLoggedIn.skip', async () => {
                await expect(
                    async () => await authService.resolveIsLoggedInMetadata(ControllerLevelConflictController, 'x')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveIsNotLoggedInMetadata throws for @Auth.isNotLoggedIn + @Auth.isNotLoggedIn.skip', async () => {
                await expect(
                    async () => await authService.resolveIsNotLoggedInMetadata(ControllerLevelConflictController, 'x')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveHasRoleMetadata throws for @Auth.hasRole + @Auth.hasRole.skip', async () => {
                await expect(
                    async () => await authService.resolveHasRoleMetadata(ControllerLevelConflictController, 'x')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveRequire2faMetadata throws for @Auth.require2fa + @Auth.require2fa.skip', async () => {
                await expect(
                    async () => await authService.resolveRequire2faMetadata(ControllerLevelConflictController, 'x')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });
        });

        describe('controller-level: @Auth.X + @Auth.skip()', () => {
            it('resolveIsLoggedInMetadata throws for @Auth.isLoggedIn + @Auth.skip', async () => {
                await expect(
                    async () => await authService.resolveIsLoggedInMetadata(ControllerSkipConflictController, 'x')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveIsNotLoggedInMetadata throws for @Auth.isNotLoggedIn + @Auth.skip', async () => {
                await expect(
                    async () => await authService.resolveIsNotLoggedInMetadata(ControllerSkipConflictController, 'x')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveHasRoleMetadata throws for @Auth.hasRole + @Auth.skip', async () => {
                await expect(
                    async () => await authService.resolveHasRoleMetadata(ControllerSkipConflictController, 'x')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });

            it('resolveRequire2faMetadata throws for @Auth.require2fa + @Auth.skip', async () => {
                await expect(
                    async () => await authService.resolveRequire2faMetadata(ControllerSkipConflictController, 'x')
                ).rejects.toThrow(InvalidDecoratorCombinationError);
            });
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

        // the three below resolve the declaration rather than check a request against it, because
        // that is when the warning is due: the router resolves each route once while registering it,
        // and whoever serves a request reads the answer back out of the route registry
        it('warns that @Auth.skip is useless when no other auth rule is configured for the route', () => {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            // eslint-disable-next-line typescript/typedef
            const warnSpy = jest.spyOn(logger, 'warn');

            authService.resolveRouteAuth(DummyController, 'skipAuth');

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Useless @Auth.skip'));
            warnSpy.mockRestore();
        });

        it('warns that a controller-level @Auth.skip is useless when the controller has no auth rules', () => {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            // eslint-disable-next-line typescript/typedef
            const warnSpy = jest.spyOn(logger, 'warn');

            authService.resolveRouteAuth(ControllerSkipController, 'x');

            // named as the controller rather than the route, because that is where the decorator is
            // and where it has to be removed
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Useless @Auth.skip on controller'));
            warnSpy.mockRestore();
        });

        it('stays quiet about a redundant @Auth.skip that says it is redundant', () => {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            // eslint-disable-next-line typescript/typedef
            const warnSpy = jest.spyOn(logger, 'warn');

            authService.resolveRouteAuth(DummyController, 'skipAuthAllowedRedundant');

            // what a controller shipped by a library needs: it has to state its own posture because
            // it cannot know the application's, and the warning above would leave it no way to be
            // correct under both defaults at once
            expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Useless @Auth.skip'));
            warnSpy.mockRestore();
        });

        it('throws when logged in for logged-out-only', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value);
            await expect(
                authService.checkAccess(DummyController, 'loggedOutOnly', ctx)
            ).rejects.toThrow();
        });

        it('succeeds when not logged in for logged-out-only', async () => {
            const ctx: HttpRequestContext = buildContext();
            await expect(
                authService.checkAccess(DummyController, 'loggedOutOnly', ctx)
            ).resolves.toBeUndefined();
        });

        it('throws for 2fa-required when the user has not set up any second factor', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value);
            await expect(
                authService.checkAccess(DummyController, 'require2fa', ctx)
            ).rejects.toThrow();
        });

    });

    // --------- resilience: empty/failing strategies ----------
    describe('resilience to empty or failing strategies', () => {
        it('isLoggedIn returns false (not throws) for an empty strategies array', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value);
            await expect(authService.isLoggedIn(ctx, [])).resolves.toBe(false);
        });

        it('hasRole returns false (not throws) for an empty strategies array', async () => {
            const ctx: HttpRequestContext = buildContext(adminAuthData.accessToken.value);
            await expect(authService.hasRole(ctx, [], [Roles.ADMIN])).resolves.toBe(false);
        });

    });

    // --------- password reset ----------
    describe('requestPasswordReset / confirmPasswordReset', () => {
        let resetTokenRepo: Repository<PasswordResetToken, PasswordResetTokenCreateData>;
        let emailRepo: Repository<Email>;

        /**
         * The reset token as the user gets it: out of the link in the email.
         *
         * The stored value is hashed, so the row cannot hand the token back - which is the point of
         * hashing it.
         * @returns The token from the most recently queued password reset email.
         */
        async function resetTokenFromEmail(): Promise<string> {
            const emails: Email[] = await emailRepo.findAll({ where: { recipients: { includes: [adminEmail] } } });
            const link: RegExpExecArray | null = /confirm-password-reset\/([\da-f]+)/.exec(emails.at(-1)?.html ?? '');
            if (!link?.[1]) {
                throw new Error('no password reset link was mailed');
            }
            return link[1];
        }

        beforeAll(() => {
            resetTokenRepo = inject(repositoryTokenFor(PasswordResetToken));
            emailRepo = inject(repositoryTokenFor(Email));
        });

        beforeEach(async () => {
            await emailRepo.deleteAll({});
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
            expect(tokens[0]?.value).toBeTruthy();
            expect(tokens[0]?.expirationDate).toBeInstanceOf(Date);
        });

        it('confirmPasswordReset with valid token updates password', async () => {
            // 1. Request reset → token created
            const transaction: Transaction = await userRepo.dataSource.startTransaction();
            await authService.requestPasswordReset(
                JwtAuthStrategy,
                { user: testAdmin, transaction }
            );
            await transaction.commit();
            const resetValue: string = await resetTokenFromEmail();

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