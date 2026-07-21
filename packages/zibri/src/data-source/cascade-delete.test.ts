import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';

import { Repository } from './repository';
import { Child } from '../__testing__/mocks/entities/child.entity';
import { Company } from '../__testing__/mocks/entities/company.entity';
import { Parent } from '../__testing__/mocks/entities/parent.entity';
import { Profile } from '../__testing__/mocks/entities/profile.entity';
import { Role } from '../__testing__/mocks/entities/role.entity';
import { User, UserCreateData, mockCreateUserData } from '../__testing__/mocks/entities/user.entity';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';

describe('cascade delete', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Parent, Child, User, Company, Profile, Role] })]
        });
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('deletes children when parent removed', async () => {
        const parentRepo: Repository<Parent> = inject(repositoryTokenFor(Parent));
        const childRepo: Repository<Child> = inject(repositoryTokenFor(Child));
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
        const userRepo: Repository<User, UserCreateData> = inject(repositoryTokenFor(User));
        const profileRepo: Repository<Profile> = inject(repositoryTokenFor(Profile));

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
        const userRepo: Repository<User, UserCreateData> = inject(repositoryTokenFor(User));
        const roleRepo: Repository<Role> = inject(repositoryTokenFor(Role));

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