import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { Repository } from './repository';
import { RepositoryClass } from './repository-class.type';
import { RepositoryFor } from './repository-for.decorator';
import { USER_REPOSITORY } from './repository-kind.model';
import { TestTimeouts } from '../../__testing__/constants';
import { BaseUserEntity } from '../../auth/models/base-user.model';
import { BaseRoleRepository } from '../../auth/roles/base-role-repository.model';
import { BaseRoleEntity } from '../../auth/roles/base-role.model';
import { BaseUserRepository } from '../../auth/user/base-user-repository.model';
import { UserRepositoryInterface } from '../../auth/user/user-repository.interface';
import { type UserServiceInterface } from '../../auth/user/user-service.interface';
import { InjectRepository, repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { BaseMembershipRepository } from '../../tenancy/membership/base-membership-repository.model';
import { BaseMembershipEntity } from '../../tenancy/membership/base-membership.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { type Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { SoftDeleteEntity } from '../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../change-sets/soft-delete-repository';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { DataSource } from '../decorators/data-source.decorator';
import { Transaction } from '../transaction/transaction.model';

// a file of its own, because a class declared with @RepositoryFor is checked by every application
// the file starts once it is imported

@Entity({ tenant: 'shared', allowOrphan: true })
class TeamUser extends BaseUserEntity<string>() {}

@Entity({ uniques: [['userId']], allowOrphan: true })
class TeamMembership extends BaseMembershipEntity<string>() {}

@Entity({ allowOrphan: true })
class TeamRole extends BaseRoleEntity {}

@Entity({ tenant: 'shared', allowOrphan: true })
class Project extends BaseEntity {
    @Property.string()
    name!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Archive extends SoftDeleteEntity {
    @Property.string()
    name!: string;
}

/**
 * A user that soft deletes, declared through the base, which asks whether a soft deleted user keeps
 * the address.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class ArchivedUser extends BaseUserEntity(SoftDeleteEntity, { deletedUserKeepsEmail: false }) {}

@RepositoryFor(TeamUser)
class TeamUserRepository extends BaseUserRepository<TeamUser>() {}

@RepositoryFor(TeamMembership)
class TeamMembershipRepository extends BaseMembershipRepository<TeamMembership>() {}

@RepositoryFor(TeamRole)
class TeamRoleRepository extends BaseRoleRepository<TeamRole>() {}

@RepositoryFor(Project)
class ProjectRepository extends Repository<Project> {
    async findByName(name: string): Promise<Project> {
        return await this.findOne({ where: { name } });
    }
}

@RepositoryFor(Archive)
class ArchiveRepository extends SoftDeleteRepository<Archive> {}

@RepositoryFor(ArchivedUser)
class ArchivedUserRepository extends BaseUserRepository<ArchivedUser>(SoftDeleteRepository) {}

/**
 * A service reaching projects the way any class of an application does.
 */
@Injectable()
class ProjectService {
    constructor(
        @InjectRepository(Project)
        readonly projects: Repository<Project>
    ) {}
}

describe('@RepositoryFor', () => {
    let server: StartedTestServer | undefined;
    let dataSourceClass: Newable<DataSourceInterface>;
    let users: TeamUserRepository;
    let memberships: TeamMembershipRepository;
    let roles: TeamRoleRepository;
    let tenantService: TenantServiceInterface;
    const tenantId: string = UUIDUtilities.generate();

    beforeAll(async () => {
        dataSourceClass = createInMemoryDataSource({
            entities: [TeamUser, TeamMembership, TeamRole, Project, Archive, ArchivedUser],
            repositories: [
                TeamUserRepository,
                TeamMembershipRepository,
                TeamRoleRepository,
                ProjectRepository,
                ArchiveRepository,
                ArchivedUserRepository
            ]
        });
        server = await startTestServer({ dataSources: [dataSourceClass] });
        users = inject(TeamUserRepository);
        memberships = inject(TeamMembershipRepository);
        roles = inject(TeamRoleRepository);
        tenantService = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        await roles.createAll([
            { name: 'reader', level: 'platform', permissions: [] },
            { name: 'editor', level: 'tenant', permissions: [] }
        ]);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('hands out the one instance of the class under every token of its entity', () => {
        const projects: ProjectRepository = inject(ProjectRepository);

        expect(projects).toBeInstanceOf(ProjectRepository);
        expect(inject(repositoryTokenFor(Project))).toBe(projects);
        expect(inject(repositoryTokenFor(Project, dataSourceClass))).toBe(projects);
        expect(inject(ProjectService).projects).toBe(projects);
    });

    it('reads and writes the entity through the methods of the class', async () => {
        await inject(repositoryTokenFor(Project)).create({ name: 'Website' });

        expect((await inject(ProjectRepository).findByName('Website')).name).toBe('Website');
    });

    it('builds the class over the soft deleting repository of a soft deleting entity', async () => {
        const archives: ArchiveRepository = inject(ArchiveRepository);
        const archive: Archive = await archives.create({ name: '2025' });

        await archives.deleteById(archive.id);

        expect(await archives.findAll()).toEqual([]);
        expect((await archives.findAll({ deleted: 'only' })).map(a => a.name)).toEqual(['2025']);
    });

    it('finds a user through the user repository', async () => {
        const user: TeamUser = await users.create({ email: 'ada@example.com', roles: ['reader'] });
        const userService: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);

        expect((await userService.findByEmail('ada@example.com')).id).toBe(user.id);
    });

    it('finds a user through a user repository built over a soft deleting repository', async () => {
        const archivedUsers: ArchivedUserRepository = inject(ArchivedUserRepository);
        const user: ArchivedUser = await archivedUsers.create({ email: 'grace@example.com', roles: [] });
        const userService: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);

        expect(archivedUsers).toBeInstanceOf(SoftDeleteRepository);
        expect((await userService.findByEmail('grace@example.com')).id).toBe(user.id);
    });

    it('lets someone register again with the address of a user it soft deleted', async () => {
        const archivedUsers: ArchivedUserRepository = inject(ArchivedUserRepository);
        const first: ArchivedUser = await archivedUsers.create({ email: 'ada@example.com', roles: [] });
        await archivedUsers.deleteById(first.id);

        const second: ArchivedUser = await archivedUsers.create({ email: 'ada@example.com', roles: [] });

        expect(second.id).not.toBe(first.id);
        expect((await archivedUsers.findAll({ where: { email: 'ada@example.com' }, deleted: 'only' })).map(user => user.id))
            .toEqual([first.id]);
    });

    it('deletes the memberships of a user it deletes', async () => {
        const user: TeamUser = await users.create({ email: 'leaving@example.com', roles: [] });
        await tenantService.runAs(tenantId, async () => await memberships.create({ userId: user.id, roles: ['editor'] }));

        await users.deleteById(user.id);

        expect(await memberships.findMemberships(user.id)).toEqual([]);
    });

    it('refuses a user holding a role that does not exist', async () => {
        await expect(users.create({ email: 'ghost@example.com', roles: ['ghost'] })).rejects.toThrow(/'ghost' does not exist/);
    });

    it('refuses a membership holding a role that does not exist', async () => {
        const user: TeamUser = await users.create({ email: 'ghost-member@example.com', roles: [] });

        await expect(tenantService.runAs(tenantId, async () => await memberships.create({ userId: user.id, roles: ['ghost'] })))
            .rejects.toThrow(/'ghost' does not exist/);
    });

    it('refuses deleting a role a user holds', async () => {
        const role: TeamRole = await roles.create({ name: 'user-held', level: 'platform', permissions: [] });
        await users.create({ email: 'holder@example.com', roles: ['user-held'] });

        await expect(roles.deleteById(role.id)).rejects.toThrow(/'user-held'[\S\s]*still held/);
    });

    it('refuses deleting a role a membership holds', async () => {
        const role: TeamRole = await roles.create({ name: 'member-held', level: 'tenant', permissions: [] });
        const user: TeamUser = await users.create({ email: 'member@example.com', roles: [] });
        await tenantService.runAs(tenantId, async () => await memberships.create({ userId: user.id, roles: ['member-held'] }));

        await expect(roles.deleteById(role.id)).rejects.toThrow(/'member-held'[\S\s]*still held/);
    });
});

// each case below declares what only its own application stores, so that its classes refuse that
// application alone

@Entity({ tenant: 'shared', allowOrphan: true })
class Ledger extends BaseEntity {
    @Property.string()
    account!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Invoice extends BaseEntity {}

@Entity({ tenant: 'shared', allowOrphan: true })
class Shelf extends BaseEntity {}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
class Book extends BaseEntity {}

@Entity({ tenant: 'shared', allowOrphan: true })
class Label extends BaseEntity {}

@Entity({ tenant: 'shared', allowOrphan: true })
class Plain extends BaseEntity {}

@Entity({ tenant: 'shared', allowOrphan: true })
class Draft extends SoftDeleteEntity {}

@Entity({ tenant: 'shared', allowOrphan: true })
class Memo extends BaseEntity {}

/**
 * Declares the columns of a user by hand, rather than extending BaseUserEntity().
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class HandmadeUser extends BaseEntity {
    @Property.string({ format: 'email', unique: true })
    email!: string;

    @Property.array({ items: { type: 'string' } })
    roles!: string[];

    @Property.date({ required: false })
    deactivatedAt?: Date | null;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class LonelyUser extends BaseUserEntity<string>() {}

@Entity({ tenant: 'shared', allowOrphan: true })
class FieldMarkedUser extends BaseUserEntity<string>() {}

/**
 * Is listed, but was never declared the repository of anything.
 */
class UndeclaredLedgerRepository extends Repository<Ledger> {}

@RepositoryFor(Invoice)
class InvoiceRepository extends Repository<Invoice> {}

@RepositoryFor(Shelf)
class ShelfRepository extends Repository<Shelf> {}

@RepositoryFor(Shelf)
class OtherShelfRepository extends Repository<Shelf> {}

@RepositoryFor(Book)
class BookRepository extends Repository<Book> {}

@RepositoryFor(Label)
class LabelRepository extends Repository<Label> {
    // a parameter after the two the framework passes, which the decorator cannot tell from them
    constructor(entityClass: Newable<Label>, repo: Repository<Label>, readonly prefix: string = 'label') {
        super(entityClass, repo);
    }
}

// @ts-expect-error - the class is no repository
@RepositoryFor(Plain)
class PlainRepository {}

// @ts-expect-error - a soft deleting entity is read through SoftDeleteRepository
@RepositoryFor(Draft)
class DraftRepository extends Repository<Draft> {}

@RepositoryFor(Memo)
class MemoRepository extends Repository<Memo> {}

@RepositoryFor(HandmadeUser)
class HandmadeUserRepository extends BaseUserRepository<HandmadeUser>() {}

@RepositoryFor(FieldMarkedUser)
class FieldMarkedUserRepository extends Repository<FieldMarkedUser> implements UserRepositoryInterface<string, FieldMarkedUser> {
    // eslint-disable-next-line typescript/typedef
    readonly [USER_REPOSITORY] = true as const;

    async findByEmail(email: string): Promise<FieldMarkedUser> {
        return await this.findOne({ where: { email } });
    }

    async updateDeactivatedAt(id: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {
        await this.updateById(id, { deactivatedAt }, { transaction });
    }

    async updateRoles(id: string, roles: string[], transaction: Transaction | undefined): Promise<void> {
        await this.updateById(id, { roles }, { transaction });
    }

    async updateEmail(id: string, email: string, emailVerifiedAt: Date | null, transaction: Transaction | undefined): Promise<void> {
        await this.updateById(id, { email, emailVerifiedAt }, { transaction });
    }
}

// @ts-expect-error - the class is the repository of another entity
@RepositoryFor(Memo)
class MisdeclaredRepository extends Repository<Ledger> {}

/**
 * A second data source of books, holding them alone, beside one of the framework's entities.
 */
@DataSource({ allowOrphan: true })
class SecondBookDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [Book];
    override readonly repositories: RepositoryClass[] = [BookRepository];
}

describe('@RepositoryFor - starting', () => {
    /**
     * Starts an application on one in memory data source, and shuts it down again.
     * @param entities - The entities of the data source.
     * @param repositories - The repositories it lists.
     */
    async function start(entities: Newable<BaseEntity>[], repositories: RepositoryClass[]): Promise<void> {
        const server: StartedTestServer = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities, repositories, allowOrphan: true })]
        });
        await server.shutdown();
    }

    it('refuses a listed class that is not declared with @RepositoryFor', async () => {
        await expect(start([Ledger], [UndeclaredLedgerRepository])).rejects.toThrow(/UndeclaredLedgerRepository is listed[\S\s]*not declared with @RepositoryFor/);
    }, TestTimeouts.inMemory.start);

    it('refuses a class of an entity the data source does not declare', async () => {
        await expect(start([Ledger], [InvoiceRepository])).rejects.toThrow(/InvoiceRepository is the repository of Invoice, which [\S\s]* does not declare/);
    }, TestTimeouts.inMemory.start);

    it('refuses two classes of one entity', async () => {
        await expect(start([Shelf], [ShelfRepository, OtherShelfRepository])).rejects.toThrow(/several repositories of Shelf/);
    }, TestTimeouts.inMemory.start);

    it('refuses one class listed by two data sources', async () => {
        const start: Promise<StartedTestServer> = startTestServer({
            dataSources: [
                createInMemoryDataSource({ entities: [Book], repositories: [BookRepository], allowOrphan: true }),
                SecondBookDataSource
            ]
        });

        await expect(start).rejects.toThrow(/BookRepository is listed in the repositories of [\S\s]* and SecondBookDataSource/);
    }, TestTimeouts.inMemory.start);

    it('refuses a class declaring a constructor of its own', async () => {
        await expect(start([Label], [LabelRepository])).rejects.toThrow(/LabelRepository declares a constructor of its own/);
    }, TestTimeouts.inMemory.start);

    it('refuses a class that is no repository', async () => {
        await expect(start([Plain], [PlainRepository])).rejects.toThrow(/PlainRepository [\S\s]*does not extend Repository/);
    }, TestTimeouts.inMemory.start);

    it('refuses a class extending another base than the repository of its entity', async () => {
        await expect(start([Draft], [DraftRepository])).rejects.toThrow(/built on a SoftDeleteRepository, so it has to extend SoftDeleteRepository/);
    }, TestTimeouts.inMemory.start);

    it('refuses a class of an entity the application stores that no data source lists', async () => {
        await expect(start([Memo], [])).rejects.toThrow(/MemoRepository is declared with @RepositoryFor\(Memo\), but no data source lists it/);
        // declared to be loaded, and never listed - the second one for the type check above
        expect([MemoRepository.name, MisdeclaredRepository.name]).toEqual(['MemoRepository', 'MisdeclaredRepository']);
    }, TestTimeouts.inMemory.start);

    it('refuses a user repository of an entity that is no user entity', async () => {
        await expect(start([HandmadeUser], [HandmadeUserRepository])).rejects.toThrow(/HandmadeUserRepository is a user repository, but HandmadeUser is no user entity/);
    }, TestTimeouts.inMemory.start);

    it('refuses a user entity without a user repository', async () => {
        await expect(start([LonelyUser], [])).rejects.toThrow(/LonelyUser is a user entity, but [\S\s]* lists no user repository for it/);
    }, TestTimeouts.inMemory.start);

    it('refuses a user repository carrying its mark on its instances only', async () => {
        await expect(start([FieldMarkedUser], [FieldMarkedUserRepository]))
            .rejects.toThrow(/FieldMarkedUser is a user entity, but [\S\s]* lists no user repository[\S\s]*declares its mark as a getter/);
    }, TestTimeouts.inMemory.start);
});