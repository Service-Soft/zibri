import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { AuthorizationServerController } from '../../auth/authorization-server/authorization-server-controller.model';
import { Auth } from '../../auth/decorators/auth.decorator';
import { definePermissions, definePlatformPermissions } from '../../auth/roles/define-permissions.function';
import { PermissionDeclaration } from '../../auth/roles/permission-declaration.model';
import { type Permission } from '../../auth/roles/permission.type';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { BaseScimProvisioner } from '../../auth/scim/base-scim-provisioner';
import { ScimController } from '../../auth/scim/scim-controller.model';
import { ScimGroupMember } from '../../auth/scim/scim-group-member.model';
import { ScimGroup } from '../../auth/scim/scim-group.model';
import { ScimUserValue } from '../../auth/scim/scim-user-value.model';
import { ScimUser } from '../../auth/scim/scim-user.model';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model';
import { ClientAccessTokenAuthStrategy } from '../../auth/strategies/client-access-token/client-access-token.auth-strategy';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { type HttpRequestContext } from '../../context/request/http-request.context';
import { type WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { denyAll, scopeFor } from '../../entity/models/entity-scope.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { TestTimeouts } from '../constants';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { MemberRoles } from '../mocks/entities/member-roles.enum';
import { Roles } from '../mocks/entities/roles.enum';
import { TestMembership } from '../mocks/entities/test-membership.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/03-auth-and-security.md A6.
 *
 * §A5 checked what routes declare. Everything else naming a role named free text: SCIM and the
 * authorization server took roles nothing checked, a scope could only ask for a permission by mapping
 * roles itself, and a check from the application's own code answered a misspelled name with a silent
 * no. SCIM and introspection name a permission now, checked when the application starts; a scope asks
 * for a permission the way a route does; and a check naming what is not declared still answers no,
 * and says so.
 */

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions(['notes.read-all', 'scim.provision'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions(['tokens.introspect'] as const);

const declared: PermissionDeclaration = {
    permissions: Object.values(Permissions),
    platformPermissions: Object.values(PlatformPermissions)
};

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: [PlatformPermissions.TOKENS_INTROSPECT], description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: [Permissions.NOTES_READ_ALL, Permissions.SCIM_PROVISION], description: undefined }
];

/**
 * A note, which its author reads, and a member allowed to read every note reads as well.
 */
@Entity({
    tenant: 'shared',
    scope: {
        restrictedTo: scopeFor<Note>(async context => {
            if (await context.hasPermission(Permissions.NOTES_READ_ALL)) {
                return undefined;
            }
            return context.currentUser == undefined ? denyAll : { authorId: context.currentUser.id };
        })
    }
})
class Note extends BaseEntity {
    @Property.string({ format: 'uuid' })
    authorId!: string;

    @Property.string()
    text!: string;
}

@Controller('/notes', { allowOrphan: true })
class NoteController {
    @Auth.isLoggedIn()
    @Get('/')
    async list(): Promise<string[]> {
        return (await notes().findAll()).map(note => note.text).sort();
    }
}

/**
 * What the application's own code asks of the request it handles.
 */
type CodeChecks = {
    undeclaredPermission: boolean,
    undeclaredPlatformPermission: boolean
};

@Controller('/code-checks', { allowOrphan: true })
class CodeChecksController {
    @Auth.isLoggedIn()
    @Get('/')
    async check(): Promise<CodeChecks> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const request: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (request == undefined) {
            throw new InternalError('A route is handled inside a request.');
        }
        // a plain string is no permission, so the compiler refuses a typo first: these are what code
        // reaching past it gets
        return {
            // @ts-expect-error - a plain string is no permission
            undeclaredPermission: await authService.hasPermission(request, authService.strategies, 'notes.delete'),
            // @ts-expect-error - a plain string is no permission
            undeclaredPlatformPermission: await authService.hasPlatformPermission(request, authService.strategies, 'tokens.revoke')
        };
    }
}

/**
 * Provisions nobody: the applications it is declared in are refused before anything is provisioned.
 */
class UnusedScimProvisioner extends BaseScimProvisioner<JwtUser, TestMembership> {
    async findProvisionedUser(): Promise<JwtUser | undefined> {
        return await Promise.reject(new InternalError('Nothing is provisioned in this suite.'));
    }

    async createProvisionedUser(): Promise<JwtUser> {
        return await Promise.reject(new InternalError('Nothing is provisioned in this suite.'));
    }

    async resolveUpdatedUser(): Promise<void> {
        await Promise.reject(new InternalError('Nothing is provisioned in this suite.'));
    }

    async resolveGroupMembership(): Promise<void> {
        await Promise.reject(new InternalError('Nothing is provisioned in this suite.'));
    }

    async resolveDeletedUser(): Promise<void> {
        await Promise.reject(new InternalError('Nothing is provisioned in this suite.'));
    }
}

@Controller('/scim/v2', { allowOrphan: true })
// @ts-expect-error - a plain string is no permission
class MisspelledScimController extends ScimController(UnusedScimProvisioner, { permission: 'scim.provisions' }) {}

@Controller('/oauth2', { allowOrphan: true })
// @ts-expect-error - a plain string is no permission
class MisspelledAuthorizationServerController extends AuthorizationServerController({ introspectionPermission: 'tokens.introspects', resources: [] }) {}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Starts an application keeping its data in memory, with the declaration of this suite.
 * @param controllers - The controllers it serves.
 * @param providers - What it runs with besides the defaults and the declaration.
 * @returns The server, started.
 */
async function startApp(controllers: Newable<unknown>[], providers: DiProvider<unknown>[] = []): Promise<StartedTestServer> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, ApiKey, Note, ScimUser, ScimUserValue, ScimGroup, ScimGroupMember],
        repositories: defaultTestServerRepositories,
        allowOrphan: true
    });
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy, ClientAccessTokenAuthStrategy],
        controllers,
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders(declared, roles),
            ...providers
        ]
    });
}

/**
 * Expects an application to be refused when it starts.
 * @param start - The start.
 * @param refusal - What the refusal says.
 */
async function expectStartRefused(start: Promise<StartedTestServer>, refusal: RegExp): Promise<void> {
    // one that starts after all is shut down again, so the cases after it start on their own
    await expect(start.then(async started => await started.shutdown())).rejects.toThrow(refusal);
}

/**
 * The notes of the running application.
 * @returns Their repository.
 */
function notes(): Repository<Note> {
    return inject(repositoryTokenFor(Note));
}

/**
 * A user who is a member of a tenant, and an api key acting as them there.
 */
type Member = {
    user: JwtUser,
    key: string
};

/**
 * Creates a user who is a member of a new tenant, and a key bound to it.
 * @param name - What sets the user's email apart.
 * @param memberRoles - The roles they hold in the tenant.
 * @param keyPermissions - The permissions their key may use, all their roles carry there unless given.
 * @returns The user and the key.
 */
async function createMember(name: string, memberRoles: MemberRoles[], keyPermissions?: (Permission | PlatformPermission)[]): Promise<Member> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${name}@permission-sites.test`, roles: [Roles.USER] });
    const tenantId: string = UUIDUtilities.generate();
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        .runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: memberRoles }));
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const permissions: (Permission | PlatformPermission)[] = keyPermissions ?? await authService.resolveUserPermissions(user, tenantId);
    const created: CreatedApiKey = await authService.createApiKey(
        user.id,
        { name, permissions, expiresAt: undefined, tenantId, clientAuthentication: undefined, requireDpop: false },
        undefined
    );
    return { user, key: created.key };
}

/**
 * Calls a route with an api key.
 * @param path - The route.
 * @param key - The key to send.
 * @returns The body of the answer.
 */
async function call<T>(path: string, key: string): Promise<T> {
    const res: Response = await fetch(`${baseUrl}${path}`, { headers: { 'x-api-key': key } });
    expect(res.status).toBe(200);
    return await res.json() as T;
}

describe('evaluation/03-auth-and-security A6 - what names a permission outside a route is checked when the application starts', () => {
    it('refuses a SCIM controller naming a permission that is not declared', async () => {
        await expectStartRefused(
            startApp([MisspelledScimController]),
            /MisspelledScimController[\S\s]*scim\.provisions[\S\s]*not declared/
        );
    });

    it('refuses an authorization server whose introspection names a permission that is not declared', async () => {
        await expectStartRefused(
            startApp([MisspelledAuthorizationServerController]),
            /introspectionPermission[\S\s]*tokens\.introspects[\S\s]*not declared/
        );
    });

    it('refuses the OpenAPI routes naming a permission that is not declared', async () => {
        const openApiAuth: DiProvider<unknown> = defineProvider({
            token: ZIBRI_DI_TOKENS.OPEN_API_AUTH,
            // @ts-expect-error - a plain string is no permission
            useValue: { hasPlatformPermission: { permission: 'docs.reads' } }
        });
        await expectStartRefused(startApp([], [openApiAuth]), /'docs\.reads'[\S\s]*not declared/);
    });
});

describe('evaluation/03-auth-and-security A6 - a scope and the application\'s own code ask what a route asks', () => {
    let admin: Member;
    let member: Member;
    let narrowedAdmin: Member;

    beforeAll(async () => {
        server = await startApp([NoteController, CodeChecksController]);
        baseUrl = await server.start();

        admin = await createMember('admin', [MemberRoles.ADMIN]);
        member = await createMember('member', [MemberRoles.USER]);
        // an admin whose key may use none of what their roles carry
        narrowedAdmin = await createMember('narrowed-admin', [MemberRoles.USER, MemberRoles.ADMIN], []);

        await notes().createAll([
            { authorId: admin.user.id, text: 'by the admin' },
            { authorId: member.user.id, text: 'by the member' },
            { authorId: narrowedAdmin.user.id, text: 'by the narrowed admin' }
        // outside a request, where the scope sees nothing
        ], { unscoped: true });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('lets a scope ask for a permission of the caller\'s role in the tenant', async () => {
        expect(await call<string[]>('/notes', admin.key)).toEqual(['by the admin', 'by the member', 'by the narrowed admin']);
        expect(await call<string[]>('/notes', member.key)).toEqual(['by the member']);
    });

    it('answers a scope with the permissions the credential may use, as a route is answered', async () => {
        expect(await call<string[]>('/notes', narrowedAdmin.key)).toEqual(['by the narrowed admin']);
    });

    it('answers a scope no outside a request', async () => {
        expect(await notes().findAll()).toEqual([]);
    });

    it('answers code naming a permission that is not declared with no, and warns once', async () => {
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER), 'warn');
        try {
            const first: CodeChecks = await call<CodeChecks>('/code-checks', admin.key);
            const second: CodeChecks = await call<CodeChecks>('/code-checks', admin.key);

            expect([first, second]).toEqual([
                { undeclaredPermission: false, undeclaredPlatformPermission: false },
                { undeclaredPermission: false, undeclaredPlatformPermission: false }
            ]);
            const warnings: string[] = warn.mock.calls.map(([message]) => message);
            expect(warnings.filter(message => /notes\.delete[\S\s]*not declared/.test(message))).toHaveLength(1);
            expect(warnings.filter(message => /tokens\.revoke[\S\s]*not declared/.test(message))).toHaveLength(1);
        }
        finally {
            warn.mockRestore();
        }
    });
});