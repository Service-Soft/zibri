import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource, resetInMemoryStore } from 'zibri-testing';

import { ZibriApplication } from '../application/application';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { FindAllPaginatedOptions } from '../data-source/models/options/find-all-paginated-options.model';
import { Repository } from '../data-source/repository/repository';
import { Transaction } from '../data-source/transaction/transaction.model';
import { UniqueConstraintViolationError } from '../data-source/unique-constraint-violation.error';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { InternalError } from '../error-handling/internal-error.model';
import { EventSubscriberRegistration } from '../event/event-subscriber-registration.model';
import { KeysetPage, PaginationResult } from '../open-api/pagination-result.model';
import { Newable } from '../types/newable.type';
import { Company } from './mocks/entities/company.entity';
import { Profile } from './mocks/entities/profile.entity';
import { Role } from './mocks/entities/role.entity';
import { mockCreateUserData, User, UserCreateData } from './mocks/entities/user.entity';
import { defaultTestServerEntities } from './test-server/create-test-data-source.function';
import { defaultTestServerPlugins } from './test-server/plugins';
import { defaultTestServerProviders } from './test-server/providers';
// eslint-disable-next-line eslintImport/no-unassigned-import
import './test-server/user-repository'; // this import is needed so that the DI system can pick up the user repository.

/**
 * The stub that keeps ZibriApplication.shutdown()'s unconditional process.exit from ending the run.
 */
type ProcessExitSpy = jest.Spied<typeof process.exit>;

/**
 * Stubs ZibriApplication.shutdown()'s unconditional process.exit, so it cannot end the test run.
 * @returns The spy, to be restored on teardown.
 */
function stubProcessExit(): ProcessExitSpy {
    return jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
}

/**
 * An application running on an in memory data source, and what a test needs to reach into it.
 */
type StartedInMemoryApp = {
    /**
     * The running application.
     */
    app: ZibriApplication,
    /**
     * The data source it booted with.
     */
    dataSource: InMemoryDataSource,
    /**
     * The stubbed process.exit, restored on teardown.
     */
    exitSpy: ProcessExitSpy
};

/**
 * Everything the framework registers, plus the mock entities these tests use for relations.
 */
const testEntities: Newable<BaseEntity>[] = [...defaultTestServerEntities, User, Company, Profile, Role];

/**
 * The data source every test in this file boots on.
 *
 * Declared once for the whole file rather than one per test: a class declared per test would leave
 * every earlier one registered and belonging to no application, which is what `@DataSource` rejects
 * as orphaned. Which also makes this the case that has to reset the store as it boots - see
 * {@link startInMemoryTestApp}.
 */
@DataSource()
class TestInMemoryDataSource extends InMemoryDataSource {
    entities: Newable<BaseEntity>[] = testEntities;
}

/**
 * Builds and initializes an application on {@link TestInMemoryDataSource}.
 *
 * Built here rather than through `startTestServer`, which starts a container per data source. That
 * is the wiring this data source still needs, and it is deliberately not touched yet.
 * @returns The running application.
 */
async function bootApp(): Promise<StartedInMemoryApp> {
    // nothing may be injected above this line: the previous application's shutdown discarded its
    // container, so this fills a fresh one rather than adding to a used one
    initDiContainer();

    const exitSpy: ProcessExitSpy = stubProcessExit();

    const app: ZibriApplication = new ZibriApplication({
        name: 'test',
        version: '1.0.0',
        baseUrl: 'http://localhost:3000',
        controllers: [],
        websocketControllers: [],
        dataSources: [TestInMemoryDataSource],
        providers: defaultTestServerProviders,
        plugins: defaultTestServerPlugins,
        cronJobs: [],
        authStrategies: [],
        twoFactorMethods: [],
        defaultAuth: 'public'
    });

    try {
        await app.init();
    }
    catch (error) {
        await app.shutdown();
        exitSpy.mockRestore();
        throw error;
    }

    return { app, dataSource: inject(TestInMemoryDataSource), exitSpy };
}

/**
 * Starts a new server, the way a test harness does.
 *
 * The store is reset first, which is the moment a container-backed harness starts a new container.
 * Needed here because every test in this file boots the same data source class, so without it the
 * second test would open a database still holding the first one's rows.
 * @returns The running application, on an empty store.
 */
async function startInMemoryTestApp(): Promise<StartedInMemoryApp> {
    resetInMemoryStore(TestInMemoryDataSource);
    return await bootApp();
}

/**
 * Re-initializes a running server, the way `StartedTestServer.reInit` does.
 *
 * The same steps in the same order - shut the application down, take a fresh di container, build
 * another application on the same data source classes - and pointedly no store reset, because a
 * re-init is not a new deployment.
 * @param running - The application to replace.
 * @returns The re-initialized application.
 */
async function reInitInMemoryTestApp(running: StartedInMemoryApp): Promise<StartedInMemoryApp> {
    await running.app.shutdown();
    running.exitSpy.mockRestore();
    return await bootApp();
}

describe('InMemoryDataSource', () => {
    let started: StartedInMemoryApp;

    beforeEach(async () => {
        started = await startInMemoryTestApp();
    });

    afterEach(async () => {
        await started.app.shutdown();
        started.exitSpy.mockRestore();
    });

    it('round trips every property as the type it declares', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        const data: UserCreateData = mockCreateUserData({ name: 'Ada', age: 36, active: true, tags: ['admin'] });

        const created: User = await users.create(data);
        const found: User = await users.findById(created.id);

        expect(found.id).toBe(created.id);
        expect(found.name).toBe('Ada');
        // the values come back off a json encoded row, so this is what says the decoding actually
        // restores the declared types instead of handing back strings that merely look right
        expect(found.age).toBe(36);
        expect(found.active).toBe(true);
        expect(found.tags).toEqual(['admin']);
        expect(found.created).toBeInstanceOf(Date);
        expect(found.created.getTime()).toBe(data.created.getTime());
        expect(found.address).toEqual(data.address);
    });

    it('does not let a caller reach back into what is stored', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        const created: User = await users.create(mockCreateUserData({ name: 'Ada' }));

        created.name = 'mutated after the fact';

        expect((await users.findById(created.id)).name).toBe('Ada');
    });

    it('filters, orders and windows results', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        await users.create(mockCreateUserData({ name: 'Ada', age: 36, active: true }));
        await users.create(mockCreateUserData({ name: 'Grace', age: 45, active: true }));
        await users.create(mockCreateUserData({ name: 'Alan', age: 41, active: false }));

        const active: User[] = await users.findAll({ where: { active: true }, order: { age: 'DESC' } });
        expect(active.map(u => u.name)).toEqual(['Grace', 'Ada']);

        const overForty: User[] = await users.findAll({ where: { age: { greaterThan: 40 } }, order: { name: 'ASC' } });
        expect(overForty.map(u => u.name)).toEqual(['Alan', 'Grace']);

        const firstTwo: User[] = await users.findAll({ order: { name: 'ASC' }, take: 2 });
        expect(firstTwo.map(u => u.name)).toEqual(['Ada', 'Alan']);

        const afterTheFirst: User[] = await users.findAll({ order: { name: 'ASC' }, skip: 1, take: 'all' });
        expect(afterTheFirst.map(u => u.name)).toEqual(['Alan', 'Grace']);

        expect(await users.findAll({ where: { name: { iLike: '%ra%' } } })).toHaveLength(1);
    });

    it('pages a table that declares no order, without repeating or skipping a row', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        await users.createAll(Array.from({ length: 9 }, (_, i) => mockCreateUserData({ name: `paged-${i}` })));

        const seen: string[] = [];
        for (let page: number = 1; page <= 3; page++) {
            const res: PaginationResult<User> = await users.findAllPaginated(page, 3);
            expect(res.totalAmount).toBe(9);
            seen.push(...res.items.map(u => u.id));
        }

        // `User` declares no default order and nothing here asks for one, so what makes three pages
        // tile the table is the order the repository puts on a bounded read itself. Ids are the
        // order it uses, and they are uuids - so this is only true of a walk that was ordered,
        // never of one that came back in whatever order the store happened to hold the rows in.
        expect(new Set(seen).size).toBe(9);
        expect(seen).toEqual([...seen].sort());
    });

    it('breaks a tie in a declared order by id', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        await users.createAll(Array.from({ length: 6 }, () => mockCreateUserData({ age: 30 })));

        const options: FindAllPaginatedOptions<User> = { order: { age: 'ASC' } };
        const first: PaginationResult<User> = await users.findAllPaginated(1, 3, options);
        const second: PaginationResult<User> = await users.findAllPaginated(2, 3, options);

        // every row carries the same age, so the declared order says nothing about which three
        // belong on the first page. An order that does not name at most one row per position is
        // not a total one, and pagination needs a total one: without a tiebreaker the store may
        // answer differently each time it is asked, and the two pages then share a row.
        const ids: string[] = [...first.items, ...second.items].map(u => u.id);
        expect(new Set(ids).size).toBe(6);
        expect(ids).toEqual([...ids].sort());
    });

    it('walks a table by cursor, handing back every row exactly once', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        await users.createAll(Array.from({ length: 7 }, (_, i) => mockCreateUserData({ name: `walked-${i}` })));

        const seen: string[] = [];
        let cursor: string | undefined = undefined;
        let reads: number = 0;
        do {
            const page: KeysetPage<User> = await users.findAllAfter(cursor, 3);
            // the total is what the filter matches, not what is left to read - a walk reports "7 of
            // them" throughout rather than counting down
            expect(page.totalAmount).toBe(7);
            seen.push(...page.items.map(u => u.id));
            cursor = page.nextCursor;
            reads++;
        }
        while (cursor != undefined && reads < 10);

        expect(seen).toHaveLength(7);
        expect(new Set(seen).size).toBe(7);
        // three, three, one - and the short page is what ends the walk
        expect(reads).toBe(3);
    });

    it('reaches rows written during a walk when the order puts them ahead of the cursor', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        // a gap at 3 rather than a row there: the order falls back to the id to break a tie, and an
        // id is a random uuid, so two rows of the same age would come back in whichever order their
        // ids happened to draw
        await users.createAll([1, 2, 4, 5].map(age => mockCreateUserData({ age, name: `age-${age}` })));

        const options: FindAllPaginatedOptions<User> = { order: { age: 'ASC' } };
        const first: KeysetPage<User> = await users.findAllAfter(undefined, 2, options);
        expect(first.items.map(u => u.age)).toEqual([1, 2]);

        // inserted after the first page was read, and ordered past where it ended
        await users.create(mockCreateUserData({ age: 3, name: 'arrived-during-the-walk' }));

        const second: KeysetPage<User> = await users.findAllAfter(first.nextCursor, 2, options);
        // the row that arrived is reached, and no row of the first page comes back a second time -
        // which is what an offset cannot do, since the new row shifts every position after it
        expect(second.items.map(u => u.name)).toEqual(['arrived-during-the-walk', 'age-4']);
    });

    it('refuses a cursor from a differently ordered read', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        await users.createAll(Array.from({ length: 4 }, (_, i) => mockCreateUserData({ age: i })));

        const ascending: KeysetPage<User> = await users.findAllAfter(undefined, 2, { order: { age: 'ASC' } });
        expect(ascending.nextCursor).toBeDefined();

        // a position only means something inside the read that produced it: continuing "after age 2"
        // in the other direction walks away from the rows the cursor was meant to carry on through
        await expect(users.findAllAfter(ascending.nextCursor, 2, { order: { age: 'DESC' } }))
            .rejects.toThrow(BadRequestError);
    });

    it('refuses to walk an order it would pass over rows in', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        await users.create(mockCreateUserData({}));

        // `tags` holds an array, which has no order to compare a position against
        await expect(users.findAllAfter(undefined, 2, { order: { tags: 'ASC' } })).rejects.toThrow(InternalError);
    });

    it('resolves to one, has one and many to many relations', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        const companies: Repository<Company> = started.dataSource.getRepository(Company);
        const profiles: Repository<Profile> = started.dataSource.getRepository(Profile);
        const roles: Repository<Role> = started.dataSource.getRepository(Role);

        const user: User = await users.create(mockCreateUserData({ name: 'Ada' }));
        const admin: Role = await roles.create({ name: 'admin' });
        const editor: Role = await roles.create({ name: 'editor' });
        const company: Company = await companies.create({ ownerId: user.id });
        await profiles.create({ bio: 'mathematician', userId: user.id });
        await users.updateById(user.id, { roles: [admin, editor] });

        // belongsToOne, read off the join column of the row itself
        const withOwner: Company = await companies.findById(company.id, { relations: ['owner'] });
        expect(withOwner.owner.name).toBe('Ada');

        // hasOne, found by the foreign key on the other side
        const withProfile: User = await users.findById(user.id, { relations: ['profile'] });
        expect(withProfile.profile?.bio).toBe('mathematician');

        // manyToMany, kept as a set per side
        const withRoles: User = await users.findById(user.id, { relations: ['roles'] });
        expect(withRoles.roles.map(r => r.name).sort()).toEqual(['admin', 'editor']);

        // and the inverse side was written too, rather than only the side that was saved
        const adminWithUsers: Role = await roles.findById(admin.id, { relations: ['users'] });
        expect(adminWithUsers.users.map(u => u.id)).toEqual([user.id]);

        // a find that does not ask for a relation does not resolve it
        expect((await users.findById(user.id)).profile).toBeUndefined();
    });

    it('enforces unique declarations', async () => {
        const registrations: Repository<EventSubscriberRegistration> = started.dataSource
            .getRepository(EventSubscriberRegistration);

        await registrations.create({ subscriberId: 'a', eventType: 'user.created', expiresAt: new Date() });

        // the same subscriber for a different event is a different row, so this has to be allowed
        await registrations.create({ subscriberId: 'a', eventType: 'user.deleted', expiresAt: new Date() });

        await expect(
            registrations.create({ subscriberId: 'a', eventType: 'user.created', expiresAt: new Date() })
        ).rejects.toThrow(UniqueConstraintViolationError);

        expect(await registrations.findAll({ where: { subscriberId: 'a' } })).toHaveLength(2);
    });

    it('inserts on the first upsert and applies onConflict on the next', async () => {
        const registrations: Repository<EventSubscriberRegistration> = started.dataSource
            .getRepository(EventSubscriberRegistration);
        const identity: Partial<EventSubscriberRegistration> = { subscriberId: 'a', eventType: 'user.created' };
        const first: Date = new Date('2026-01-01T00:00:00.000Z');
        const second: Date = new Date('2026-06-01T00:00:00.000Z');

        const inserted: EventSubscriberRegistration = await registrations.upsert(
            identity,
            { ...identity, expiresAt: first } as EventSubscriberRegistration,
            { expiresAt: { set: first } }
        );
        expect(inserted.expiresAt.getTime()).toBe(first.getTime());

        const updated: EventSubscriberRegistration = await registrations.upsert(
            identity,
            { ...identity, expiresAt: second } as EventSubscriberRegistration,
            { expiresAt: { set: second } }
        );

        expect(updated.id).toBe(inserted.id);
        expect(updated.expiresAt.getTime()).toBe(second.getTime());
        // the point of an upsert: the second call updated the row rather than adding one
        expect(await registrations.findAll()).toHaveLength(1);
    });

    it('applies a transaction on commit and discards it on rollback', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);

        const rolledBack: Transaction = started.dataSource.startTransaction();
        const inDoubt: User = await users.create(mockCreateUserData({ name: 'Gone' }), { transaction: rolledBack });

        // read your own writes: the transaction sees the row it wrote before it commits
        expect(await users.findById(inDoubt.id, { transaction: rolledBack, required: false })).toBeDefined();
        // and nobody else does
        expect(await users.findById(inDoubt.id, { required: false })).toBeUndefined();

        await rolledBack.rollback();
        expect(await users.findById(inDoubt.id, { required: false })).toBeUndefined();
        expect(rolledBack.isFinished).toBe(true);

        const committed: Transaction = started.dataSource.startTransaction();
        const kept: User = await users.create(mockCreateUserData({ name: 'Kept' }), { transaction: committed });
        await committed.commit();

        expect((await users.findById(kept.id)).name).toBe('Kept');
    });

    it('updates and deletes every row a filter matches', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        await users.create(mockCreateUserData({ name: 'Ada', active: true }));
        await users.create(mockCreateUserData({ name: 'Grace', active: true }));
        const inactive: User = await users.create(mockCreateUserData({ name: 'Alan', active: false }));

        const changed: number = await users.updateAll({ active: true }, { name: 'renamed' });
        expect(changed).toBe(2);
        expect(await users.findAll({ where: { name: 'renamed' } })).toHaveLength(2);
        // the row the filter did not match was left alone
        expect((await users.findById(inactive.id)).name).toBe('Alan');

        await users.deleteById(inactive.id);
        expect(await users.findById(inactive.id, { required: false })).toBeUndefined();
        expect(await users.findAll()).toHaveLength(2);
    });

    it('keeps its rows across a re initialization', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        const created: User = await users.create(mockCreateUserData({ name: 'Ada' }));
        const roles: Repository<Role> = started.dataSource.getRepository(Role);
        const admin: Role = await roles.create({ name: 'admin' });
        await users.updateById(created.id, { roles: [admin] });

        const before: InMemoryDataSource = started.dataSource;
        started = await reInitInMemoryTestApp(started);

        // asserted rather than assumed: if a re-init ever stopped replacing the data source object,
        // everything below would still pass while testing nothing
        expect(started.dataSource).not.toBe(before);

        // a different data source object out of a different di container, reading the rows the
        // previous one wrote - which is what a container-backed data source does, because nothing
        // stopped the container
        const afterReInit: Repository<User> = started.dataSource.getRepository(User);
        expect((await afterReInit.findById(created.id)).name).toBe('Ada');
        // the joins survive it too, not only the rows
        expect((await afterReInit.findById(created.id, { relations: ['roles'] })).roles.map(r => r.name)).toEqual(['admin']);
    });

    it('starts a new server on an empty store', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        await users.create(mockCreateUserData({ name: 'Ada' }));

        await started.app.shutdown();
        started.exitSpy.mockRestore();

        // the other half of the lifetime: starting a server rather than re initializing one is where
        // a container-backed harness takes a new container, so this takes a new store
        started = await startInMemoryTestApp();

        expect(await started.dataSource.getRepository(User).findAll({ take: 'all' })).toHaveLength(0);
    });

    it('restores a backup over whatever the store holds', async () => {
        const users: Repository<User> = started.dataSource.getRepository(User);
        const kept: User = await users.create(mockCreateUserData({ name: 'Ada' }));

        const backup: Buffer[] = [];
        for await (const chunk of started.dataSource.createBackupData()) {
            backup.push(Buffer.from(chunk as Buffer));
        }

        const afterBackup: User = await users.create(mockCreateUserData({ name: 'Written after the backup' }));
        await users.deleteById(kept.id);

        await started.dataSource.restoreBackup(Readable.from(backup));

        // a restore is a replacement rather than a merge: the row taken in the backup is back, and
        // the one written after it is not
        expect((await users.findById(kept.id)).name).toBe('Ada');
        expect(await users.findById(afterBackup.id, { required: false })).toBeUndefined();
    });
});