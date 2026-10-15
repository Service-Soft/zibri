import { Readable } from 'node:stream';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../../data-source/data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../../data-source/migration/migration-entity.model';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { UniqueConstraintViolationError } from '../../data-source/unique-constraint-violation.error';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { RateLimitStateEntity } from '../../rate-limiting/stores/rate-limit-state-entity.model';
import { BaseRateLimitState } from '../../rate-limiting/stores/rate-limiter-store.interface';
import { RepositoryRateLimiterStore } from '../../rate-limiting/stores/repository.rate-limiter-store';
import { Newable } from '../../types/newable.type';
import { createTestDataSource } from '../test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/01-data-layer.md M16, M17 and M22.
 *
 * M16 and M17 were the same thing from two directions: an operation that is supposed to be all or
 * nothing did part of its work where nothing could take it back. M16 deleted before it knew the
 * replacement was good, M17 wrote outside the batch it belonged to. Neither is observable from a run
 * that succeeds, which is why both tests interrupt one.
 *
 * M22 is a third: a declaration one store enforced and the other only indexed, so what `unique` meant
 * depended on where the entity was stored.
 *
 * All three are closed now, so this file is the guard rather than the report: each case is paired
 * with a control, and it is the controls that stop a future change from making the refused case pass
 * by breaking the accepted one. See ./README.md for the convention.
 */

@Entity({ tenant: 'shared', allowOrphan: true })
class ValKeyDoc extends BaseEntity {
    @Property.string({ required: false })
    title: string | undefined | null;

    @Property.string({ required: false })
    heading: string | undefined | null;
}

/**
 * The single property form of a unique declaration.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class ValKeyAccount extends BaseEntity {
    @Property.string({ unique: true })
    email!: string;

    @Property.number({ required: false })
    logins: number | undefined | null;
}

/**
 * The multi property form, which is a different declaration rather than the same one repeated: only
 * the combination names at most one row, so either half on its own may repeat.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['tenant', 'name']] })
class ValKeyProject extends BaseEntity {
    @Property.string()
    tenant!: string;

    @Property.string()
    name!: string;
}

/**
 * A stream that hands over the given lines and then fails, the way a cut connection does.
 * @param lines - The lines to produce before failing.
 * @returns The stream.
 */
function streamThatFailsAfter(lines: string[]): Readable {
    let index: number = 0;
    return new Readable({
        read(): void {
            if (index < lines.length) {
                this.push(lines[index]);
                index++;
                return;
            }
            this.destroy(new Error('the backup stream was cut'));
        }
    });
}

let server: StartedTestServer | undefined;
let dataSource: ValKeyDataSource;
let docRepository: Repository<ValKeyDoc>;
let accountRepository: Repository<ValKeyAccount>;
let projectRepository: Repository<ValKeyProject>;
let rateLimitRepository: Repository<RateLimitStateEntity>;

const postgresDataSourceClass: Newable<DataSourceInterface> = createTestDataSource();

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, RateLimitStateEntity, ValKeyDoc, ValKeyAccount, ValKeyProject]
});

/**
 * Reads a full backup of the valkey data source into its lines.
 * @returns One string per backed up key.
 */
async function backupLines(): Promise<string[]> {
    const chunks: string[] = [];
    for await (const chunk of dataSource.createBackupData()) {
        chunks.push(String(chunk));
    }
    return chunks;
}

beforeAll(async () => {
    server = await startTestServer({
        // the postgres data source keeps the framework entities working, valkey is the one under test
        dataSources: [postgresDataSourceClass as Newable<PostgresDataSource>, valKeyDataSourceClass]
    });
    dataSource = inject(valKeyDataSourceClass);
    docRepository = inject(repositoryTokenFor(ValKeyDoc));
    accountRepository = inject(repositoryTokenFor(ValKeyAccount));
    projectRepository = inject(repositoryTokenFor(ValKeyProject));
    rateLimitRepository = inject(repositoryTokenFor(RateLimitStateEntity, valKeyDataSourceClass));
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 15000);

beforeEach(async () => {
    await docRepository.deleteAll({});
    await accountRepository.deleteAll({});
    await projectRepository.deleteAll({});
    await rateLimitRepository.deleteAll({});
});

describe('evaluation/01-data-layer M16 - a restore must not destroy before it succeeds', () => {

    it('restores the state the backup was created in', async () => {
        // a control: it establishes that backup and restore work at all, so the red below is about
        // the interrupted stream rather than about restoring being broken here
        await docRepository.create({ title: 'Alpha' });
        const lines: string[] = await backupLines();

        await docRepository.deleteAll({});
        await dataSource.restoreBackup(Readable.from(lines));

        expect((await docRepository.findAll()).map(d => d.title)).toEqual(['Alpha']);
    });

    it('leaves the store as it was when the backup stream fails part way through', async () => {
        await docRepository.create({ title: 'Alpha' });
        await docRepository.create({ title: 'Beta' });
        const lines: string[] = await backupLines();
        // a backup worth restoring has more than one key in it, or there is nothing to be partial about
        expect(lines.length).toBeGreaterThan(1);

        await expect(dataSource.restoreBackup(streamThatFailsAfter(lines.slice(0, 1)))).rejects.toThrow();

        // every key is deleted before the first line is even read, so a truncated stream, a
        // malformed line or a network blip leaves the store wiped and half filled. There is no
        // staging step and nothing to roll back to - the data that was there is simply gone.
        const titles: (string | undefined | null)[] = (await docRepository.findAll()).map(d => d.title);

        expect(titles.sort()).toEqual(['Alpha', 'Beta']);
    });
});

describe('evaluation/01-data-layer M17 - a transaction must not apply part of its work early', () => {

    it('renames a property when the migration commits', async () => {
        // a control: it establishes that the rename works, so the red below is about the rollback
        const created: ValKeyDoc = await docRepository.create({ title: 'the original value' });
        const transaction: Transaction = dataSource.startTransaction();

        await dataSource.changePropertyOfEntity({
            entity: ValKeyDoc,
            currentProperty: { name: 'title', type: 'string', required: false },
            property: { name: 'heading', type: 'string', required: false },
            transaction
        });
        await transaction.commit();

        const stored: ValKeyDoc = await docRepository.findById(created.id);
        expect(stored.heading).toBe('the original value');
    });

    it('keeps the old property when the migration is rolled back', async () => {
        const created: ValKeyDoc = await docRepository.create({ title: 'the original value' });
        const transaction: Transaction = dataSource.startTransaction();

        await dataSource.changePropertyOfEntity({
            entity: ValKeyDoc,
            currentProperty: { name: 'title', type: 'string', required: false },
            property: { name: 'heading', type: 'string', required: false },
            transaction
        });
        await transaction.rollback();

        // the write of the new field is buffered and discarded with the rollback, but the removal of
        // the old one is issued straight away because it cannot be buffered. So the rollback throws
        // away the only copy that was left: the value is under neither name afterwards.
        const stored: ValKeyDoc = await docRepository.findById(created.id);

        expect(stored.title).toBe('the original value');
    });
});

describe('evaluation/01-data-layer M22 - a unique declaration means the same on every store', () => {

    it('stores a row whose unique value nothing else holds', async () => {
        // a control: the refusals below have to be about the second row rather than about writing a
        // row carrying a unique property at all
        const created: ValKeyAccount = await accountRepository.create({ email: 'first@example.com' });

        expect((await accountRepository.findAll()).map(a => a.id)).toEqual([created.id]);
    });

    it('refuses a second row carrying a value the first one already holds', async () => {
        await accountRepository.create({ email: 'taken@example.com' });

        await expect(accountRepository.create({ email: 'taken@example.com' }))
            .rejects.toThrow(UniqueConstraintViolationError);
    });

    it('names the property the refused write collided on', async () => {
        await accountRepository.create({ email: 'named@example.com' });

        // the same answer a sql store gives, which is the whole of the finding: `unique` is declared
        // on the entity, so what it means cannot depend on which store the entity ended up in
        await expect(accountRepository.create({ email: 'named@example.com' }))
            .rejects.toMatchObject({ properties: ['email'] });
    });

    it('leaves the row that holds the value exactly as it was', async () => {
        const first: ValKeyAccount = await accountRepository.create({ email: 'kept@example.com', logins: 1 });

        await expect(accountRepository.create({ email: 'kept@example.com', logins: 2 })).rejects.toThrow();

        const stored: ValKeyAccount[] = await accountRepository.findAll();
        expect(stored).toHaveLength(1);
        expect(stored[0]?.id).toBe(first.id);
        expect(stored[0]?.logins).toBe(1);
    });

    it('lets a row be written again while it keeps the value it already holds', async () => {
        const created: ValKeyAccount = await accountRepository.create({ email: 'mine@example.com', logins: 1 });

        // its own id is what the index points at, and a row is not a duplicate of itself
        await accountRepository.updateById(created.id, { logins: 2 });

        expect((await accountRepository.findById(created.id)).logins).toBe(2);
    });

    it('frees a value once the row holding it moved to another one', async () => {
        const created: ValKeyAccount = await accountRepository.create({ email: 'before@example.com' });
        await accountRepository.updateById(created.id, { email: 'after@example.com' });

        await expect(accountRepository.create({ email: 'before@example.com' })).resolves.toBeDefined();
    });

    it('frees a value once the row holding it is deleted', async () => {
        const created: ValKeyAccount = await accountRepository.create({ email: 'gone@example.com' });
        await accountRepository.deleteById(created.id);

        await expect(accountRepository.create({ email: 'gone@example.com' })).resolves.toBeDefined();
    });

    it('refuses two rows of one save that carry the same value', async () => {
        // the rows of a save are written together, so neither of them is stored yet when the other is
        // checked. What answers here has to be what the save has already taken, not only what the
        // server holds.
        await expect(accountRepository.createAll([
            { email: 'both@example.com' },
            { email: 'both@example.com' }
        ])).rejects.toThrow(UniqueConstraintViolationError);

        expect(await accountRepository.findAll()).toHaveLength(0);
    });

    it('refuses a group only once every property of it repeats', async () => {
        await projectRepository.create({ tenant: 'acme', name: 'website' });

        // either half on its own is free, which is what makes a group a declaration of its own rather
        // than two single ones
        await expect(projectRepository.create({ tenant: 'acme', name: 'intranet' })).resolves.toBeDefined();
        await expect(projectRepository.create({ tenant: 'other', name: 'website' })).resolves.toBeDefined();

        await expect(projectRepository.create({ tenant: 'acme', name: 'website' }))
            .rejects.toThrow(UniqueConstraintViolationError);
    });

    it('does not split a rate limit across two rows when the lock does not hold', async () => {
        // the framework's own rate limiter store catches a failing create and treats it as "somebody
        // else created this key", which is only true where the key is enforced. Its lock normally
        // keeps two first inserts apart, so this removes the lock: the situation a lease that lapsed
        // under its holder leaves behind, and the one the row's version cannot cover, because an
        // insert has no row yet to carry a version.
        const unlocked: RepositoryRateLimiterStore<BaseRateLimitState> = new RepositoryRateLimiterStore(
            rateLimitRepository,
            { withLock: async (_key, run) => await run() },
            'unlocked-rate-limits'
        );
        const expiresAtMs: number = Date.now() + 60000;

        await Promise.all(Array.from({ length: 3 }, () => unlocked.atomicUpdate('user:42', current => ({
            ...current,
            expiresAtMs,
            reservations: [],
            count: ((current as BaseRateLimitState & { count?: number } | undefined)?.count ?? 0) + 1
        } as BaseRateLimitState))));

        // two rows for one key means the limit is counted twice and enforced once, so a caller that
        // should have been refused is let through - during a burst, which is the only time it matters
        expect(await rateLimitRepository.findAll({ where: { key: 'user:42' } })).toHaveLength(1);

        const state: BaseRateLimitState & { count?: number } | undefined = await unlocked.get('user:42');
        expect(state?.count).toBe(3);
    });
});