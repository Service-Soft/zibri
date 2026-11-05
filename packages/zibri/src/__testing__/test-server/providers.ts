import { defaultTestProviders } from 'zibri-testing';

import { DefaultTestServerRoleRepository } from './role-repository';
import { PasswordResetEmailTemplate } from '../../auth/authenticators/password/password-reset-email-template.model';
import { PermissionDeclaration } from '../../auth/roles/permission-declaration.model';
import { RoleCreateData } from '../../auth/roles/role-create-data.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { AfterAppInit } from '../../global/after-app-init.interface';
import { Ms } from '../../utilities/ms';
import { compileTsxTemplate } from '../compile-tsx-template.function';
import { testVersionsFolder } from '../constants';
import { MemberRoles } from '../mocks/entities/member-roles.enum';
import { Roles } from '../mocks/entities/roles.enum';
import { TestPermissions, TestPlatformPermissions } from '../mocks/entities/test-permissions.model';
import { TestRole } from '../mocks/entities/test-role.entity';

export { testMasterKey } from 'zibri-testing';

/**
 * A role a test server starts with.
 */
export type TestServerRole = RoleCreateData<TestRole>;

/**
 * The permissions of this repository's test fixtures: one per role, named like it. A suite about
 * what roles carry declares its own.
 */
export const defaultTestServerPermissions: PermissionDeclaration = {
    permissions: Object.values(TestPermissions),
    platformPermissions: Object.values(TestPlatformPermissions)
};

/**
 * The roles of this repository's test fixtures: `Roles` held by users, `MemberRoles` by memberships,
 * each carrying the one permission named like it.
 */
export const defaultTestServerRoles: TestServerRole[] = [
    { name: Roles.ADMIN, level: 'platform', permissions: [TestPlatformPermissions.ADMIN], description: undefined },
    { name: Roles.USER, level: 'platform', permissions: [TestPlatformPermissions.USER], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: [TestPermissions.MEMBER_ADMIN], description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [TestPermissions.MEMBER_USER], description: undefined }
];

/**
 * The roles a test server is seeded with, which an application seeds in a migration.
 */
const TEST_SERVER_ROLES: InjectionToken<TestServerRole[]> = new InjectionToken('test.server_roles');

/**
 * Seeds the roles of `TEST_SERVER_ROLES` once the application is up, leaving those that exist alone,
 * so that a restarted application on the same data starts with the same roles.
 */
class TestServerRoleSeeder implements AfterAppInit {
    async afterAppInit(): Promise<void> {
        const repository: DefaultTestServerRoleRepository = inject(DefaultTestServerRoleRepository);
        const existing: Set<string> = new Set((await repository.findAll({ limit: 'all' })).map(role => role.name));
        const missing: TestServerRole[] = inject(TEST_SERVER_ROLES).filter(role => !existing.has(role.name));
        if (missing.length) {
            await repository.createAll(missing);
        }
    }
}

/**
 * The providers declaring the permissions of a test server and seeding its roles. For a suite about
 * what roles carry, in place of those of the fixtures, and for one booting without
 * `defaultTestServerProviders`, such as an instance of a cluster.
 * @param declaration - The permissions, or undefined for none.
 * @param roles - The roles the test server starts with.
 * @returns The providers, to put after `defaultTestServerProviders` or the harness's own.
 */
export function rolesAndPermissionsProviders(
    declaration: PermissionDeclaration | undefined,
    roles: TestServerRole[]
): DiProvider<unknown>[] {
    return [
        defineProvider({ token: ZIBRI_DI_TOKENS.PERMISSIONS, useFactory: (): PermissionDeclaration | undefined => declaration }),
        defineProvider({ token: TEST_SERVER_ROLES, useValue: roles }),
        defineProvider({ token: TestServerRoleSeeder, useClass: TestServerRoleSeeder })
    ];
}

/**
 * The password policy of this repository's test servers and cluster instances: any password at all,
 * since the fixtures log in with short ones, and a suite about the policy provides its own. Over the
 * harness's own, which takes what an application takes.
 */
export const testServerPasswordPolicyProvider: DiProvider<unknown> = defineProvider({
    token: ZIBRI_DI_TOKENS.PASSWORD_POLICY,
    useValue: { minLength: 1, outdatedPasswords: 'keep' }
});

/**
 * What this repository's own test servers run with.
 *
 * The harness's defaults, plus what is about *this* repository rather than about running a Zibri
 * application in a test: where its version folders live, a password reset template compiled from a
 * string instead of a file, and its TypeScript worker files.
 */
export const defaultTestServerProviders: DiProvider<unknown>[] = [
    ...defaultTestProviders,
    defineProvider({
        token: ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE,
        // eslint-disable-next-line typescript/no-explicit-any
        useValue: compileTsxTemplate<PasswordResetEmailTemplate<any, any>>(
            'export const Email = ({ confirmPasswordResetLink }) => <a href={confirmPasswordResetLink}></a>;'
        )
    }),
    // the real versioning service, writing into this repository's own file-output folder rather than
    // into the scratch directory the harness hands out: these suites share one recorded history on
    // purpose, and `file-output` is where everything this repository writes during a test goes.
    defineProvider({
        token: ZIBRI_DI_TOKENS.VERSIONS_PATH,
        useValue: testVersionsFolder
    }),
    // the worker files of this repository's suites are TypeScript, run from the sources
    defineProvider({
        token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS_INPUT,
        useValue: { enableTsWorkerFiles: true }
    }),
    // what an application with websockets has to say, said once for the suites that only boot a
    // websocket controller. Here rather than in the harness's defaults: an application's own tests
    // should fail the way the application does when it forgot
    defineProvider({
        token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
        useValue: { messageRetentionInMs: Ms.DAY }
    }),
    testServerPasswordPolicyProvider,
    // the permissions and roles of this repository's fixtures, for the reason above: an application's
    // own tests declare their own permissions, and seed their own roles
    ...rolesAndPermissionsProviders(defaultTestServerPermissions, defaultTestServerRoles)
];