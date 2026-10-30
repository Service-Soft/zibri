import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { definePermissions, definePlatformPermissions } from './define-permissions.function';
import { type RoleServiceInterface } from './role-service.interface';
import { RoleUtilities } from './role.utilities';
import { ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from './zibri-permissions.model';
import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { TestRole } from '../../__testing__/mocks/entities/test-role.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { CurrentUser } from '../decorators/current-user.decorator';

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions([...ZIBRI_PERMISSIONS, 'invoices.read', 'invoices.export', 'audit.read'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions([...ZIBRI_PLATFORM_PERMISSIONS, 'reports.read'] as const);

const roles: TestServerRole[] = [
    { name: 'owner', level: 'tenant', permissions: ['*'], description: undefined },
    { name: 'invoicing', level: 'tenant', permissions: ['invoices.*', Permissions.AUDIT_READ], description: undefined },
    { name: 'operator', level: 'platform', permissions: ['*'], description: undefined }
];

let server: StartedTestServer | undefined;

/**
 * The role service of the running application.
 * @returns The service.
 */
function roleService(): RoleServiceInterface {
    return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
}

/**
 * A caller holding the given permissions.
 * @param permissions - The tenant permissions.
 * @param platformPermissions - The platform permissions.
 * @returns The caller.
 */
async function callerWith(permissions: CurrentUser['permissions'], platformPermissions: CurrentUser['platformPermissions']): Promise<CurrentUser> {
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: `${UUIDUtilities.generate()}@wildcard.test`, roles: [] });
    return { id: user.id, email: user.email, deactivatedAt: user.deactivatedAt, permissions, platformPermissions };
}

describe('RoleService - wildcard permissions', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
            providers: [
                ...defaultTestServerProviders,
                ...rolesAndPermissionsProviders(
                    { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                    roles
                )
            ]
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('carries every permission of its level for \'*\', and every one below a prefix for \'prefix.*\'', async () => {
        const tenantId: string = UUIDUtilities.generate();

        // what a release declares newly is carried at once, without a migration of the role's row
        expect(new Set(await roleService().resolvePermissionsOf(['owner'], tenantId))).toEqual(new Set(Object.values(Permissions)));
        expect(new Set(await roleService().resolvePermissionsOf(['invoicing'], tenantId)))
            .toEqual(new Set([Permissions.INVOICES_READ, Permissions.INVOICES_EXPORT, Permissions.AUDIT_READ]));
        expect(new Set(roleService().resolvePlatformPermissionsOf(['operator']))).toEqual(new Set(Object.values(PlatformPermissions)));
    });

    it('refuses a wildcard that matches no permission declared at the level of the role', () => {
        // a misspelled prefix carries nothing, which is a mistake rather than a role
        expect(() => roleService().validateRoleRows([{ level: 'tenant', permissions: ['invoice.*'] }])).toThrow(BadRequestError);
        expect(() => roleService().validateRoleRows([{ level: 'platform', permissions: ['invoices.*'] }])).toThrow(BadRequestError);
        expect(() => roleService().validateRoleRows([{ level: 'tenant', permissions: ['invoices.*', '*'] }])).not.toThrow();
    });

    it('lets only a caller managing roles with any permission define or hand out a role carrying a wildcard', async () => {
        // holding every permission there is today says nothing about the ones declared tomorrow, which
        // the wildcard hands out as well
        const everything: CurrentUser = await callerWith(Object.values(Permissions), Object.values(PlatformPermissions)
            .filter(p => p !== PlatformPermissions.AUTH_CREATE_ROLE_WITH_ANY_PERMISSION));
        await expect(roleService().createRole<TestRole>(
            everything,
            { name: 'everything', level: 'tenant', permissions: ['*'], description: undefined },
            undefined
        )).rejects.toThrow(ForbiddenError);

        const operator: CurrentUser = await callerWith([], [PlatformPermissions.AUTH_CREATE_ROLE_WITH_ANY_PERMISSION]);
        const created: TestRole = await roleService().createRole<TestRole>(
            operator,
            { name: 'reporting', level: 'tenant', permissions: ['invoices.*'], description: undefined },
            undefined
        );
        expect(created.permissions).toEqual(['invoices.*']);
    });
});

describe('RoleUtilities.expandPermissions', () => {
    const declared: ReadonlySet<string> = new Set(['invoices.read', 'invoices.export', 'invoices', 'audit.read']);

    it('expands a wildcard into what it matches, at a whole segment', () => {
        expect(RoleUtilities.expandPermissions(['invoices.*'], declared)).toEqual(['invoices.read', 'invoices.export']);
        expect(new Set(RoleUtilities.expandPermissions(['*'], declared))).toEqual(declared);
        expect(RoleUtilities.expandPermissions(['audit.read', 'audit.*'], declared)).toEqual(['audit.read']);
    });

    it('keeps a wildcard that matches nothing as it is, so the check of stored roles names it', () => {
        expect(RoleUtilities.expandPermissions(['gone.*', 'invoices.read'], declared)).toEqual(['gone.*', 'invoices.read']);
    });

    it('is never ambiguous, since no permission is defined with a \'*\'', () => {
        expect(() => definePermissions(['invoices.*'] as const)).toThrow(/holds a '\*'/);
        expect(() => definePlatformPermissions(['*'] as const)).toThrow(/holds a '\*'/);
    });
});