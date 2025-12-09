import { DataSourceInterface, HashUtilities, inject, JwtCredentials, JwtCredentialsCreateData, Newable, Repository, repositoryTokenFor, Transaction } from 'zibri';

import { logger } from '.';
import { Roles, User } from './models';
import { UserRepository } from './repositories';

export async function createDefaultData(dataSourceClass: Newable<DataSourceInterface>): Promise<void> {
    const dataSource: DataSourceInterface = inject(dataSourceClass);
    await logger.info('Creates default data if missing');

    await createDefaultAdmin(dataSource);
    await logger.info('Finished creating default data');
}

async function createDefaultAdmin(dataSource: DataSourceInterface): Promise<void> {
    const userRepository: UserRepository = inject(UserRepository);
    const credentialsRepository: Repository<JwtCredentials, JwtCredentialsCreateData> = inject(repositoryTokenFor(JwtCredentials));

    const defaultUser: User | undefined = await userRepository.findOne({ where: { email: 'admin@test.com' } }, false);
    if (defaultUser) {
        return;
    }

    await logger.info('  - default admin');
    const transaction: Transaction = await dataSource.startTransaction();
    try {
        const user: User = await userRepository.create({ email: 'admin@test.com', roles: [Roles.ADMIN] }, { transaction });
        await credentialsRepository.create(
            { email: user.email, password: await HashUtilities.hash('password'), userId: user.id },
            { transaction }
        );
        await transaction.commit();
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
}