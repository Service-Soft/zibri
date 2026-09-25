import { DataSourceInterface, inject, JwtCredentials, JwtCredentialsCreateData, Newable, Repository, repositoryTokenFor, Transaction } from 'zibri';

import { logger } from '.';
import { requireEnv } from './env';
import { Roles, User } from './models';
import { UserRepository } from './repositories';

export async function createDefaultData(dataSourceClass: Newable<DataSourceInterface>): Promise<void> {
    const dataSource: DataSourceInterface = inject(dataSourceClass);
    logger.info('Creates default data if missing');

    await createDefaultAdmin(dataSource);
    logger.info('Finished creating default data');
}

async function createDefaultAdmin(dataSource: DataSourceInterface): Promise<void> {
    const userRepository: UserRepository = inject(UserRepository);
    const credentialsRepository: Repository<JwtCredentials, JwtCredentialsCreateData> = inject(repositoryTokenFor(JwtCredentials));

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
            { email: user.email, password: requireEnv('DEFAULT_ADMIN_PASSWORD'), userId: user.id },
            { transaction }
        );
        await transaction.commit();
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
}