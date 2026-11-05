import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Repository } from './repository';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { SoftDeleteEntity } from '../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../change-sets/soft-delete-repository';

/**
 * A row that is soft deleted, so the data source builds a `SoftDeleteRepository` for it.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
class Account extends SoftDeleteEntity {
    @Property.string()
    name!: string;
}

/**
 * A plain row with a default the before save hook fills in.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
class Gadget extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.string({ default: 'new', required: false })
    state?: string;
}

/**
 * The documented shape of a repository of your own, applied to an entity that soft deletes: it would
 * find deleted rows, record no change set and hard delete.
 */
class PlainAccountRepository extends Repository<Account> {
    constructor(repo: Repository<Account>) {
        super(Account, repo);
    }
}

/**
 * A repository of your own on an entity that soft deletes, extending what the data source built.
 */
class AccountRepository extends SoftDeleteRepository<Account> {
    constructor(repo: SoftDeleteRepository<Account>) {
        super(Account, repo);
    }

    async findTrash(): Promise<Account[]> {
        return await this.findAll({ deleted: 'only' });
    }
}

/**
 * A repository of your own on a plain entity.
 */
class GadgetRepository extends Repository<Gadget> {
    constructor(repo: Repository<Gadget>) {
        super(Gadget, repo);
    }
}

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Account, Gadget],
    repositories: defaultTestServerRepositories
});

describe('a repository of your own', () => {
    let server: StartedTestServer | undefined;
    let dataSource: InMemoryDataSource;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        dataSource = inject(dataSourceClass);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('is refused when it extends another class than the one it is built on, naming that class', () => {
        // was built without a word, as a plain repository over the driver: a deactivated account
        // logged in, since findByEmail found the deleted user
        expect(() => new PlainAccountRepository(dataSource.getRepository(Account))).toThrow(/has to extend SoftDeleteRepository/);
    });

    it('soft deletes the way the repository it is built on does', async () => {
        const accounts: AccountRepository = new AccountRepository(dataSource.getRepository(Account));
        const account: Account = await accounts.create({ name: 'closed' });

        await accounts.deleteById(account.id);

        expect((await accounts.findAll()).map(a => a.id)).not.toContain(account.id);
        expect((await accounts.findTrash()).map(a => a.id)).toContain(account.id);
        expect((await dataSource.getRepository(Account).findAll({ deleted: 'include' })).map(a => a.id)).toContain(account.id);
    });

    it('runs the hooks and belongs to the data source of the repository it is built on', async () => {
        const gadgets: GadgetRepository = new GadgetRepository(dataSource.getRepository(Gadget));

        const gadget: Gadget = await gadgets.create({ name: 'defaulted' });

        expect(gadget.state).toBe('new');
        expect(gadgets.dataSource).toBe(dataSource);
    });
});