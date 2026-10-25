import { DataSourceInterface, inject, Newable, PasswordCredentials, PasswordCredentialsCreateData, Repository, repositoryTokenFor, RoleCreateData, TenantServiceInterface, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

import { logger } from '.';
import { requireEnv } from './env';
import { Permissions, PlatformPermissions, PlatformRoles, Role, Roles, Tenant, User } from './models';
import { MembershipRepository, RoleRepository, UserRepository } from './repositories';

// the roles the application starts with. Administrators create more, and change these, at runtime
const defaultRoles: RoleCreateData<Role>[] = [
    { name: PlatformRoles.USER, level: 'platform', permissions: [], description: 'Everybody with an account' },
    {
        name: PlatformRoles.ADMIN,
        level: 'platform',
        permissions: Object.values(PlatformPermissions),
        description: 'Administers the application'
    },
    { name: Roles.USER, level: 'tenant', permissions: [], description: 'Everybody in a tenant' },
    { name: Roles.ADMIN, level: 'tenant', permissions: Object.values(Permissions), description: 'Administers a tenant' }
];

export async function createDefaultData(dataSourceClass: Newable<DataSourceInterface>): Promise<void> {
    const dataSource: DataSourceInterface = inject(dataSourceClass);
    logger.info('Creates default data if missing');

    // one transaction, so that a start failing halfway leaves nothing behind for the next one to trip over
    const transaction: Transaction = await dataSource.startTransaction();
    try {
        await createDefaultRoles(transaction);
        await createDefaultAdmin(transaction);
        await transaction.commit();
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
    logger.info('Finished creating default data');
}

async function createDefaultRoles(transaction: Transaction): Promise<void> {
    const roleRepository: RoleRepository = inject(RoleRepository);
    const existing: Set<string> = new Set((await roleRepository.findAll({ take: 'all', transaction })).map(role => role.name));
    const missing: RoleCreateData<Role>[] = defaultRoles.filter(role => !existing.has(role.name));
    if (!missing.length) {
        return;
    }
    logger.info('  - default roles');
    await roleRepository.createAll(missing, { transaction });
}

async function createDefaultAdmin(transaction: Transaction): Promise<void> {
    const userRepository: UserRepository = inject(UserRepository);
    const credentialsRepository: Repository<PasswordCredentials, PasswordCredentialsCreateData>
        = inject(repositoryTokenFor(PasswordCredentials));

    const email: string = requireEnv('DEFAULT_ADMIN_EMAIL');

    const defaultUser: User | undefined = await userRepository.findOne({ where: { email }, required: false, transaction });
    if (defaultUser) {
        return;
    }

    logger.info('  - default admin');
    const user: User = await userRepository.create({ name: 'root', email, roles: [PlatformRoles.ADMIN] }, { transaction });
    await credentialsRepository.create(
        { password: requireEnv('DEFAULT_ADMIN_PASSWORD'), userId: user.id },
        { transaction }
    );
    await createDefaultTenant(user, transaction);
}

// the tenant the default admin administers, so that a request naming its id in the x-tenant-id
// header reaches what the default admin may do there
async function createDefaultTenant(admin: User, transaction: Transaction): Promise<void> {
    const tenantRepository: Repository<Tenant> = inject(repositoryTokenFor(Tenant));
    const tenant: Tenant = await tenantRepository.create({ name: 'Default' }, { transaction });
    const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    await tenantService.runAs(tenant.id, async () => {
        await inject(MembershipRepository).create({ userId: admin.id, roles: [Roles.ADMIN] }, { transaction });
    });
    logger.info(`  - default tenant ${tenant.id}, administered by the default admin`);
}