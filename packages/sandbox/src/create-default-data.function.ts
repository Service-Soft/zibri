import { DataSourceInterface, inject, Newable, PasswordCredentials, PasswordCredentialsCreateData, Repository, repositoryTokenFor, TenantServiceInterface, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

import { logger } from '.';
import { requireEnv } from './env';
import { Company, Roles, User } from './models';
import { MembershipRepository, UserRepository } from './repositories';

export async function createDefaultData(dataSourceClass: Newable<DataSourceInterface>): Promise<void> {
    const dataSource: DataSourceInterface = inject(dataSourceClass);
    logger.info('Creates default data if missing');

    await createDefaultAdmin(dataSource);
    await createDefaultCompany();
    logger.info('Finished creating default data');
}

async function createDefaultAdmin(dataSource: DataSourceInterface): Promise<void> {
    const userRepository: UserRepository = inject(UserRepository);
    const credentialsRepository: Repository<PasswordCredentials, PasswordCredentialsCreateData>
        = inject(repositoryTokenFor(PasswordCredentials));

    const email: string = requireEnv('DEFAULT_ADMIN_EMAIL');

    const defaultUser: User | undefined = await userRepository.findOne({ where: { email }, required: false });
    if (defaultUser) {
        return;
    }

    logger.info('  - default admin');
    const transaction: Transaction = await dataSource.startTransaction();
    try {
        const user: User = await userRepository.create({ name: 'root', email, roles: [Roles.ADMIN] }, { transaction });
        await credentialsRepository.create(
            { password: requireEnv('DEFAULT_ADMIN_PASSWORD'), userId: user.id },
            { transaction }
        );
        await transaction.commit();
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// a company is a tenant here, and the default admin administers the default one - so a request
// naming its id in the x-tenant-id header reaches what the default admin may do
async function createDefaultCompany(): Promise<void> {
    const companyRepository: Repository<Company> = inject(repositoryTokenFor(Company));
    const name: string = 'Default';
    const company: Company = await companyRepository.findOne({ where: { name }, required: false })
        ?? await companyRepository.create({ name });

    const admin: User = await inject(UserRepository).findOne({ where: { email: requireEnv('DEFAULT_ADMIN_EMAIL') } });
    const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    await tenantService.runAs(company.id, async () => {
        const membershipRepository: MembershipRepository = inject(MembershipRepository);
        if (await membershipRepository.findMembership(admin.id)) {
            return;
        }
        logger.info(`  - default company, with the default admin as its admin, at tenant ${company.id}`);
        await membershipRepository.create({ tenantId: company.id, userId: admin.id, roles: [Roles.ADMIN] });
    });
}