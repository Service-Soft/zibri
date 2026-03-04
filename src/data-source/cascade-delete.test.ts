import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { Repository } from './repository';
import { BaseEntity } from '../entity/base-entity.model';
import { PostgresDataSource, PostgresOptions } from './data-sources/postgres-data-source.model';
import { DataSource } from './decorators/data-source.decorator';
import { MigrationEntity } from './migration/migration-entity.model';
import { POSTGRES_TEST_IMAGE } from '../__testing__/constants';
import { Child } from '../__testing__/mocks/entities/child.entity';
import { Company } from '../__testing__/mocks/entities/company.entity';
import { Parent } from '../__testing__/mocks/entities/parent.entity';
import { Profile } from '../__testing__/mocks/entities/profile.entity';
import { Role } from '../__testing__/mocks/entities/role.entity';
import { User, UserCreateData, mockCreateUserData } from '../__testing__/mocks/entities/user.entity';
import { inject } from '../di/inject.function';
import { Newable } from '../types/newable.type';

@DataSource()
class TestDataSource extends PostgresDataSource {
    options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [MigrationEntity, Parent, Child, User, Company, Profile, Role];
}

describe('cascade delete', () => {
    let container: StartedPostgreSqlContainer;
    let ds: TestDataSource;

    beforeAll(async () => {
        container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
            .withDatabase('db')
            .withUsername('postgres')
            .withPassword('password')
            .start();
        ds = inject(TestDataSource);
        ds.options = {
            ...ds.options,
            port: container.getMappedPort(5432)
        };
        await ds.init();
    }, 20000);

    afterAll(async () => {
        await container.stop();
    });

    it('deletes children when parent removed', async () => {
        const parentRepo: Repository<Parent> = ds.getRepository(Parent);
        const childRepo: Repository<Child> = ds.getRepository(Child);
        const parent: Parent = await parentRepo.create({ name: 'p1' });
        await childRepo.create({ name: 'c1', parent: { id: parent.id } });
        await childRepo.create({ name: 'c2', parent });

        // Ensure persisted
        const foundParent: Parent = await parentRepo.findById(parent.id, { relations: ['children'] });
        expect(foundParent).not.toBeUndefined();
        expect(foundParent.children.length).toBe(2);

        // Delete parent
        await parentRepo.deleteById(parent.id);
        const childrenAfter: Child[] = await childRepo.findAll();
        expect(childrenAfter.length).toBe(0);
    });

    it('deletes profile when user removed', async () => {
        const userRepo: Repository<User, UserCreateData> = ds.getRepository(User);
        const profileRepo: Repository<Profile> = ds.getRepository(Profile);

        const user: User = await userRepo.create(mockCreateUserData());
        const profile: Profile = await profileRepo.create({ bio: 'Bio', user });

        // Ensure persisted
        const foundUser: User = await userRepo.findById(user.id, { relations: ['profile'] });
        expect(foundUser).not.toBeUndefined();
        expect(foundUser.profile).not.toBeUndefined();

        // Delete user
        await userRepo.deleteById(user.id);
        const profileAfter: Profile | undefined = await profileRepo.findOne({ where: { id: profile.id } }, false);
        expect(profileAfter).toBeUndefined();
    });

    it('removes user from roles when user removed', async () => {
        const userRepo: Repository<User, UserCreateData> = ds.getRepository(User);
        const roleRepo: Repository<Role> = ds.getRepository(Role);

        const user1: User = await userRepo.create(mockCreateUserData());
        const user2: User = await userRepo.create(mockCreateUserData());

        const role: Role = await roleRepo.create({ name: 'admin', users: [user1, user2] });

        // Ensure persisted
        const foundRole: Role = await roleRepo.findById(role.id, { relations: ['users'] });
        expect(foundRole).not.toBeUndefined();
        expect(foundRole.users.length).toBe(2);

        // Delete user
        await userRepo.deleteById(user1.id);
        const updatedRole: Role = await roleRepo.findById(role.id, { relations: ['users'] });
        expect(updatedRole.users.length).toBe(1);
    });
});