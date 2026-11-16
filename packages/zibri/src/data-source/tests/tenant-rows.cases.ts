/* eslint-disable sonar/no-duplicate-string */
import assert from 'node:assert';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it } from '@jest/globals';

import { TenantRowsBackupResource } from '../../backup/tenant-rows.backup-resource';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { SoftDeleteEntity } from '../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../change-sets/soft-delete-repository';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { whereFor } from '../models/where/where-for.function';
import { Repository } from '../repository/repository';

/**
 * A tag of folders, on the side of the join table it does not own.
 */
@Entity({ allowDuplicate: true })
export class TenantRowsTag extends BaseTenantEntity() {

    @Property.string()
    name!: string;

    @Property.manyToMany({ target: () => TenantRowsFolder, inverseSide: 'tags', joinTable: false })
    folders!: TenantRowsFolder[];
}

/**
 * A folder, inside another one or at the top, holding files and tagged.
 */
@Entity({ allowDuplicate: true })
export class TenantRowsFolder extends BaseTenantEntity() {

    @Property.string()
    name!: string;

    // bound to its row, so that it decrypts again only in the row it was written to

    @Property.string({ encryption: true })
    note!: string;

    @Property.manyToOne({ target: () => TenantRowsFolder, joinColumn: 'parentId', inverseSide: 'children', required: false })
    parent?: TenantRowsFolder | null;

    @Property.string({ format: 'uuid', required: false })
    parentId?: string | null;

    @Property.oneToMany({ target: () => TenantRowsFolder, inverseSide: 'parent' })
    children!: TenantRowsFolder[];

    @Property.oneToMany({ target: () => TenantRowsFile, inverseSide: 'folder' })
    files!: TenantRowsFile[];

    @Property.manyToMany({ target: () => TenantRowsTag, inverseSide: 'folders', joinTable: true })
    tags!: TenantRowsTag[];
}

/**
 * A file in a folder.
 */
@Entity({ allowDuplicate: true })
export class TenantRowsFile extends BaseTenantEntity() {

    @Property.string()
    name!: string;

    // bytes, which a line of the backup carries as base64

    @Property.file({ allowedMimeTypes: 'all' })
    content!: Buffer;

    @Property.manyToOne({ target: () => TenantRowsFolder, joinColumn: 'folderId', inverseSide: 'files' })
    folder!: TenantRowsFolder;

    @Property.string({ format: 'uuid' })
    folderId!: string;
}

/**
 * A team, led by one of its members, and mentored by members of any team.
 */
@Entity({ allowDuplicate: true })
export class TenantRowsTeam extends BaseTenantEntity() {

    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => TenantRowsMember, joinColumn: 'leadId', inverseSide: 'leading', required: false })
    lead?: TenantRowsMember | null;

    @Property.string({ format: 'uuid', required: false })
    leadId?: string | null;

    @Property.oneToMany({ target: () => TenantRowsMember, inverseSide: 'team' })
    members!: TenantRowsMember[];

    @Property.manyToMany({ target: () => TenantRowsMember, inverseSide: 'mentored', joinTable: true })
    mentors!: TenantRowsMember[];
}

/**
 * A member of a team, which its rows cannot be written without.
 */
@Entity({ allowDuplicate: true })
export class TenantRowsMember extends BaseTenantEntity() {

    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => TenantRowsTeam, joinColumn: 'teamId', inverseSide: 'members' })
    team!: TenantRowsTeam;

    @Property.string({ format: 'uuid' })
    teamId!: string;

    @Property.oneToMany({ target: () => TenantRowsTeam, inverseSide: 'lead' })
    leading!: TenantRowsTeam[];

    @Property.manyToMany({ target: () => TenantRowsTeam, inverseSide: 'mentors', joinTable: false })
    mentored!: TenantRowsTeam[];
}

/**
 * A customer, which invoices point at. Its address, number and the moment it joined stay taken once it is
 * deleted.
 */
@Entity({ allowDuplicate: true, uniques: [{ properties: ['joinedAt'], where: whereFor<TenantRowsCustomer>({}) }] })
export class TenantRowsCustomer extends BaseTenantEntity(SoftDeleteEntity) {

    @Property.string()
    name!: string;

    @Property.string({ unique: { where: whereFor<TenantRowsCustomer>({}) } })
    email!: string;

    @Property.number({ unique: { where: whereFor<TenantRowsCustomer>({}) } })
    number!: number;

    @Property.date()
    joinedAt!: Date;

    @Property.oneToMany({ target: () => TenantRowsInvoice, inverseSide: 'customer', cascade: false })
    invoices!: TenantRowsInvoice[];
}

/**
 * An invoice of a customer: append-only, so that a backup of a tenant leaves it out and a restore never
 * changes it.
 */
@Entity({ allowDuplicate: true, appendOnly: true })
export class TenantRowsInvoice extends BaseTenantEntity() {

    @Property.number()
    amount!: number;

    @Property.manyToOne({ target: () => TenantRowsCustomer, joinColumn: 'customerId', inverseSide: 'invoices' })
    customer!: TenantRowsCustomer;

    @Property.string({ format: 'uuid' })
    customerId!: string;
}

/**
 * The entities the cases write, which the data source a suite boots declares. The team comes before its
 * members, so that its reference that may be empty is the first one a walk of them follows.
 */
export const TENANT_ROWS_ENTITIES: [
    typeof TenantRowsTag,
    typeof TenantRowsFolder,
    typeof TenantRowsFile,
    typeof TenantRowsTeam,
    typeof TenantRowsMember,
    typeof TenantRowsCustomer,
    typeof TenantRowsInvoice
] = [TenantRowsTag, TenantRowsFolder, TenantRowsFile, TenantRowsTeam, TenantRowsMember, TenantRowsCustomer, TenantRowsInvoice];

async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    return await tenants.runAs(tenantId, work);
}

async function resolveHeld(dataSource: DataSourceInterface, tenantId: string): Promise<unknown[]> {
    return await asTenant(tenantId, async () => {
        const folders: Repository<TenantRowsFolder> = dataSource.getRepository(TenantRowsFolder);
        return (await folders.findAll({ relations: { tags: true, files: true }, limit: 'all' }))
            .map(f => ({
                id: f.id,
                name: f.name,
                note: f.note,
                parentId: f.parentId ?? null,
                tags: f.tags.map(t => t.name).sort(),
                files: f.files.map(file => `${file.name}:${Buffer.from(file.content).toString('hex')}`).sort()
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    });
}

async function resolveTeams(dataSource: DataSourceInterface, tenantId: string): Promise<unknown[]> {
    return await asTenant(tenantId, async () => {
        const teams: Repository<TenantRowsTeam> = dataSource.getRepository(TenantRowsTeam);
        return (await teams.findAll({ relations: { lead: true, members: true, mentors: true }, limit: 'all' }))
            .map(t => ({
                name: t.name,
                lead: t.lead?.name ?? null,
                members: t.members.map(m => m.name).sort(),
                mentors: t.mentors.map(m => m.name).sort()
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    });
}

async function createTeam(dataSource: DataSourceInterface, name: string, memberNames: [string, string]): Promise<void> {
    const teams: Repository<TenantRowsTeam> = dataSource.getRepository(TenantRowsTeam);
    const team: TenantRowsTeam = await teams.create({ name, mentors: [] });
    const [lead, mentor] = await dataSource.getRepository(TenantRowsMember).createAll(memberNames.map(n => ({ name: n, teamId: team.id })));
    assert(lead && mentor, 'no members were created');
    await teams.updateById(team.id, { leadId: lead.id, mentors: [mentor] });
}

/**
 * A customer as a case compares it, with the amounts of its invoices.
 */
type HeldCustomer = {
    name: string,
    email: string,
    number: number,
    joinedAt: string,
    deleted: boolean,
    invoices: number[]
};

async function resolveCustomers(dataSource: DataSourceInterface, tenantId: string): Promise<HeldCustomer[]> {
    return await asTenant(tenantId, async () => {
        const customers: SoftDeleteRepository<TenantRowsCustomer> = dataSource.getRepository(TenantRowsCustomer);
        return (await customers.findAll({ deleted: 'include', relations: { invoices: true }, limit: 'all' }))
            .map(c => ({
                name: c.name,
                email: c.email,
                number: c.number,
                joinedAt: c.joinedAt.toISOString(),
                deleted: c.deleted,
                invoices: c.invoices.map(i => i.amount).sort((a, b) => a - b)
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    });
}

async function createCustomer(
    dataSource: DataSourceInterface,
    data: Pick<TenantRowsCustomer, 'name' | 'email' | 'number' | 'joinedAt'>,
    amount: number | undefined
): Promise<TenantRowsCustomer> {
    const customer: TenantRowsCustomer = await dataSource.getRepository(TenantRowsCustomer).create(data);
    if (amount != undefined) {
        await dataSource.getRepository(TenantRowsInvoice).create({ amount, customerId: customer.id });
    }
    return customer;
}

async function restoreKeeping(dataSource: DataSourceInterface, tenantId: string, backup: Buffer): Promise<void> {
    await new TenantRowsBackupResource(dataSource, tenantId).restoreBackup(Readable.from([backup]), () => Readable.from([backup]));
}

function day(n: number): Date {
    return new Date(Date.UTC(2026, 0, n));
}

async function readAll(data: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks);
}

/**
 * A backup of a tenant's rows read as of one moment, whatever is written while it is read: a row written
 * meanwhile is in it with every row it points at, or not at all.
 * @param name - The data source, in the name of the suite.
 * @param getDataSource - The data source, booted with {@link TENANT_ROWS_ENTITIES}.
 */
export function describeTenantRowsAsOfOneMoment(name: string, getDataSource: () => DataSourceInterface): void {
    describe(`the rows of a tenant, read as of one moment, on ${name}`, () => {
        it('leaves out a row written while the backup is read, after the rows before it were read', async () => {
            const tenant: string = UUIDUtilities.generate();
            // more folders than a stream reads ahead of whoever reads it, so that the files, which point at
            // folders and are read after every one of them, are not read yet when the first folder arrives
            const [folder] = await asTenant(tenant, async () => await getDataSource().getRepository(TenantRowsFolder)
                .createAll(
                    Array.from({ length: 200 }, (_, i) => ({ name: i ? `existing ${i}` : 'existing', note: 'n', tags: [] }))
                ));
            assert(folder, 'no folder was created');

            const lines: AsyncIterator<unknown> = new TenantRowsBackupResource(getDataSource(), tenant).createBackupData()
                [Symbol.asyncIterator]();
            const read: string[] = [];
            const folderLine: string = `"entity":"${MetadataUtilities.getEntityMetadata(TenantRowsFolder)?.tableName}"`;
            let stoppedAtAFolder: boolean = false;
            for (let next: IteratorResult<unknown> = await lines.next(); next.done !== true; next = await lines.next()) {
                read.push(String(next.value));
                if (String(next.value).includes(folderLine)) {
                    stoppedAtAFolder = true;
                    break;
                }
            }
            // not vacuous: the write below lands while the backup is being read, not after it
            expect(stoppedAtAFolder).toBe(true);
            await asTenant(tenant, async () => {
                await getDataSource().getRepository(TenantRowsFile)
                    .create({ name: 'written meanwhile', content: Buffer.from('x'), folderId: folder.id });
            });
            for (let next: IteratorResult<unknown> = await lines.next(); next.done !== true; next = await lines.next()) {
                read.push(String(next.value));
            }

            expect(read.join('')).toContain('"existing"');
            expect(read.join('')).not.toContain('written meanwhile');
        }, 60000);
    });
}

/**
 * The rows of one tenant read as stored and written back, in a data source that checks its foreign keys
 * at the end of each statement as much as in one that checks none.
 * @param name - The data source, in the name of the suite.
 * @param getDataSource - The data source, booted with {@link TENANT_ROWS_ENTITIES}.
 */
export function describeTenantRows(name: string, getDataSource: () => DataSourceInterface): void {
    describe(`the rows of a tenant, read as stored and written back, on ${name}`, () => {
        it('writes the rows back in an order their keys allow, and leaves every other tenant as it is', async () => {
            const tenantA: string = UUIDUtilities.generate();
            const tenantB: string = UUIDUtilities.generate();
            await asTenant(tenantA, async () => {
                const folders: Repository<TenantRowsFolder> = getDataSource().getRepository(TenantRowsFolder);
                const tags: TenantRowsTag[] = await getDataSource().getRepository(TenantRowsTag)
                    .createAll([{ name: 'shared' }, { name: 'draft' }]);
                const root: TenantRowsFolder = await folders.create({ name: 'root', note: 'the top', tags });
                const child: TenantRowsFolder = await folders.create({ name: 'child', note: 'below', parentId: root.id, tags: [] });
                await folders.create({ name: 'grandchild', note: 'deeper', parentId: child.id, tags: tags.slice(0, 1) });
                await getDataSource().getRepository(TenantRowsFile)
                    .create({ name: 'plan.txt', content: Buffer.from([0, 1, 254, 255]), folderId: child.id });
            });
            await asTenant(tenantB, async () => {
                await getDataSource().getRepository(TenantRowsFolder)
                    .create({ name: 'of the other tenant', note: 'b', tags: [] });
            });
            const atBackup: unknown[] = await resolveHeld(getDataSource(), tenantA);
            const backup: Buffer = await readAll(new TenantRowsBackupResource(getDataSource(), tenantA).createBackupData());

            await asTenant(tenantA, async () => {
                await getDataSource().getRepository(TenantRowsFile)
                    .deleteAll({});
                await getDataSource().getRepository(TenantRowsFolder)
                    .create({ name: 'created since', note: 'new', tags: [] });
            });
            await asTenant(tenantB, async () => {
                await getDataSource().getRepository(TenantRowsFolder)
                    .create({ name: 'of the other tenant, since', note: 'b2', tags: [] });
            });
            const otherTenant: unknown[] = await resolveHeld(getDataSource(), tenantB);

            await new TenantRowsBackupResource(getDataSource(), tenantA).restoreBackup(Readable.from([backup]));

            expect(await resolveHeld(getDataSource(), tenantA)).toStrictEqual(atBackup);
            expect(await resolveHeld(getDataSource(), tenantB)).toStrictEqual(otherTenant);
        }, 60000);

        it('lets another tenant read and write the same entities while it writes a tenant\'s rows back', async () => {
            const tenantA: string = UUIDUtilities.generate();
            const tenantB: string = UUIDUtilities.generate();
            await asTenant(tenantA, async () => {
                await getDataSource().getRepository(TenantRowsFolder)
                    .createAll(['first', 'second', 'third'].map(n => ({ name: n, note: 'n', tags: [] })));
            });
            const kept: TenantRowsFolder = await asTenant(tenantB, async () => {
                return await getDataSource().getRepository(TenantRowsFolder)
                    .create({ name: 'of the other tenant', note: 'b', tags: [] });
            });
            const backup: Buffer = await readAll(new TenantRowsBackupResource(getDataSource(), tenantA).createBackupData());
            await asTenant(tenantA, async () => {
                await getDataSource().getRepository(TenantRowsFolder)
                    .create({ name: 'created since', note: 'new', tags: [] });
            });
            // the backup as it is, held after its first row until the other tenant is done: by then the restore
            // has removed what it replaces of the tenant, and not written back all of it
            const [header, ...rows] = backup.toString('utf8').split('\n')
                .filter(line => line.length);
            let reachRow!: () => void;
            const rowReached: Promise<void> = new Promise(resolve => reachRow = resolve);
            let releaseRows!: () => void;
            const rowsReleased: Promise<void> = new Promise(resolve => releaseRows = resolve);
            // read one line ahead at most, so that the hold is reached once the restore took its first row, which
            // it takes after it removed what it replaces, rather than while the stream reads ahead of it
            const held: Readable = Readable.from((async function* holdAfterTheFirstRow(): AsyncGenerator<string> {
                yield `${header}\n`;
                for (const [i, row] of rows.entries()) {
                    yield `${row}\n`;
                    if (i === 0) {
                        reachRow();
                        await rowsReleased;
                    }
                }
            })(), { highWaterMark: 1 });

            const restored: Promise<void> = new TenantRowsBackupResource(getDataSource(), tenantA).restoreBackup(held);
            await rowReached;
            const otherTenant: Promise<string[]> = asTenant(tenantB, async () => {
                const folders: Repository<TenantRowsFolder> = getDataSource().getRepository(TenantRowsFolder);
                await folders.create({ name: 'written meanwhile', note: 'b', tags: [] });
                await folders.updateById(kept.id, { name: 'renamed meanwhile' });
                return (await folders.findAll()).map(f => f.name).sort();
            });
            // whatever the other tenant waits for, it waits until the restore goes on, which it never does here
            const outcome: string[] | 'held up' = await Promise.race([otherTenant, sleep(10_000).then(() => 'held up' as const)]);
            releaseRows();
            await restored;
            await otherTenant;

            expect(outcome).toEqual(['renamed meanwhile', 'written meanwhile']);
            expect(await asTenant(tenantA, async () => (await getDataSource().getRepository(TenantRowsFolder)
                .findAll()).map(f => f.name).sort()))
                .toEqual(['first', 'second', 'third']);
        }, 60000);

        it('writes back rows of two entities that point at each other, through a reference that may be empty', async () => {
            const tenant: string = UUIDUtilities.generate();
            await asTenant(tenant, async () => await createTeam(getDataSource(), 'core', ['lead', 'mentor']));
            const atBackup: unknown[] = await resolveTeams(getDataSource(), tenant);
            // not vacuous: the team points at its members, which point at it
            expect(atBackup).toStrictEqual([{ name: 'core', lead: 'lead', members: ['lead', 'mentor'], mentors: ['mentor'] }]);
            const backup: Buffer = await readAll(new TenantRowsBackupResource(getDataSource(), tenant).createBackupData());

            // pointing at each other as well, so that the restore removes rows of such a cycle
            await asTenant(tenant, async () => await createTeam(getDataSource(), 'created since', ['lead since', 'mentor since']));
            await new TenantRowsBackupResource(getDataSource(), tenant).restoreBackup(Readable.from([backup]));

            expect(await resolveTeams(getDataSource(), tenant)).toStrictEqual(atBackup);
        }, 60000);

        it('writes the rows that rows outside the backup point at over in place, and keeps those created since', async () => {
            const tenant: string = UUIDUtilities.generate();
            const anna: TenantRowsCustomer = await asTenant(tenant, async () => await createCustomer(
                getDataSource(), { name: 'anna', email: 'anna@example.com', number: 1, joinedAt: day(1) }, 10
            ));
            const backup: Buffer = await readAll(new TenantRowsBackupResource(getDataSource(), tenant).createBackupData());

            await asTenant(tenant, async () => {
                await getDataSource().getRepository(TenantRowsCustomer)
                    .updateById(anna.id, { name: 'anna, renamed' });
                await createCustomer(getDataSource(), { name: 'ben', email: 'ben@example.com', number: 2, joinedAt: day(2) }, 20);
                await createCustomer(
                    getDataSource(),
                    { name: 'carol', email: 'carol@example.com', number: 3, joinedAt: day(3) },
                    undefined
                );
            });
            await restoreKeeping(getDataSource(), tenant, backup);

            expect(await resolveCustomers(getDataSource(), tenant)).toStrictEqual([
                { name: 'anna', email: 'anna@example.com', number: 1, joinedAt: day(1).toISOString(), deleted: false, invoices: [10] },
                { name: 'ben', email: 'ben@example.com', number: 2, joinedAt: day(2).toISOString(), deleted: true, invoices: [20] }
            ]);
        }, 60000);

        it('gives a kept row a stand-in for each value of a unique the backup gives another row', async () => {
            const tenant: string = UUIDUtilities.generate();
            const anna: TenantRowsCustomer = await asTenant(tenant, async () => await createCustomer(
                getDataSource(), { name: 'anna', email: 'anna@example.com', number: 1, joinedAt: day(1) }, 10
            ));
            const backup: Buffer = await readAll(new TenantRowsBackupResource(getDataSource(), tenant).createBackupData());

            // ben takes up every value anna gave up since
            await asTenant(tenant, async () => {
                await getDataSource().getRepository(TenantRowsCustomer)
                    .updateById(anna.id, { email: 'anna@example.org', number: 7, joinedAt: day(7) });
                await createCustomer(getDataSource(), { name: 'ben', email: 'anna@example.com', number: 1, joinedAt: day(1) }, 20);
            });
            await restoreKeeping(getDataSource(), tenant, backup);

            const [restored, kept] = await resolveCustomers(getDataSource(), tenant);
            expect(restored).toStrictEqual({
                name: 'anna',
                email: 'anna@example.com',
                number: 1,
                joinedAt: day(1).toISOString(),
                deleted: false,
                invoices: [10]
            });
            expect(kept?.email).toMatch(/^anna@example\.com_\d{8}T\d{9}Z$/);
            expect(kept).toStrictEqual({
                name: 'ben',
                email: kept?.email,
                number: 2,
                joinedAt: new Date(day(1).getTime() + 1).toISOString(),
                deleted: true,
                invoices: [20]
            });
        }, 60000);

        it('writes over in place rows that swapped the values of their uniques since the backup', async () => {
            const tenant: string = UUIDUtilities.generate();
            const [anna, ben] = await asTenant(tenant, async () => [
                await createCustomer(getDataSource(), { name: 'anna', email: 'anna@example.com', number: 1, joinedAt: day(1) }, 10),
                await createCustomer(getDataSource(), { name: 'ben', email: 'ben@example.com', number: 2, joinedAt: day(2) }, 20)
            ]);
            const backup: Buffer = await readAll(new TenantRowsBackupResource(getDataSource(), tenant).createBackupData());

            await asTenant(tenant, async () => {
                const customers: Repository<TenantRowsCustomer> = getDataSource().getRepository(TenantRowsCustomer);
                await customers.updateById(anna.id, { email: 'anna@example.org', number: 3, joinedAt: day(3) });
                await customers.updateById(ben.id, { email: 'anna@example.com', number: 1, joinedAt: day(1) });
                await customers.updateById(anna.id, { email: 'ben@example.com', number: 2, joinedAt: day(2) });
            });
            await restoreKeeping(getDataSource(), tenant, backup);

            expect(await resolveCustomers(getDataSource(), tenant)).toStrictEqual([
                { name: 'anna', email: 'anna@example.com', number: 1, joinedAt: day(1).toISOString(), deleted: false, invoices: [10] },
                { name: 'ben', email: 'ben@example.com', number: 2, joinedAt: day(2).toISOString(), deleted: false, invoices: [20] }
            ]);
        }, 60000);

        it('refuses the rows of another tenant, and changes nothing', async () => {
            const tenantA: string = UUIDUtilities.generate();
            const tenantB: string = UUIDUtilities.generate();
            await asTenant(tenantB, async () => {
                await getDataSource().getRepository(TenantRowsFolder)
                    .create({ name: 'kept', note: 'b', tags: [] });
            });
            const ofA: Buffer = await readAll(new TenantRowsBackupResource(getDataSource(), tenantA).createBackupData());

            await expect(new TenantRowsBackupResource(getDataSource(), tenantB)
                .restoreBackup(Readable.from([ofA])))
                .rejects.toThrow('is restored into');

            expect(((await resolveHeld(getDataSource(), tenantB)) as { name: string }[]).map(f => f.name)).toStrictEqual(['kept']);
        }, 60000);
    });
}