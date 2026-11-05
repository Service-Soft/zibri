import { afterEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { denyAll, scopeFor } from '../../entity/models/entity-scope.model';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { SoftDeleteEntity } from '../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../change-sets/soft-delete-repository';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about the rows a relation reaches: a relation
 * holds only the rows of the related entity the caller may see, and a filter or a count through it
 * judges only those. A file per data source runs them against repositories of its own.
 */

/**
 * The account the scopes restrict to, set by each case. Undefined while a case seeds rows, which
 * the scopes then do not restrict.
 */
let actingAs: string | undefined;

/**
 * Whether the invoices are hidden from everybody, for the case of a related entity whose scope
 * answers `denyAll`.
 */
let invoicesHidden: boolean = false;

/**
 * An account of a customer. Visible to its owner only.
 */
@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    scope: {
        restrictedTo: scopeFor<Account>(() => actingAs == undefined ? undefined : { ownerId: actingAs })
    }
})
export class Account extends BaseEntity {
    /**
     * Who may see the account.
     */
    @Property.string({ format: 'uuid' })
    ownerId!: string;

    /**
     * What it is called.
     */
    @Property.string()
    name!: string;

    /**
     * The invoices of the account, each with an owner of its own.
     */
    @Property.oneToMany({ target: () => Invoice, inverseSide: 'account', required: false })
    invoices?: Invoice[];

    /**
     * The tags on the account, each with an owner of its own.
     */
    @Property.manyToMany({ target: () => Tag, inverseSide: 'accounts', joinTable: true, required: false })
    tags?: Tag[];
}

/**
 * An invoice of an account. Visible to its own owner only, who need not be the account's.
 */
@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    scope: {
        restrictedTo: scopeFor<Invoice>(() => {
            if (invoicesHidden) {
                return denyAll;
            }
            return actingAs == undefined ? undefined : { ownerId: actingAs };
        })
    }
})
export class Invoice extends BaseEntity {
    /**
     * Who may see the invoice.
     */
    @Property.string({ format: 'uuid' })
    ownerId!: string;

    /**
     * What it charges.
     */
    @Property.number({ format: 'integer' })
    amount!: number;

    /**
     * The key of the account it belongs to.
     */
    @Property.string({ format: 'uuid', required: false })
    accountId?: string;

    /**
     * The account it belongs to.
     */
    @Property.manyToOne({ target: () => Account, joinColumn: 'accountId', inverseSide: 'invoices', required: false })
    account?: Account;
}

/**
 * A tag on accounts. Visible to its owner only.
 */
@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    scope: {
        restrictedTo: scopeFor<Tag>(() => actingAs == undefined ? undefined : { ownerId: actingAs })
    }
})
export class Tag extends BaseEntity {
    /**
     * Who may see the tag.
     */
    @Property.string({ format: 'uuid' })
    ownerId!: string;

    /**
     * What it says.
     */
    @Property.string()
    label!: string;

    /**
     * The accounts carrying the tag.
     */
    @Property.manyToMany({ target: () => Account, inverseSide: 'tags', joinTable: false, required: false })
    accounts?: Account[];
}

/**
 * A project whose tasks are soft deleted along with it.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Project extends SoftDeleteEntity {
    /**
     * What it is called.
     */
    @Property.string()
    name!: string;

    /**
     * Its tasks, deleted along with it.
     */
    @Property.oneToMany({ target: () => Task, inverseSide: 'project', required: false })
    tasks?: Task[];
}

/**
 * A task of a project, soft deleted on its own or along with the project.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Task extends SoftDeleteEntity {
    /**
     * What to do.
     */
    @Property.string()
    title!: string;

    /**
     * The key of the project it belongs to.
     */
    @Property.string({ format: 'uuid', required: false })
    projectId?: string;

    /**
     * The project it belongs to.
     */
    @Property.manyToOne({ target: () => Project, joinColumn: 'projectId', inverseSide: 'tasks', required: false })
    project?: Project;
}

/**
 * The entities the cases need, for a data source to declare.
 */
export const scopedRelationEntities: typeof BaseEntity[] = [Account, Invoice, Tag, Project, Task];

/**
 * The repositories the cases run against.
 */
export type ScopedRelationRepositories = {
    /**
     * The accounts.
     */
    accounts: Repository<Account>,
    /**
     * The invoices.
     */
    invoices: Repository<Invoice>,
    /**
     * The tags.
     */
    tags: Repository<Tag>,
    /**
     * The projects.
     */
    projects: SoftDeleteRepository<Project>,
    /**
     * The tasks.
     */
    tasks: SoftDeleteRepository<Task>
};

/**
 * What one case seeds: alice's account with an invoice of hers and one of bob's, tagged by both of
 * them, and bob's account with an invoice of alice's.
 */
type Seeded = {
    /**
     * Alice's account, tagged by both.
     */
    aliceAccount: Account,
    /**
     * Bob's account.
     */
    bobAccount: Account,
    /**
     * Alice's invoice on her account.
     */
    aliceInvoice: Invoice,
    /**
     * Bob's invoice on alice's account.
     */
    bobInvoice: Invoice,
    /**
     * Alice's invoice on bob's account.
     */
    aliceInvoiceOnBobAccount: Invoice,
    /**
     * Alice's tag.
     */
    aliceTag: Tag,
    /**
     * Bob's tag.
     */
    bobTag: Tag
};

/**
 * Runs every case against the repositories of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param reposOf - Reads the repositories, once the data source is started.
 */
export function describeScopedRelations(dataSourceName: string, reposOf: () => ScopedRelationRepositories): void {
    const alice: string = UUIDUtilities.generate();
    const bob: string = UUIDUtilities.generate();

    /**
     * Stores the rows of one case without acting as anybody.
     * @returns The rows.
     */
    async function seed(): Promise<Seeded> {
        actingAs = undefined;
        invoicesHidden = false;
        const { accounts, invoices, tags }: ScopedRelationRepositories = reposOf();
        const aliceTag: Tag = await tags.create({ ownerId: alice, label: 'vip' });
        const bobTag: Tag = await tags.create({ ownerId: bob, label: 'audit' });
        const aliceAccount: Account = await accounts.create({ ownerId: alice, name: 'alice', tags: [aliceTag, bobTag] });
        const bobAccount: Account = await accounts.create({ ownerId: bob, name: 'bob' });
        const aliceInvoice: Invoice = await invoices.create({ ownerId: alice, amount: 10, accountId: aliceAccount.id });
        const bobInvoice: Invoice = await invoices.create({ ownerId: bob, amount: 20, accountId: aliceAccount.id });
        const aliceInvoiceOnBobAccount: Invoice = await invoices.create({ ownerId: alice, amount: 30, accountId: bobAccount.id });
        return { aliceAccount, bobAccount, aliceInvoice, bobInvoice, aliceInvoiceOnBobAccount, aliceTag, bobTag };
    }

    /**
     * The ids of the given rows, in a stable order.
     * @param rows - The rows.
     * @returns Their ids, sorted.
     */
    function idsOf(rows: BaseEntity[] | undefined): string[] {
        return (rows ?? []).map(r => r.id).sort();
    }

    describe(`the rows a relation reaches, on ${dataSourceName}`, () => {
        afterEach(() => {
            actingAs = undefined;
            invoicesHidden = false;
        });

        it('hands back every related row to a caller the scopes do not restrict', async () => {
            const { aliceAccount, aliceInvoice, bobInvoice, aliceTag, bobTag }: Seeded = await seed();

            const account: Account = await reposOf().accounts.findById(aliceAccount.id, { relations: ['invoices', 'tags'] });

            // the control: without it a store resolving no relation at all would pass the cases below
            expect(idsOf(account.invoices)).toEqual(idsOf([aliceInvoice, bobInvoice]));
            expect(idsOf(account.tags)).toEqual(idsOf([aliceTag, bobTag]));
        });

        it('holds only the related rows the caller may see', async () => {
            const { aliceAccount, aliceInvoice, aliceTag }: Seeded = await seed();

            actingAs = alice;
            const byList: Account = await reposOf().accounts.findById(aliceAccount.id, { relations: ['invoices', 'tags'] });
            const byTree: Account = await reposOf().accounts.findById(aliceAccount.id, { relations: { invoices: true, tags: true } });

            expect(idsOf(byList.invoices)).toEqual([aliceInvoice.id]);
            expect(idsOf(byList.tags)).toEqual([aliceTag.id]);
            expect(idsOf(byTree.invoices)).toEqual([aliceInvoice.id]);
            expect(idsOf(byTree.tags)).toEqual([aliceTag.id]);
        });

        it('holds nothing for a to one relation pointing at a row the caller may not see', async () => {
            const { aliceInvoiceOnBobAccount, aliceInvoice }: Seeded = await seed();

            actingAs = alice;
            const hidden: Invoice = await reposOf().invoices.findById(aliceInvoiceOnBobAccount.id, { relations: ['account'] });
            const visible: Invoice = await reposOf().invoices.findById(aliceInvoice.id, { relations: ['account'] });

            expect(hidden.account).toBeUndefined();
            expect(visible.account?.id).toBe(aliceInvoice.accountId);
        });

        it('narrows every level of a relation of a relation', async () => {
            const { aliceInvoice }: Seeded = await seed();

            actingAs = alice;
            const invoice: Invoice = await reposOf().invoices.findById(aliceInvoice.id, { relations: { account: { invoices: true } } });

            expect(idsOf(invoice.account?.invoices)).toEqual([aliceInvoice.id]);
        });

        it('narrows the related rows of every row of a list', async () => {
            const { aliceAccount, aliceInvoice, bobInvoice }: Seeded = await seed();

            actingAs = alice;
            const accounts: Account[] = await reposOf().accounts.findAll({ where: { id: aliceAccount.id }, relations: ['invoices'] });
            const page: Account[] = (await reposOf().accounts.findAllPaginated(1, 10, {
                where: { id: aliceAccount.id },
                relations: ['invoices']
            })).items;
            const streamed: Account[] = [];
            for await (const account of reposOf().accounts.stream({ where: { id: aliceAccount.id }, relations: ['invoices'] })) {
                streamed.push(account);
            }

            expect(idsOf(accounts[0]?.invoices)).toEqual([aliceInvoice.id]);
            expect(idsOf(page[0]?.invoices)).toEqual([aliceInvoice.id]);
            expect(idsOf(streamed[0]?.invoices)).toEqual([aliceInvoice.id]);
            expect(idsOf(accounts[0]?.invoices)).not.toContain(bobInvoice.id);
        });

        it('judges a filter through a relation on the rows the caller may see', async () => {
            const { aliceAccount, aliceInvoice, bobInvoice }: Seeded = await seed();

            actingAs = alice;
            const byOwn: Account[] = await reposOf().accounts.findAll({
                where: { id: aliceAccount.id, invoices: { where: { amount: aliceInvoice.amount } } }
            });
            const byHidden: Account[] = await reposOf().accounts.findAll({
                where: { id: aliceAccount.id, invoices: { where: { amount: bobInvoice.amount } } }
            });

            expect(idsOf(byOwn)).toEqual([aliceAccount.id]);
            expect(byHidden).toEqual([]);
        });

        it('judges a filter through a to one relation on the rows the caller may see', async () => {
            const { aliceInvoiceOnBobAccount, bobAccount }: Seeded = await seed();

            actingAs = alice;
            const found: Invoice[] = await reposOf().invoices.findAll({
                where: { id: aliceInvoiceOnBobAccount.id, account: { where: { name: bobAccount.name } } }
            });

            // the invoice is hers, the account it points at is not, so no account of hers is named bob
            expect(found).toEqual([]);
        });

        it('counts the related rows the caller may see', async () => {
            const { aliceAccount }: Seeded = await seed();

            actingAs = alice;
            const ownCount: number = await reposOf().accounts.count({ where: { id: aliceAccount.id, invoices: { length: 1 } } });
            const fullCount: number = await reposOf().accounts.count({ where: { id: aliceAccount.id, invoices: { length: 2 } } });
            const tagCount: number = await reposOf().accounts.count({ where: { id: aliceAccount.id, tags: { length: 1 } } });

            expect(ownCount).toBe(1);
            expect(fullCount).toBe(0);
            expect(tagCount).toBe(1);
        });

        it('asks includes and isIncludedIn about the related rows the caller may see', async () => {
            const { aliceAccount, aliceInvoice, bobInvoice }: Seeded = await seed();

            actingAs = alice;
            const includesHidden: boolean = await reposOf().accounts.exists({
                where: { id: aliceAccount.id, invoices: { includes: [bobInvoice] } }
            });
            const includesOwn: boolean = await reposOf().accounts.exists({
                where: { id: aliceAccount.id, invoices: { includes: [aliceInvoice] } }
            });
            const allOwn: boolean = await reposOf().accounts.exists({
                where: { id: aliceAccount.id, invoices: { isIncludedIn: [aliceInvoice] } }
            });

            expect(includesHidden).toBe(false);
            expect(includesOwn).toBe(true);
            // every invoice of the account she may see is on the list, so the account is included
            expect(allOwn).toBe(true);
        });

        it('narrows a many to many relation from either side', async () => {
            const { aliceAccount, aliceTag, bobTag }: Seeded = await seed();

            actingAs = bob;
            const bobView: Tag = await reposOf().tags.findById(bobTag.id, { relations: ['accounts'] });
            const bobCount: number = await reposOf().tags.count({ where: { id: bobTag.id, accounts: { length: 0 } } });
            await expect(reposOf().tags.findById(aliceTag.id, { relations: ['accounts'] })).rejects.toThrow(NotFoundError);
            actingAs = alice;
            const aliceView: Tag = await reposOf().tags.findById(aliceTag.id, { relations: ['accounts'] });
            const aliceCount: number = await reposOf().tags.count({ where: { id: aliceTag.id, accounts: { length: 1 } } });

            // the account carrying bob's tag is alice's, which bob may not see
            expect(idsOf(bobView.accounts)).toEqual([]);
            expect(bobCount).toBe(1);
            expect(idsOf(aliceView.accounts)).toEqual([aliceAccount.id]);
            // counted from the side that does not own the junction table
            expect(aliceCount).toBe(1);
        });

        it('leaves a relation empty for a caller the related entity shuts out', async () => {
            const { aliceAccount, aliceInvoice }: Seeded = await seed();

            actingAs = alice;
            invoicesHidden = true;
            const account: Account = await reposOf().accounts.findById(aliceAccount.id, { relations: ['invoices'] });
            const emptyCount: number = await reposOf().accounts.count({ where: { id: aliceAccount.id, invoices: { length: 0 } } });
            const found: Account[] = await reposOf().accounts.findAll({
                where: { id: aliceAccount.id, invoices: { where: { amount: aliceInvoice.amount } } }
            });

            expect(account.invoices).toEqual([]);
            expect(emptyCount).toBe(1);
            expect(found).toEqual([]);
        });

        it('reaches the related rows too when the call reads across the restriction', async () => {
            const { aliceAccount, aliceInvoice, bobInvoice }: Seeded = await seed();

            actingAs = alice;
            const account: Account = await reposOf().accounts.findById(aliceAccount.id, { relations: ['invoices'], unscoped: true });
            const count: number = await reposOf().accounts.count({
                where: { id: aliceAccount.id, invoices: { length: 2 } },
                unscoped: true
            });

            expect(idsOf(account.invoices)).toEqual(idsOf([aliceInvoice, bobInvoice]));
            expect(count).toBe(1);
        });

        it('refuses a write that points a row at a row the caller may not see', async () => {
            const { bobAccount, aliceInvoice }: Seeded = await seed();

            actingAs = alice;
            const created: Promise<Invoice> = reposOf().invoices.create({ ownerId: alice, amount: 5, accountId: bobAccount.id });
            await expect(created).rejects.toThrow(ForbiddenError);
            const moved: Promise<Invoice> = reposOf().invoices.updateById(aliceInvoice.id, { accountId: bobAccount.id });
            await expect(moved).rejects.toThrow(ForbiddenError);

            // the control, and the way a call that may point across the restriction says so
            const allowed: Invoice = await reposOf().invoices.create(
                { ownerId: alice, amount: 5, accountId: bobAccount.id },
                { unscoped: true }
            );
            expect(allowed.accountId).toBe(bobAccount.id);
            actingAs = undefined;
            expect((await reposOf().invoices.findById(aliceInvoice.id)).accountId).not.toBe(bobAccount.id);
        });

        it('leaves soft deleted rows out of a relation, a filter through it and a count of it', async () => {
            actingAs = undefined;
            const { projects, tasks }: ScopedRelationRepositories = reposOf();
            const project: Project = await projects.create({ name: 'launch', tasks: [{ title: 'write' }, { title: 'ship' }] });
            const [deletedTask, keptTask]: Task[] = await tasks.findAll({ where: { projectId: project.id }, order: { title: 'DESC' } });
            if (deletedTask == undefined || keptTask == undefined) {
                throw new Error('The project was created without its tasks.');
            }

            await tasks.deleteById(deletedTask.id);

            const read: Project = await projects.findById(project.id, { relations: ['tasks'] });
            const withDeleted: Project = await projects.findById(project.id, { relations: ['tasks'], deleted: 'include' });
            const oneLeft: number = await projects.count({ where: { id: project.id, tasks: { length: 1 } } });
            const byDeletedTitle: boolean = await projects.exists({
                where: { id: project.id, tasks: { where: { title: deletedTask.title } } }
            });
            const includesDeleted: boolean = await projects.exists({ where: { id: project.id, tasks: { includes: [deletedTask] } } });

            expect(idsOf(read.tasks)).toEqual([keptTask.id]);
            // `deleted` says which projects the call reaches, and nothing about their tasks
            expect(idsOf(withDeleted.tasks)).toEqual([keptTask.id]);
            expect(oneLeft).toBe(1);
            expect(byDeletedTitle).toBe(false);
            expect(includesDeleted).toBe(false);
        });

        it('holds nothing for a to one relation pointing at a soft deleted row', async () => {
            actingAs = undefined;
            const { projects, tasks }: ScopedRelationRepositories = reposOf();
            const project: Project = await projects.create({ name: 'launch', tasks: [{ title: 'write' }] });

            await projects.deleteById(project.id);

            // the task went with its project, so it is read as deleted - and the project it points at
            // is deleted, which is not a row a relation holds
            const task: Task = await tasks.findOne({ where: { projectId: project.id }, relations: ['project'], deleted: 'include' });
            expect(task.project).toBeUndefined();
        });
    });
}