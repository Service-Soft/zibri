import { describe, expect, it } from 'vitest';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../entity/models/relation.type.ts';
import { scopeFor } from '../../entity/models/entity-scope.model.ts';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error.ts';
import { NotFoundError } from '../../error-handling/errors/not-found.error.ts';
import { TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { DataSourceInterface } from '../data-sources/data-source.interface.ts';
import { Repository } from '../repository/repository.ts';
import { NoActiveTenantError } from '../tenancy/no-active-tenant.error.ts';
import { Transaction } from '../transaction/transaction.model.ts';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error.ts';

/**
 * A row every tenant has its own of, with a code unique within a tenant and a scope hiding what is
 * archived - so that lifting the scope can be told apart from reaching another tenant.
 */
@Entity({
    allowOrphan: true,
    allowDuplicate: true,
    uniques: [['code']],
    scope: { restrictedTo: scopeFor<TenantNote>(() => ({ archived: false })) }
})
export class TenantNote extends BaseEntity {
    /**
     * The tenant the note belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * Unique within the tenant.
     */
    @Property.string()
    code!: string;

    /**
     * What the cases tell notes apart by.
     */
    @Property.string()
    title!: string;

    /**
     * Whether the scope hides the note.
     */
    @Property.boolean()
    archived!: boolean;
}

/**
 * A row that belongs to a tenant when it was made inside one, and is seen by every tenant otherwise.
 */
@Entity({ allowOrphan: true, allowDuplicate: true, uniques: [['slug']] })
export class TenantNotice extends BaseEntity {
    /**
     * The tenant the notice belongs to, or null for one every tenant sees.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;

    /**
     * What the cases tell notices apart by.
     */
    @Property.string()
    text!: string;

    /**
     * Unique among the notices of one tenant, and among those of no tenant.
     */
    @Property.string({ required: false })
    slug?: string | null;
}

/**
 * A tenant's row holding other rows of the tenant, handed back with them.
 */
@Entity({ allowOrphan: true, allowDuplicate: true, uniques: [['name']], defaultRelations: { tasks: true } })
export class TenantProject extends BaseEntity {
    /**
     * The tenant the project belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * Unique within the tenant.
     */
    @Property.string()
    name!: string;

    /**
     * The tasks of the project, of the same tenant.
     */
    @Property.oneToMany({ target: () => TenantTask, inverseSide: 'project' })
    tasks!: TenantTask[];
}

/**
 * A tenant's row pointing at another row of the tenant.
 */
@Entity({ allowOrphan: true, allowDuplicate: true })
export class TenantTask extends BaseEntity {
    /**
     * The tenant the task belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * What the cases tell tasks apart by.
     */
    @Property.string()
    title!: string;

    /**
     * The project the task belongs to.
     */
    @Property.manyToOne({ target: () => TenantProject, joinColumn: 'projectId', inverseSide: 'tasks' })
    project?: Relation<TenantProject>;

    /**
     * The id of that project.
     */
    @Property.string({ format: 'uuid', required: false })
    projectId?: string | null;
}

/**
 * The repositories the cases run against.
 */
export type TenantIsolationRepositories = {
    /**
     * The data source the repositories belong to, for the cases that run in a transaction.
     */
    dataSource: DataSourceInterface,
    /**
     * Rows that always belong to a tenant.
     */
    notes: Repository<TenantNote>,
    /**
     * Rows that belong to a tenant or to none.
     */
    notices: Repository<TenantNotice>,
    /**
     * Rows of a tenant holding other rows of it.
     */
    projects: Repository<TenantProject>,
    /**
     * Rows of a tenant pointing at other rows of it.
     */
    tasks: Repository<TenantTask>
};

/**
 * Shared cases for keeping the rows of one tenant out of another's reach, run against every data
 * source.
 * @param name - The name of the data source under test.
 * @param getRepositories - Returns the repositories under test, once the data source is up.
 */
export function describeTenantIsolation(name: string, getRepositories: () => TenantIsolationRepositories): void {
    // unique per run, so that the cases do not depend on what an earlier run left in a shared store
    const tenantA: string = UUIDUtilities.generate();
    const tenantB: string = UUIDUtilities.generate();

    const tenants: () => TenantServiceInterface = () => inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    const notes: () => Repository<TenantNote> = () => getRepositories().notes;
    const notices: () => Repository<TenantNotice> = () => getRepositories().notices;
    const projects: () => Repository<TenantProject> = () => getRepositories().projects;
    const tasks: () => Repository<TenantTask> = () => getRepositories().tasks;

    const createNote: (tenantId: string, title: string, archived?: boolean) => Promise<TenantNote> = async (
        tenantId,
        title,
        archived = false
    ) => {
        // an archived row is outside the scope, so writing one lifts it - and still lands in the tenant
        return await tenants().runAs(tenantId, async () => await notes().create(
            { code: UUIDUtilities.generate(), title, archived },
            { unscoped: archived }
        ));
    };

    describe(`tenant isolation on ${name}`, () => {
        it('fills in the active tenant on a new row', async () => {
            const note: TenantNote = await createNote(tenantA, 'filled');
            expect(note.tenantId).toBe(tenantA);
        });

        it('reads only the rows of the active tenant', async () => {
            const own: TenantNote = await createNote(tenantA, 'own');
            const other: TenantNote = await createNote(tenantB, 'other');

            await tenants().runAs(tenantA, async () => {
                const ids: string[] = (await notes().findAll({ take: 'all' })).map(n => n.id);
                expect(ids).toContain(own.id);
                expect(ids).not.toContain(other.id);

                // another tenant's row is answered exactly like a row that does not exist
                await expect(notes().findById(other.id)).rejects.toThrow(NotFoundError);
                expect(await notes().count({ where: { id: other.id } })).toBe(0);
                // a filter naming the other tenant outright finds nothing either
                expect(await notes().findAll({ where: { tenantId: tenantB }, take: 'all' })).toEqual([]);
            });
        });

        it('keeps the tenant when the scopes are lifted', async () => {
            const archivedOwn: TenantNote = await createNote(tenantA, 'archived own', true);
            const archivedOther: TenantNote = await createNote(tenantB, 'archived other', true);
            expect([archivedOwn.tenantId, archivedOther.tenantId]).toEqual([tenantA, tenantB]);

            await tenants().runAs(tenantA, async () => {
                const ids: string[] = (await notes().findAll({ unscoped: true, take: 'all' })).map(n => n.id);
                // the scope hid the archived row and no longer does...
                expect(ids).toContain(archivedOwn.id);
                // ...while the other tenant's stays out of reach
                expect(ids).not.toContain(archivedOther.id);
            });
        });

        it('refuses a tenant\'s rows while no tenant is active', async () => {
            await expect(notes().findAll({ take: 'all' })).rejects.toThrow(NoActiveTenantError);
            await expect(notes().findAll({ take: 'all', unscoped: true })).rejects.toThrow(NoActiveTenantError);
            await expect(notes().create({ code: 'outside', title: 'outside', archived: false }))
                .rejects.toThrow(NoActiveTenantError);
        });

        it('reaches every tenant when the call says so', async () => {
            const a: TenantNote = await createNote(tenantA, 'across a');
            const b: TenantNote = await createNote(tenantB, 'across b');

            const ids: string[] = (await notes().findAll({ acrossTenants: true, where: { id: { oneOf: [a.id, b.id] } } })).map(n => n.id);
            expect(ids.sort()).toEqual([a.id, b.id].sort());

            // a row written from outside every tenant names its tenant
            const named: TenantNote = await notes().create(
                { code: UUIDUtilities.generate(), title: 'named', archived: false, tenantId: tenantB },
                { acrossTenants: true }
            );
            expect(named.tenantId).toBe(tenantB);
        });

        it('hands back a row written across tenants with what it is read with', async () => {
            const created: TenantProject = await projects().create({ name: 'created across', tenantId: tenantB }, { acrossTenants: true });
            expect([created.tenantId, created.tasks]).toEqual([tenantB, []]);

            const name: string = 'upserted across';
            const upserted: TenantProject = await projects().upsert(
                { name },
                { name, tenantId: tenantB },
                { name: { set: name } },
                { acrossTenants: true }
            );
            expect([upserted.tenantId, upserted.tasks]).toEqual([tenantB, []]);
        });

        it('refuses a new row for another tenant', async () => {
            await tenants().runAs(tenantA, async () => {
                await expect(notes().create({ code: UUIDUtilities.generate(), title: 'smuggled', archived: false, tenantId: tenantB }))
                    .rejects.toThrow(ForbiddenError);
            });
        });

        it('never changes the tenant of a row', async () => {
            const note: TenantNote = await createNote(tenantA, 'staying');

            await tenants().runAs(tenantA, async () => {
                await expect(notes().updateById(note.id, { tenantId: tenantB })).rejects.toThrow(ForbiddenError);
                await expect(notes().updateAll({ id: note.id }, { tenantId: tenantB })).rejects.toThrow(ForbiddenError);
                // naming the tenant it already belongs to changes nothing, and is an ordinary update
                await expect(notes().updateById(note.id, { tenantId: tenantA, title: 'renamed' })).resolves.toBeDefined();
            });
            await expect(notes().updateById(note.id, { tenantId: tenantB }, { acrossTenants: true })).rejects.toThrow(ForbiddenError);

            const stored: TenantNote = await notes().findById(note.id, { acrossTenants: true });
            expect(stored.tenantId).toBe(tenantA);
        });

        it('writes only to the rows of the active tenant', async () => {
            const own: TenantNote = await createNote(tenantA, 'write own');
            const other: TenantNote = await createNote(tenantB, 'write other');

            await tenants().runAs(tenantA, async () => {
                await expect(notes().updateById(other.id, { title: 'taken over' })).rejects.toThrow(NotFoundError);
                await expect(notes().deleteById(other.id)).rejects.toThrow(NotFoundError);

                const updated: number = await notes().updateAll({ id: { oneOf: [own.id, other.id] } }, { title: 'bulk' });
                expect(updated).toBe(1);
                const deleted: number = await notes().deleteAll({ id: { oneOf: [own.id, other.id] } });
                expect(deleted).toBe(1);
            });

            const untouched: TenantNote = await notes().findById(other.id, { acrossTenants: true });
            expect(untouched.title).toBe('write other');
        });

        it('holds a unique within each tenant', async () => {
            const code: string = UUIDUtilities.generate();
            await tenants().runAs(tenantA, async () => await notes().create({ code, title: 'a', archived: false }));
            // the same code in another tenant is another tenant's business
            await tenants().runAs(tenantB, async () => await notes().create({ code, title: 'b', archived: false }));

            await tenants().runAs(tenantA, async () => {
                await expect(notes().create({ code, title: 'again', archived: false }))
                    .rejects.toThrow(UniqueConstraintViolationError);
            });
        });

        it('lands an upsert on the row of the active tenant', async () => {
            const code: string = UUIDUtilities.generate();
            const other: TenantNote = await tenants().runAs(
                tenantB,
                async () => await notes().create({ code, title: 'b', archived: false })
            );

            const upserted: TenantNote = await tenants().runAs(tenantA, async () => await notes().upsert(
                { code },
                { code, title: 'a', archived: false },
                { title: { set: 'a again' } }
            ));
            expect(upserted.tenantId).toBe(tenantA);
            expect(upserted.id).not.toBe(other.id);

            const untouched: TenantNote = await notes().findById(other.id, { acrossTenants: true });
            expect(untouched.title).toBe('b');
        });

        it('shows a row without a tenant to every tenant, and a tenant\'s row to that tenant only', async () => {
            const shared: TenantNotice = await notices().create({ text: 'for everyone' });
            const own: TenantNotice = await tenants().runAs(tenantA, async () => await notices().create({ text: 'for a' }));
            expect(shared.tenantId ?? undefined).toBeUndefined();
            expect(own.tenantId).toBe(tenantA);

            const insideA: string[] = await tenants().runAs(tenantA, async () => (await notices().findAll({ take: 'all' })).map(n => n.id));
            expect(insideA).toEqual(expect.arrayContaining([shared.id, own.id]));

            const insideB: string[] = await tenants().runAs(tenantB, async () => (await notices().findAll({ take: 'all' })).map(n => n.id));
            expect(insideB).toContain(shared.id);
            expect(insideB).not.toContain(own.id);

            const outside: string[] = (await notices().findAll({ take: 'all' })).map(n => n.id);
            expect(outside).toContain(shared.id);
            expect(outside).not.toContain(own.id);
        });

        it('changes a row of no tenant from inside a tenant only across tenants', async () => {
            const shared: TenantNotice = await notices().create({ text: 'for everyone' });

            await tenants().runAs(tenantA, async () => {
                // every tenant sees it, and so no single tenant changes it for all of them. Forbidden
                // rather than missing, since the same caller reads it
                await expect(notices().findById(shared.id)).resolves.toBeDefined();
                await expect(notices().updateById(shared.id, { text: 'changed by a' })).rejects.toThrow(ForbiddenError);
                await expect(notices().deleteById(shared.id)).rejects.toThrow(ForbiddenError);
                // a bulk write reaches the tenant's own rows, the way it leaves another tenant's alone
                expect(await notices().updateAll({ id: shared.id }, { text: 'changed by a' })).toBe(0);
                expect(await notices().deleteAll({ id: shared.id })).toBe(0);

                await notices().updateById(shared.id, { text: 'changed across' }, { acrossTenants: true });
            });

            const stored: TenantNotice = await notices().findById(shared.id);
            expect(stored.text).toBe('changed across');
        });

        it('writes a row of no tenant from inside a tenant only across tenants', async () => {
            await tenants().runAs(tenantA, async () => {
                // eslint-disable-next-line unicorn/no-null
                const inside: TenantNotice = await notices().create({ text: 'named none inside', tenantId: null });
                expect(inside.tenantId).toBe(tenantA);

                // eslint-disable-next-line unicorn/no-null
                const across: TenantNotice = await notices().create({ text: 'named none across', tenantId: null }, { acrossTenants: true });
                expect(across.tenantId ?? undefined).toBeUndefined();
                // and naming nothing across tenants is the active tenant, as everywhere else
                expect((await notices().create({ text: 'named nothing' }, { acrossTenants: true })).tenantId).toBe(tenantA);
            });
        });

        it('holds a unique among the rows of no tenant, apart from the rows of each tenant', async () => {
            const slug: string = UUIDUtilities.generate();
            await notices().create({ text: 'shared', slug });
            await expect(notices().create({ text: 'shared again', slug })).rejects.toThrow(UniqueConstraintViolationError);

            // a tenant's own row may hold what a row of no tenant holds, and is unique within the tenant
            await tenants().runAs(tenantA, async () => {
                await notices().create({ text: 'a', slug });
                await expect(notices().create({ text: 'a again', slug })).rejects.toThrow(UniqueConstraintViolationError);
            });
        });

        it('lands an upsert outside every tenant on the row of no tenant', async () => {
            const slug: string = UUIDUtilities.generate();
            const upsertShared: (text: string) => Promise<TenantNotice> = async text => await notices().upsert(
                { slug },
                { slug, text },
                { text: { set: text } }
            );
            const first: TenantNotice = await upsertShared('first');
            const second: TenantNotice = await upsertShared('second');
            expect(second.id).toBe(first.id);
            expect(second.text).toBe('second');
            expect(second.tenantId ?? undefined).toBeUndefined();

            const own: TenantNotice = await tenants().runAs(tenantA, async () => await notices().upsert(
                { slug },
                { slug, text: 'a' },
                { text: { set: 'a' } }
            ));
            expect(own.id).not.toBe(first.id);
            expect(own.tenantId).toBe(tenantA);

            // one batch names one key, so rows of no tenant and rows of a tenant go in batches of their own
            await expect(notices().upsertAll(
                ['slug'],
                [
                    { create: { slug: UUIDUtilities.generate(), text: 'shared' }, onConflict: { text: { set: 'shared' } } },
                    { create: { slug: UUIDUtilities.generate(), text: 'b', tenantId: tenantB }, onConflict: { text: { set: 'b' } } }
                ],
                { acrossTenants: true }
            )).rejects.toThrow(/rows of a tenant and rows of no tenant/);
        });

        it('gives the rows created beside a row its tenant', async () => {
            const project: TenantProject = await tenants().runAs(
                tenantA,
                async () => await projects().create({ name: 'nested', tasks: [{ title: 'first' }, { title: 'second' }] })
            );
            const created: TenantTask[] = await tasks().findAll({ acrossTenants: true, where: { projectId: project.id } });
            expect(created.map(t => t.tenantId)).toEqual([tenantA, tenantA]);

            await tenants().runAs(tenantA, async () => {
                await expect(projects().create({ name: 'smuggled', tasks: [{ title: 'b', tenantId: tenantB }] }))
                    .rejects.toThrow(ForbiddenError);
            });
        });

        it('refuses to point a row at a row of another tenant', async () => {
            const other: TenantProject = await tenants().runAs(tenantB, async () => await projects().create({ name: 'other' }));
            const own: TenantProject = await tenants().runAs(tenantA, async () => await projects().create({ name: 'own' }));

            await tenants().runAs(tenantA, async () => {
                // by the column, by the id of the row and by the row
                await expect(tasks().create({ title: 'by column', projectId: other.id })).rejects.toThrow(ForbiddenError);
                await expect(tasks().create({ title: 'by row', project: { id: other.id } })).rejects.toThrow(ForbiddenError);
                // a row that is not there at all is answered the same way
                await expect(tasks().create({ title: 'nowhere', projectId: UUIDUtilities.generate() })).rejects.toThrow(ForbiddenError);

                const task: TenantTask = await tasks().create({ title: 'own', projectId: own.id });
                await expect(tasks().updateById(task.id, { projectId: other.id })).rejects.toThrow(ForbiddenError);
                await expect(tasks().updateAll({ id: task.id }, { projectId: other.id })).rejects.toThrow(ForbiddenError);
                // the tenant's own rows stay reachable
                await expect(tasks().updateById(task.id, { projectId: own.id })).resolves.toBeDefined();
            });

            // across tenants the row's own tenant is what it is checked against
            const taskOfA: TenantTask = await tasks().create(
                { title: 'named', tenantId: tenantA, projectId: own.id },
                { acrossTenants: true }
            );
            await expect(tasks().updateById(taskOfA.id, { projectId: other.id }, { acrossTenants: true }))
                .rejects.toThrow(ForbiddenError);
        });

        it('refuses to point a row at a row another tenant wrote earlier in the same transaction', async () => {
            // a job going through every tenant in one transaction: what it wrote for one tenant is
            // still that tenant's while it works for the next
            const transaction: Transaction = await getRepositories().dataSource.startTransaction();
            try {
                const other: TenantProject = await tenants().runAs(
                    tenantB,
                    async () => await projects().create({ name: 'written for b' }, { transaction })
                );
                await tenants().runAs(tenantA, async () => {
                    await expect(tasks().create({ title: 'for a', projectId: other.id }, { transaction })).rejects.toThrow(ForbiddenError);
                });
            }
            finally {
                await transaction.rollback();
            }
        });

        it('refuses to point a row at a row the same transaction deleted', async () => {
            const transaction: Transaction = await getRepositories().dataSource.startTransaction();
            try {
                await tenants().runAs(tenantA, async () => {
                    const gone: TenantProject = await projects().create({ name: 'deleted again' }, { transaction });
                    await projects().deleteById(gone.id, { transaction });

                    await expect(tasks().create({ title: 'orphan', projectId: gone.id }, { transaction })).rejects.toThrow(ForbiddenError);
                });
            }
            finally {
                await transaction.rollback();
            }
        });

        it('never moves a row into a tenant or out of one', async () => {
            const shared: TenantNotice = await notices().create({ text: 'stays shared' });
            const own: TenantNotice = await tenants().runAs(tenantA, async () => await notices().create({ text: 'stays a' }));

            await tenants().runAs(tenantA, async () => {
                await expect(notices().updateById(shared.id, { tenantId: tenantA })).rejects.toThrow(ForbiddenError);
                // eslint-disable-next-line unicorn/no-null
                await expect(notices().updateById(own.id, { tenantId: null })).rejects.toThrow(ForbiddenError);
            });
        });
    });
}