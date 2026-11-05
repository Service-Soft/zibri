import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { definePermissions, definePlatformPermissions } from './roles/define-permissions.function';
import { ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from './roles/zibri-permissions.model';
import { TestTimeouts } from '../__testing__/constants';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';
import { JwtTestAuthController } from '../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { TestMembership } from '../__testing__/mocks/entities/test-membership.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { PasswordCredentials, PasswordCredentialsCreateData } from './authenticators/password/password-credentials.model';
import { Auth } from './decorators/auth.decorator';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { JsonUtilities } from '../utilities/json.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions([...ZIBRI_PERMISSIONS, 'invoices.read', 'invoices.export'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions([...ZIBRI_PLATFORM_PERMISSIONS] as const);

const roles: TestServerRole[] = [
    { name: 'user', level: 'platform', permissions: [], description: undefined },
    { name: 'accountant', level: 'tenant', permissions: [Permissions.INVOICES_READ], description: undefined }
];

const PASSWORD: string = 'correct horse battery staple';

@Controller('/invoices')
class InvoiceController {
    @Auth.hasPermission(Permissions.INVOICES_READ)
    @Get('/')
    list(): string[] {
        return [];
    }

    @Auth.hasPermission(Permissions.INVOICES_EXPORT)
    @Get('/export')
    export(): string[] {
        return [];
    }
}

const roundTrips: RoundTripCounter = new RoundTripCounter();
let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Creates a user who is an accountant in a new tenant, and logs them in.
 * @param name - What sets the user's email apart.
 * @returns The tenant and the access token of the login.
 */
async function loginAccountant(name: string): Promise<{ tenantId: string, accessToken: string }> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${name}@trusted.test`, roles: ['user'] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ userId: user.id, password: PASSWORD });
    const tenantId: string = UUIDUtilities.generate();
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
        tenantId,
        async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: ['accountant'] })
    );
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    const body: { accessToken: { value: string } } = await res.json() as { accessToken: { value: string } };
    return { tenantId, accessToken: body.accessToken.value };
}

/**
 * Calls a route in a tenant with an access token.
 * @param path - The route.
 * @param tenantId - The tenant.
 * @param accessToken - The token.
 * @returns The status of the answer.
 */
async function call(path: string, tenantId: string, accessToken: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}${path}`, {
        headers: { [KnownHeader.AUTHORIZATION]: `Bearer ${accessToken}`, 'x-tenant-id': tenantId }
    });
    await res.arrayBuffer();
    return res.status;
}

/**
 * The reads of memberships recorded since the last reset.
 * @returns How many there were.
 */
function countMembershipReads(): number {
    return roundTrips.trips.filter(trip => trip.statement.startsWith(`${TestMembership.name}.`)).length;
}

// trusting the credential saved the read of the user, and every request in a tenant still read
// the membership, so the option saved no round trip where most requests of a multi-tenant application are
describe('AuthService - checks that trust the credential, in a tenant', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, roundTrips })],
            authStrategies: [JwtAuthStrategy],
            controllers: [JwtTestAuthController, InvoiceController],
            providers: [
                ...defaultTestServerProviders,
                ...rolesAndPermissionsProviders(
                    { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                    roles
                ),
                defineProvider({ token: ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK, useFactory: () => false })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('decides a permission in a tenant from the token, without reading the membership', async () => {
        const { tenantId, accessToken } = await loginAccountant('reads-nothing');

        roundTrips.reset();
        expect(await call('/invoices', tenantId, accessToken)).toBe(200);
        expect(await call('/invoices/export', tenantId, accessToken)).toBe(403);
        expect(countMembershipReads()).toBe(0);
    });

    it('refuses a tenant the token names no membership in, without reading', async () => {
        const { accessToken } = await loginAccountant('other-tenant');

        roundTrips.reset();
        expect(await call('/invoices', UUIDUtilities.generate(), accessToken)).toBe(403);
        expect(countMembershipReads()).toBe(0);
    });
});