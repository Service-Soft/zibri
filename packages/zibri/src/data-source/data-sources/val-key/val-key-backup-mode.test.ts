import { once } from 'node:events';
import { Readable } from 'node:stream';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { BackupDataOptionsTestUtilities } from '../../../__testing__/backup/backup-data-options-test.utilities';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { TestMembership } from '../../../__testing__/mocks/entities/test-membership.entity';
import { TestRole } from '../../../__testing__/mocks/entities/test-role.entity';
import { defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { AuditCheckpoint } from '../../../audit/audit-checkpoint.model';
import { AuditEntry } from '../../../audit/audit-entry.model';
import { OtpCredentials } from '../../../auth/2fa/methods/otp/otp-credentials.model';
import { TwoFactorFailureStreak } from '../../../auth/2fa/two-factor-failure-streak.model';
import { PasswordCredentials } from '../../../auth/authenticators/password/password-credentials.model';
import { EncryptionKey } from '../../../auth/encryption/encryption-key.model';
import { EncryptionRotationFailure } from '../../../auth/encryption/encryption-rotation-failure.model';
import { EncryptionRotationProgress } from '../../../auth/encryption/encryption-rotation-progress.model';
import { SigningKey } from '../../../auth/encryption/signing-key.model';
import { EncryptionStrategyEntity } from '../../../auth/encryption/strategies/encryption-strategy-entity.model';
import { HashStrategyEntity } from '../../../auth/hash/strategies/hash-strategy-entity.model';
import { LoginTicket } from '../../../auth/models/login-ticket.model';
import { PasswordResetToken } from '../../../auth/models/password-reset-token.model';
import { JwtRefreshToken } from '../../../auth/strategies/jwt/jwt-refresh-token.model';
import { CacheInvalidation } from '../../../caching/cache-invalidation.model';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { Email } from '../../../email/models/email.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { EventSubscriberRegistration } from '../../../event/event-subscriber-registration.model';
import { EventSubscriberRun } from '../../../event/event-subscriber-run.model';
import { Event } from '../../../event/event.model';
import { Lease } from '../../../leases/lease.model';
import { Log } from '../../../logging/log.model';
import { Newable } from '../../../types/newable.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ChainAnchor } from '../../chain/chain-anchor.model';
import { DataSource } from '../../decorators/data-source.decorator';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Repository } from '../../repository/repository';
import { RepositoryClass } from '../../repository/repository-class.type';
import { applyGuardedValKeyWrites } from '../../transaction/apply-guarded-val-key-writes.function';
import { Transaction } from '../../transaction/transaction.model';
import { ValKeyBackupMode } from './val-key-backup-mode.model';
import { ValKeyCopyOnWriteUtilities } from './val-key-copy-on-write.utilities';
import { ValKeyDataSource, ValKeyOptions } from './val-key-data-source.model';
import { valKeyGlide } from './val-key-glide.function';
import { ValKeyRestoreMode } from './val-key-restore-mode.model';
import { ValKeyScanUtilities } from './val-key-scan.utilities';

// a backup walked the keys while transactions committed
// in between, and a restore swapped in whatever the walk saw with nothing bringing a row and its
// index entries back in line

@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['code']] })
class StockedItem extends BaseEntity {
    @Property.string()
    code!: string;
}

@DataSource()
class BackedUpValKeyDataSource extends ValKeyDataSource {
    // not readonly, so that the cases can take each mode in turn
    override backupMode: ValKeyBackupMode | undefined = 'snapshot';
    override restoreMode: ValKeyRestoreMode | undefined = 'staged';

    override options: ValKeyOptions = {
        host: 'localhost',
        // the container serves no tls
        useTLS: false,
        keyPrefix: `test-${UUIDUtilities.generate()}`
    };

    entities: Newable<BaseEntity>[] = [
        MigrationEntity,
        StockedItem,
        JwtUser,
        TestMembership,
        TestRole,
        Log,
        AuditEntry,
        AuditCheckpoint,
        PasswordCredentials,
        PasswordResetToken,
        LoginTicket,
        JwtRefreshToken,
        CacheInvalidation,
        TwoFactorFailureStreak,
        OtpCredentials,
        Lease,
        Email,
        Event,
        EventSubscriberRun,
        EventSubscriberRegistration,
        HashStrategyEntity,
        EncryptionStrategyEntity,
        EncryptionKey,
        EncryptionRotationProgress,
        EncryptionRotationFailure,
        SigningKey,
        ChainAnchor
    ];

    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * A data source of an application of 3.0, whose check of its backup configuration adds a check of its own and
 * returns nothing.
 */
class SyncCheckingValKeyDataSource extends BackedUpValKeyDataSource {
    override validateBackupConfiguration(): void {
        // as 3.0 wrote it, when the check it calls returned nothing
        // eslint-disable-next-line typescript/no-floating-promises
        super.validateBackupConfiguration();
        if (this.options.keyPrefix == undefined) {
            throw new Error('a backed up data source of this application keeps its keys under a prefix');
        }
    }
}

/**
 * How many items {@link largeItems} makes.
 */
const LARGE_ITEMS: number = 1000;

/**
 * How many members the set of a case holds that leaves the server no room for its copy: about 4 MiB.
 */
// far more than the server frees meanwhile, as the 8 MiB of the items are. The server counts the buffer of a
// request as used until it trims it a while later, and a case before these reads and writes a set of 1500 members
// in one request each: trimmed once a case had measured what is free, that was about the room a copy of such a
// set takes, which then fit where the case leaves none
const MEMBERS_WITHOUT_ROOM: number = 20_000;

let server: StartedTestServer | undefined;
let dataSource: BackedUpValKeyDataSource;
let items: Repository<StockedItem>;

/**
 * Reads a whole backup into memory, so that it can be restored after the store changed.
 * @param backup - The backup, as the data source streams it.
 * @returns Its chunks.
 */
async function readBackup(backup: Readable): Promise<unknown[]> {
    const chunks: unknown[] = [];
    for await (const chunk of backup) {
        chunks.push(chunk);
    }
    return chunks;
}

/**
 * The codes of every item stored, sorted.
 * @returns The codes.
 */
async function findCodes(): Promise<string[]> {
    return (await items.findAll()).map(i => i.code).sort();
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [BackedUpValKeyDataSource] });
    dataSource = inject(BackedUpValKeyDataSource);
    items = dataSource.getRepository(StockedItem);
}, 50000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describe('a valkey backup', () => {
    beforeEach(async () => {
        // staged, unless a case says otherwise
        dataSource.restoreMode = 'staged';
        await items.deleteAll({});
    }, 30000);

    it('warns about a backed up data source that does not say how it is restored, and restores it staged', async () => {
        // eslint-disable-next-line typescript/typedef
        const warnSpy = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');
        dataSource.restoreMode = undefined;
        try {
            await dataSource.validateBackupConfiguration();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sets no restoreMode'));

            // more items than one request writes, so that some are staged before the backup ends
            await items.createAll(Array.from({ length: 600 }, (_, i) => ({ code: `${i}` })));
            const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
            await items.deleteAll({});
            // what is staged is held aside while it is, which a scan made meanwhile finds
            let stagedSeen: boolean = false;
            const watching: Readable = Readable.from((async function* watch(): AsyncGenerator<unknown> {
                yield* backup;
                stagedSeen = (await ValKeyScanUtilities.findKeys(dataSource.connection, `${dataSource.keyPrefix}:zibri.restore:*`)).length > 0;
            })());
            await dataSource.restoreBackup(watching);

            expect(stagedSeen).toBe(true);
            expect(await findCodes()).toHaveLength(600);
        }
        finally {
            warnSpy.mockRestore();
        }
    }, 30000);

    it.each<ValKeyRestoreMode>(['staged', 'direct'])('restores the items it was taken with and none since, keeping what a backup running holds aside, %s', async mode => {
        dataSource.restoreMode = mode;
        // more items than one request writes
        await items.createAll(Array.from({ length: 600 }, (_, i) => ({ code: `${i}` })));
        const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
        await items.deleteAll({});
        await items.create({ code: 'later' });
        const aside: string = `${dataSource.keyPrefix}:zibri.backup:${UUIDUtilities.generate()}:${dataSource.keyPrefix}:stocked_item:copy`;
        await dataSource.connection.set(aside, 'held aside');
        try {
            await dataSource.restoreBackup(Readable.from(backup));

            expect(await findCodes()).toEqual(Array.from({ length: 600 }, (_, i) => `${i}`).sort());
            expect(await dataSource.connection.get(aside)).toBe('held aside');
            // the unique of each item restored with it
            await expect(items.create({ code: '0' })).rejects.toThrow();
        }
        finally {
            await dataSource.connection.del([aside]);
        }
    }, 60000);

    // as 3.0 took it, which named neither
    it('takes a backup without the backup and the options, sorting in the temp folder of backups, and restores it', async () => {
        await items.createAll(Array.from({ length: 10 }, (_, i) => ({ code: `${i}` })));
        const backup: unknown[] = await readBackup(dataSource.createBackupData());
        await items.deleteAll({});

        await dataSource.restoreBackup(Readable.from(backup));

        expect(await findCodes()).toEqual(Array.from({ length: 10 }, (_, i) => `${i}`).sort());
    }, 30000);

    it('writes part of a backup that fails part way in place of what was stored, restored direct, which restoring what was stored puts back', async () => {
        dataSource.restoreMode = 'direct';
        // more items than one request writes, so that some are written before the line that fails
        await items.createAll(Array.from({ length: 600 }, (_, i) => ({ code: `${i}` })));
        const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
        await items.deleteAll({});
        const kept: StockedItem = await items.create({ code: 'kept' });
        // what the backup service holds on to before it restores
        const snapshot: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));

        await expect(dataSource.restoreBackup(Readable.from([...backup, 'not a line of a backup\n']))).rejects.toThrow();
        // what was stored is gone, and the rows of the backup written before the line that failed are there
        expect(await dataSource.connection.exists([`${dataSource.keyPrefix}:stocked_item:${kept.id}`])).toBe(0);
        expect((await ValKeyScanUtilities.findKeys(dataSource.connection, `${dataSource.keyPrefix}:stocked_item:*`)).length).toBeGreaterThan(1);

        await dataSource.restoreBackup(Readable.from(snapshot));

        expect(await findCodes()).toEqual(['kept']);
        expect(await ValKeyScanUtilities.findKeys(dataSource.connection, `${dataSource.keyPrefix}:zibri.restore:*`)).toEqual([]);
    }, 60000);

    it('refuses to start a backed up data source that does not say how it is backed up', () => {
        dataSource.backupMode = undefined;
        try {
            // at once, as an override of 3.0 calling it without awaiting it gets it
            expect(() => dataSource.validateBackupConfiguration()).toThrow(
                'Invalid data source marked with @Backup: backupMode is not set.'
            );
        }
        finally {
            dataSource.backupMode = 'snapshot';
        }
    });

    it('takes an override of its check as 3.0 wrote one, returning nothing', () => {
        // what holds is that the class compiles
        expect(SyncCheckingValKeyDataSource.prototype.validateBackupConfiguration).toBeInstanceOf(Function);
    });

    describe('the memory settings of the server', () => {
        /**
         * What validating the backup configuration warns about the memory of the server.
         * @returns The warnings.
         */
        async function findMemoryWarnings(): Promise<string[]> {
            // eslint-disable-next-line typescript/typedef
            const warnSpy = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'warn');
            try {
                await dataSource.validateBackupConfiguration();
                return warnSpy.mock.calls.map(([message]) => String(message)).filter(m => m.includes('maxmemory'));
            }
            finally {
                warnSpy.mockRestore();
            }
        }

        // in a container, the memory of its machine is the host's rather than the container's limit
        it('warns about a server that sets no maxmemory, whose machine a backup counts the memory of', async () => {
            await dataSource.connection.configSet({ maxmemory: '0', 'maxmemory-policy': 'noeviction' });

            expect(await findMemoryWarnings()).toEqual([expect.stringContaining('sets no maxmemory')]);
        });

        it('warns about a server that evicts keys once it is full, which a staged restore has evict keys of the backup', async () => {
            await withMemoryPolicy('allkeys-lru', async () => {
                expect(await findMemoryWarnings()).toEqual([expect.stringContaining('maxmemory-policy allkeys-lru')]);
            });
        });

        it('warns about nothing once the server sets maxmemory and evicts nothing', async () => {
            expect(await withFreeMemory(64 * 1024 * 1024, async () => await findMemoryWarnings())).toEqual([]);
        });

        it('refuses a staged restore that does not fit into maxmemory, and changes nothing', async () => {
            dataSource.backupMode = 'walk';
            await items.createAll(largeItems());
            const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
            await items.deleteAll({});
            await items.createAll([{ code: 'current' }]);

            await withFreeMemory(1024 * 1024, async () => {
                const refused: unknown = await dataSource.restoreBackup(Readable.from(backup)).catch((error: unknown) => error);
                // what ran out, what it holds, and what to do, with what each gives up
                expect(refused).toBeInstanceOf(Error);
                const message: string = (refused as Error).message;
                expect(message).toContain('ran out of memory while the restore staged the backup');
                expect(message).toContain('Nothing was swapped in, and nothing changed.');
                expect(message).toMatch(/at its maxmemory of \d/);
                expect(message).toContain('Raise maxmemory by');
                expect(message).toContain('restoreMode \'direct\'');
                expect(message).toContain('deleteFirst: true');
            });

            expect(await findCodes()).toEqual(['current']);
            expect(await ValKeyScanUtilities.findKeys(dataSource.connection, `${dataSource.keyPrefix}:zibri.restore:*`)).toEqual([]);
        }, 60000);
    });

    it.each<ValKeyBackupMode>(['snapshot', 'walk'])('restores the items it was taken with, as a %s', async mode => {
        dataSource.backupMode = mode;
        await items.createAll([{ code: 'a' }, { code: 'b' }]);
        const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
        await items.deleteAll({});
        await items.create({ code: 'later' });

        await dataSource.restoreBackup(Readable.from(backup));

        expect(await findCodes()).toEqual(['a', 'b']);
    }, 30000);

    /**
     * Reads a backup, and once it read the row read first of two, moves the unique value of that row to
     * the one read last, which it reads requests later.
     * @param move - How the value is moved.
     * @returns The backup, read to its end, and the rows: the one read first and the one read last.
     */
    async function readMovingUnique(move: (first: StockedItem, last: StockedItem) => Promise<void>): Promise<[unknown[], StockedItem, StockedItem]> {
        // more items than one request reads, so that the first and the last are read requests apart
        const created: StockedItem[] = await items.createAll(Array.from({ length: 600 }, (_, i) => ({ code: `${i}` })));
        // read in the order of their keys, which is the order of their ids
        const [first, ...rest] = [...created].sort((a, b) => a.id < b.id ? -1 : 1);
        const last: StockedItem | undefined = rest.at(-1);
        if (first == undefined || last == undefined) {
            throw new Error('no items were created');
        }
        const reading: AsyncIterator<unknown> = dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve())[Symbol.asyncIterator]();
        const backup: unknown[] = [];
        let moved: boolean = false;
        for (let next: IteratorResult<unknown> = await reading.next(); next.done !== true; next = await reading.next()) {
            backup.push(next.value);
            if (!moved && String(next.value).includes(`:stocked_item:${first.id}"`)) {
                await move(first, last);
                moved = true;
            }
        }
        expect(moved).toBe(true);
        return [backup, first, last];
    }

    // a walk read a row before a transaction moved its unique value to another row, and that row after it:
    // the backup held the value twice, and its restore refused it, as did a start over what it restored
    it('holds a unique value a transaction moved while it was walked as it was when the walk began', async () => {
        dataSource.backupMode = 'walk';
        const [backup, first, last] = await readMovingUnique(async (from, to) => {
            const transaction: Transaction = await dataSource.startTransaction();
            await items.updateById(from.id, { code: 'moved away' }, { transaction });
            await items.updateById(to.id, { code: from.code }, { transaction });
            await transaction.commit();
        });

        await dataSource.restoreBackup(Readable.from(backup));

        expect((await items.findById(first.id)).code).toBe(first.code);
        expect((await items.findById(last.id)).code).toBe(last.code);
    }, 60000);

    // written past the data source, nothing is copied on write: the walk reads the last row as it is then
    it('refuses a walk that read two rows holding one unique value at different moments, written past the data source', async () => {
        dataSource.backupMode = 'walk';
        const rowKey: (id: string) => string = id => `${dataSource.keyPrefix}:stocked_item:${id}`;

        await expect(readMovingUnique(async (from, to) => {
            // as the data source stores a value: json encoded
            await dataSource.connection.hset(rowKey(from.id), { code: JsonUtilities.stringify('moved away') });
            await dataSource.connection.hset(rowKey(to.id), { code: JsonUtilities.stringify(from.code) });
        })).rejects.toThrow(/The backup read the rows \S+ and \S+ of StockedItem at different moments/);
    }, 60000);

    it.each<ValKeyBackupMode>(['snapshot', 'walk'])('holds a transaction committed while it is read whole or not at all, as a %s', async mode => {
        dataSource.backupMode = mode;
        await items.create({ code: 'before' });
        const reading: AsyncIterator<unknown> = dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve())[Symbol.asyncIterator]();
        const first: IteratorResult<unknown> = await reading.next();
        const transaction: Transaction = await dataSource.startTransaction();
        await items.createAll([{ code: 'c' }, { code: 'd' }], { transaction });
        await transaction.commit();
        const rest: unknown[] = [];
        for (let next: IteratorResult<unknown> = await reading.next(); next.done !== true; next = await reading.next()) {
            rest.push(next.value);
        }

        await dataSource.restoreBackup(Readable.from(first.done === true ? rest : [first.value, ...rest]));

        expect(await findCodes()).toEqual(['before']);
    }, 30000);

    it.each<ValKeyBackupMode>(['snapshot', 'walk'])(
        'brings every item and its unique back in line with each other on a restore, as a %s',
        async mode => {
            dataSource.backupMode = mode;
            const unlisted: StockedItem = await items.create({ code: 'a' });
            const gone: StockedItem = await items.create({ code: 'b' });
            // what a walk can see when a commit lands between two of its reads: a row whose id is not
            // listed yet, and a unique entry whose row is not there
            const prefix: string = `${dataSource.keyPrefix}:stocked_item`;
            await dataSource.connection.srem(`${prefix}:ids`, [unlisted.id]);
            await dataSource.connection.del([`${prefix}:${gone.id}`]);
            const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));

            await dataSource.restoreBackup(Readable.from(backup));

            expect(await findCodes()).toEqual(['a']);
            await expect(items.create({ code: 'b' })).resolves.toBeDefined();
        },
        30000
    );

    it.each<ValKeyBackupMode>(['snapshot', 'walk'])(
        'leaves out what a restore stopped part way left staged, and a restore leaves it out of what it swaps in, as a %s',
        async mode => {
            dataSource.backupMode = mode;
            await items.create({ code: 'a' });
            const prefix: string = `${dataSource.keyPrefix}:stocked_item`;
            const leftOver: string = `${dataSource.keyPrefix}:zibri.restore:stopped:${prefix}:left-over`;
            await dataSource.connection.set(leftOver, 'staged');
            try {
                const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));

                expect(backup.map(String).filter(line => line.includes('zibri.restore'))).toEqual([]);
                await dataSource.restoreBackup(Readable.from(backup));
                expect(await findCodes()).toEqual(['a']);
                expect(await dataSource.connection.get(`${prefix}:left-over`)).toBeNull();
            }
            finally {
                await dataSource.connection.del([leftOver]);
            }
        },
        30000
    );

    // the copies of a snapshot are named under its run, and were read in their own order, another one each
    // time: nothing of a store that did not change deduplicated
    it.each<ValKeyBackupMode>(['snapshot', 'walk'])('writes the keys of a store that did not change in the same order each time, as a %s', async mode => {
        dataSource.backupMode = mode;
        await items.createAll(Array.from({ length: 600 }, (_, i) => ({ code: `${i}` })));
        const keysOf: (backup: unknown[]) => string[] = backup => backup.join('').split('\n')
            .filter(line => line.includes(':stocked_item:'))
            .map(line => JsonUtilities.parse<{ key: string }>(line).key);

        const first: string[] = keysOf(await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve())));
        const second: string[] = keysOf(await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve())));

        expect(first.length).toBeGreaterThan(600);
        expect(second).toEqual(first);
    }, 60000);

    it.each<ValKeyBackupMode>(['snapshot', 'walk'])('holds a key deleted while it is read, which the stored keys no longer lead to, as a %s', async mode => {
        dataSource.backupMode = mode;
        // more keys than one request reads, so that most are read after the delete
        await items.createAll(Array.from({ length: 600 }, (_, i) => ({ code: `${i}` })));
        const reading: AsyncIterator<unknown> = dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve())[Symbol.asyncIterator]();
        const backup: unknown[] = [];
        const first: IteratorResult<unknown> = await reading.next();
        if (first.done !== true) {
            backup.push(first.value);
        }
        await items.deleteAll({});
        for (let next: IteratorResult<unknown> = await reading.next(); next.done !== true; next = await reading.next()) {
            backup.push(next.value);
        }

        await dataSource.restoreBackup(Readable.from(backup));

        expect(await findCodes()).toHaveLength(600);
    }, 60000);

    it('leaves no copy behind once a snapshot is read, or when it is stopped part way', async () => {
        dataSource.backupMode = 'snapshot';
        // more keys than one request reads, so that copies are left once the first one was read
        await items.createAll(Array.from({ length: 600 }, (_, i) => ({ code: `${i}` })));

        await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
        expect(await findSnapshotCopies()).toEqual([]);

        const stopped: Readable = dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve());
        await stopped[Symbol.asyncIterator]().next();
        expect((await findSnapshotCopies()).length).toBeGreaterThan(0);
        stopped.destroy();
        await once(stopped, 'close');
        expect(await findSnapshotCopies()).toEqual([]);
    }, 30000);

    it('leaves no copy behind, and no write copying for it, once a walk is read or stopped part way', async () => {
        dataSource.backupMode = 'walk';
        // more keys than one request reads, so that a write lands while the walk is part way
        const created: StockedItem[] = await items.createAll(Array.from({ length: 600 }, (_, i) => ({ code: `${i}` })));
        const runsKey: string = `${dataSource.keyPrefix}:zibri.aside:copy-on-write`;

        const stopped: Readable = dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve());
        await stopped[Symbol.asyncIterator]().next();
        // copied on write for the walk, part way
        await items.updateById(created[0]?.id ?? '', { code: 'written while walked' });
        expect((await findSnapshotCopies()).length).toBeGreaterThan(0);
        stopped.destroy();
        await once(stopped, 'close');
        expect(await findSnapshotCopies()).toEqual([]);
        expect(await dataSource.connection.scard(runsKey)).toBe(0);

        await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
        await items.updateById(created[1]?.id ?? '', { code: 'written after the walk' });
        expect(await findSnapshotCopies()).toEqual([]);
        expect(await dataSource.connection.scard(runsKey)).toBe(0);
    }, 30000);

    // what a run held aside stayed on the server for good when its process died part way, its copies
    // of every key among it
    describe('what a run whose process died held aside', () => {
        /**
         * Leaves keys aside as a run that died does: listed, with no heartbeat, or with one when alive.
         * @param segment - Where the run held them, the copies of a snapshot or the staging of a restore.
         * @param alive - Whether its heartbeat still beats.
         * @returns The key it left.
         */
        async function leaveAside(segment: 'zibri.backup' | 'zibri.restore', alive: boolean): Promise<string> {
            const runId: string = UUIDUtilities.generate();
            const left: string = `${dataSource.keyPrefix}:${segment}:${runId}:${dataSource.keyPrefix}:stocked_item:left`;
            await dataSource.connection.set(left, 'held aside');
            await dataSource.connection.sadd(`${dataSource.keyPrefix}:zibri.aside:runs`, [runId]);
            if (alive) {
                await dataSource.connection.set(`${dataSource.keyPrefix}:zibri.aside:run:${runId}`, runId);
            }
            return left;
        }

        it.each<'zibri.backup' | 'zibri.restore'>(['zibri.backup', 'zibri.restore'])(
            'deletes what one held as %s at the next snapshot, and leaves what a live one holds',
            async segment => {
                dataSource.backupMode = 'snapshot';
                await items.create({ code: 'a' });
                const dead: string = await leaveAside(segment, false);
                const live: string = await leaveAside(segment, true);

                await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));

                expect(await dataSource.connection.exists([dead])).toBe(0);
                expect(await dataSource.connection.exists([live])).toBe(1);
                await dataSource.connection.del([live]);
            },
            30000
        );

        // listed still, the walk that died had every write copy for it for good
        it('stops writes copying for a walk that died, at the next walk', async () => {
            dataSource.backupMode = 'walk';
            const item: StockedItem = await items.create({ code: 'a' });
            const runId: string = UUIDUtilities.generate();
            const runsKey: string = `${dataSource.keyPrefix}:zibri.aside:copy-on-write`;
            // listed, with no heartbeat, and what a write copied for it while it was alive
            await dataSource.connection.sadd(`${dataSource.keyPrefix}:zibri.aside:runs`, [runId]);
            await dataSource.connection.sadd(runsKey, [runId]);
            // listed among what the run made, in the same script, as every write makes a copy
            const copy: string = `${dataSource.keyPrefix}:zibri.backup:${runId}:value:${dataSource.keyPrefix}:stocked_item:${item.id}`;
            await dataSource.connection.set(copy, 'copied');
            await dataSource.connection.sadd(ValKeyCopyOnWriteUtilities.getCopiesKey(dataSource.keyPrefix, runId), [copy]);

            await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
            await items.updateById(item.id, { code: 'written after' });

            expect(await dataSource.connection.sismember(runsKey, runId)).toBe(false);
            expect(await ValKeyScanUtilities.findKeys(dataSource.connection, `${dataSource.keyPrefix}:zibri.backup:${runId}:*`)).toEqual([]);
        }, 30000);

        // until the next run swept it, every write copied for it, which the server held for good under
        // noeviction and failed every write for once it ran out of memory
        it('has no write copy for a walk that died while it is listed still, and every write copy for one alive', async () => {
            const item: StockedItem = await items.create({ code: 'a' });
            const runsKey: string = `${dataSource.keyPrefix}:zibri.aside:copy-on-write`;
            const dead: string = UUIDUtilities.generate();
            const live: string = UUIDUtilities.generate();
            const liveHeartbeat: string = `${dataSource.keyPrefix}:zibri.aside:run:${live}`;
            const findCopiesOf: (runId: string) => Promise<string[]> = async runId => await ValKeyScanUtilities.findKeys(
                dataSource.connection,
                `${dataSource.keyPrefix}:zibri.backup:${runId}:*`
            );
            await dataSource.connection.sadd(runsKey, [dead, live]);
            await dataSource.connection.set(liveHeartbeat, live);
            try {
                await items.updateById(item.id, { code: 'written while listed' });

                expect(await findCopiesOf(dead)).toEqual([]);
                expect(await findCopiesOf(live)).not.toEqual([]);
            }
            finally {
                await dataSource.connection.srem(runsKey, [dead, live]);
                await dataSource.connection.del([liveHeartbeat, ...await findCopiesOf(live)]);
            }
        }, 30000);

        it('deletes what one held at the next restore', async () => {
            await items.create({ code: 'a' });
            const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
            const dead: string = await leaveAside('zibri.restore', false);

            await dataSource.restoreBackup(Readable.from(backup));

            expect(await dataSource.connection.exists([dead])).toBe(0);
            expect(await findCodes()).toEqual(['a']);
        }, 30000);

        it('refuses a restore whose heartbeat lapsed while it staged, and swaps nothing in', async () => {
            await items.create({ code: 'a' });
            const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
            await items.deleteAll({});
            await items.create({ code: 'kept' });
            const heartbeats: string = `${dataSource.keyPrefix}:zibri.aside:run:*`;
            // what a process stalled past the heartbeat's life looks like to the server: the heartbeat
            // gone while the restore goes on staging
            const lapsing: Readable = Readable.from((async function* lapse(): AsyncGenerator<unknown> {
                for (const key of await ValKeyScanUtilities.findKeys(dataSource.connection, heartbeats)) {
                    await dataSource.connection.del([key]);
                }
                yield* backup;
            })());

            await expect(dataSource.restoreBackup(lapsing)).rejects.toThrow('lapsed');

            expect(await findCodes()).toEqual(['kept']);
            expect(await ValKeyScanUtilities.findKeys(dataSource.connection, `${dataSource.keyPrefix}:zibri.restore:*`)).toEqual([]);
        }, 30000);
    });

    // a set held whole three times over, as its dump, its base64 and its line: about 12 MiB for the ids of a
    // table of 100 000 rows, 120 MiB at a million
    describe('a set too large to be read whole', () => {
        /**
         * A set of more members than a backup reads whole, under the data source's prefix and no entity's.
         * @param members - How many members it holds.
         * @returns Its key and its members.
         */
        async function createLargeSet(members: number = 1500): Promise<[string, string[]]> {
            const key: string = `${dataSource.keyPrefix}:large-set`;
            const values: string[] = Array.from({ length: members }, (_, i) => `member-${i}-`.padEnd(200, 'x'));
            await dataSource.connection.del([key]);
            // a page at a time: the server counts the buffer it read a request into as used until it trims it a while
            // later, so one request of the whole set had what a case measured as free grow by the size of the set
            // once trimmed, and a copy the case leaves no room for fit after all
            for (let i: number = 0; i < values.length; i += 100) {
                await dataSource.connection.sadd(key, values.slice(i, i + 100));
            }
            return [key, values];
        }

        afterEach(async () => {
            // so that what the cases after these copy and count holds no more than they make
            await dataSource.connection.del([`${dataSource.keyPrefix}:large-set`]);
        });

        async function findMembers(key: string): Promise<string[]> {
            return [...await dataSource.connection.smembers(key)].map(String).sort();
        }

        /**
         * The lines of a backup that hold the given key.
         * @param backup - The backup.
         * @param key - The key.
         * @returns The lines, parsed.
         */
        function findLines(backup: unknown[], key: string): Record<string, unknown>[] {
            return backup.join('').split('\n')
                .filter(line => line.trim())
                .map(line => JsonUtilities.parse<Record<string, unknown>>(line))
                .filter(entry => entry['key'] === key);
        }

        it.each<ValKeyBackupMode>(['snapshot', 'walk'])('reads it a page at a time and restores it whole, as a %s', async mode => {
            dataSource.backupMode = mode;
            const [key, values] = await createLargeSet();
            await items.createAll(Array.from({ length: 1500 }, (_, i) => ({ code: `${i}` })));

            const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
            await dataSource.connection.del([key]);
            await items.deleteAll({});
            await dataSource.restoreBackup(Readable.from(backup));

            const lines: Record<string, unknown>[] = findLines(backup, key);
            expect(lines.length).toBeGreaterThan(1);
            expect(lines.every(line => line['kind'] === 'set-members' && !('payload' in line))).toBe(true);
            // the ids of the table are such a set, which the items read back through
            expect(findLines(backup, `${dataSource.keyPrefix}:stocked_item:ids`).every(line => line['kind'] === 'set-members')).toBe(true);
            expect(await findMembers(key)).toEqual([...values].sort());
            expect(await findCodes()).toHaveLength(1500);
            expect(await findSnapshotCopies()).toEqual([]);
        }, 60000);

        it.each<ValKeyBackupMode>(['snapshot', 'walk'])('keeps the time it has left to live, as a %s', async mode => {
            dataSource.backupMode = mode;
            const [key] = await createLargeSet();
            await dataSource.connection.pexpire(key, 60_000);

            const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
            await dataSource.connection.del([key]);
            await dataSource.restoreBackup(Readable.from(backup));

            const ttlMs: number = await dataSource.connection.pttl(key);
            expect(ttlMs).toBeGreaterThan(0);
            expect(ttlMs).toBeLessThanOrEqual(60_000);
        }, 60000);

        // read in pages while it is written, a set would be none of the values it ever held: a walk reads it
        // from a copy of it alone, a snapshot from its copy of every key
        it.each<ValKeyBackupMode>(['snapshot', 'walk'])('reads it as one value, however it is written while its pages are read, as a %s', async mode => {
            dataSource.backupMode = mode;
            const [key, values] = await createLargeSet();
            const reading: AsyncIterator<unknown> = dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve())[Symbol.asyncIterator]();
            const backup: unknown[] = [];
            let written: boolean = false;
            for (let next: IteratorResult<unknown> = await reading.next(); next.done !== true; next = await reading.next()) {
                backup.push(next.value);
                if (!written && findLines([next.value], key).length) {
                    // after its first page: a member added and one removed
                    await dataSource.connection.sadd(key, ['written-while-read']);
                    await dataSource.connection.srem(key, [values[values.length - 1] ?? '']);
                    written = true;
                }
            }

            await dataSource.restoreBackup(Readable.from(backup));

            expect(written).toBe(true);
            expect(await findMembers(key)).toEqual([...values].sort());
        }, 60000);

        // a copy of the ids of a large table on the first save to it would stall the server, and could have it
        // evict the application's keys for the copy
        it('reads the ids of a table as they were when a walk began, noting only the ids written since', async () => {
            dataSource.backupMode = 'walk';
            const created: StockedItem[] = await items.createAll(Array.from({ length: 1500 }, (_, i) => ({ code: `${i}` })));
            const reading: AsyncIterator<unknown> = dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve())[Symbol.asyncIterator]();
            const backup: unknown[] = [];
            const first: IteratorResult<unknown> = await reading.next();
            backup.push(first.value);
            await items.create({ code: 'created since' });
            await items.deleteById(created[0]?.id ?? '');
            // not vacuous: a write since, and the ids not copied for it
            const held: string[] = await findSnapshotCopies();
            expect(held.some(key => key.includes(':added:'))).toBe(true);
            expect(held.filter(key => key.includes(':value:') && key.endsWith(':ids'))).toEqual([]);
            for (let next: IteratorResult<unknown> = await reading.next(); next.done !== true; next = await reading.next()) {
                backup.push(next.value);
            }

            await items.deleteAll({});
            await dataSource.restoreBackup(Readable.from(backup));

            expect(await findCodes()).toEqual(Array.from({ length: 1500 }, (_, i) => `${i}`).sort());
            expect(await findSnapshotCopies()).toEqual([]);
        }, 60000);

        it('lets a write of it whole go on when the server has no room for its copy, and fails the walk instead', async () => {
            dataSource.backupMode = 'walk';
            const [key] = await createLargeSet(MEMBERS_WITHOUT_ROOM);
            // keys the walk reads after the set, so that it reads on once the write could not be held for it
            await items.createAll(Array.from({ length: 1500 }, (_, i) => ({ code: `${i}` })));
            const reading: AsyncIterator<unknown> = dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve())[Symbol.asyncIterator]();
            await reading.next();

            await withFreeMemory(64 * 1024, async () => {
                expect(await applyGuardedValKeyWrites(dataSource.connection, dataSource.keyPrefix, { values: new Map(), hashes: new Map() }, [{ type: 'delete', key }]))
                    .toBe(true);
            });

            expect(await dataSource.connection.exists([key])).toBe(0);
            await expect((async () => {
                for (let next: IteratorResult<unknown> = await reading.next(); next.done !== true; next = await reading.next()) {
                    // read to the end, or to the refusal
                }
            })()).rejects.toThrow(`could not hold the set "${key}"`);
            expect(await findSnapshotCopies()).toEqual([]);
        }, 60000);

        it('restores a backup holding it whole, as backups were taken before sets were read in pages', async () => {
            const [key, values] = await createLargeSet();
            const payload: Uint8Array | null = await dataSource.connection.dump(key);
            if (payload == null) {
                throw new Error('the set was not dumped');
            }
            const line: string = `${JsonUtilities.stringify({ key, ttlMs: 0, payload: Buffer.from(payload).toString('base64') })}\n`;
            await dataSource.connection.del([key]);

            await dataSource.restoreBackup(Readable.from([line]));

            expect(await findMembers(key)).toEqual([...values].sort());
        }, 60000);

        it('changes nothing and leaves nothing staged when a restore fails after some of its pages', async () => {
            dataSource.backupMode = 'walk';
            const [key, values] = await createLargeSet();
            const backup: unknown[] = await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()));
            await dataSource.connection.del([key]);
            await dataSource.connection.sadd(key, ['held now']);

            await expect(dataSource.restoreBackup(Readable.from([...backup, 'not a line of a backup\n']))).rejects.toThrow();

            expect(await findMembers(key)).toEqual(['held now']);
            expect(values.length).toBe(1500);
            expect(await ValKeyScanUtilities.findKeys(dataSource.connection, `${dataSource.keyPrefix}:zibri.restore:*`)).toEqual([]);
        }, 60000);

        // under an eviction policy, the copy would have the server evict the application's own keys for it
        it('refuses to walk it when the server has no room for its copy, and leaves no copy', async () => {
            dataSource.backupMode = 'walk';
            await createLargeSet(MEMBERS_WITHOUT_ROOM);

            await withFreeMemory(64 * 1024, async () => {
                await expect(readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()))).rejects.toThrow(/Valkey needs to have \d+ MiB free for the copy/);
            });

            expect(await findSnapshotCopies()).toEqual([]);
        }, 60000);
    });

    // under an eviction policy, copies past the limit would have the server evict the application's
    // own keys for them, and without one fail the writes of every instance until they are read
    describe('with little memory left on the server', () => {
        it('takes a snapshot when the server has the room for a copy of the keys', async () => {
            dataSource.backupMode = 'snapshot';
            await items.createAll(largeItems());

            const backup: unknown[] = await withFreeMemory(64 * 1024 * 1024, async () => await readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve())));
            await items.deleteAll({});
            await dataSource.restoreBackup(Readable.from(backup));

            expect(await findCodes()).toHaveLength(LARGE_ITEMS);
        }, 60000);

        it('refuses a snapshot when the server has no room for a copy of the keys, and copies nothing', async () => {
            dataSource.backupMode = 'snapshot';
            await items.createAll(largeItems());

            await withFreeMemory(1024 * 1024, async () => {
                await expect(readBackup(dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve()))).rejects.toThrow(/Valkey needs to have \d+ MiB free to copy the keys into/);
            });

            expect(await findSnapshotCopies()).toEqual([]);
            expect(await findCodes()).toHaveLength(LARGE_ITEMS);
        }, 60000);
    });
});

/**
 * Items of about 8 KiB each, some 8 MiB in all: well beyond the memory the refusing case leaves free.
 * @returns The items to create.
 */
function largeItems(): Pick<StockedItem, 'code'>[] {
    return Array.from({ length: LARGE_ITEMS }, (_, i) => ({ code: `${i}-`.padEnd(8 * 1024, 'x') }));
}

/**
 * The copies of every snapshot still held on the server.
 * @returns Their keys.
 */
async function findSnapshotCopies(): Promise<string[]> {
    return await ValKeyScanUtilities.findKeys(dataSource.connection, `${dataSource.keyPrefix}:zibri.backup:*`);
}

/**
 * Runs the given work with the server limited to the memory it uses now and the given bytes more.
 *
 * The server is this suite's own, so no other suite writes to it meanwhile. `noeviction` rather than
 * a policy that evicts, so that a write of the application running beside the work is refused rather
 * than taking any of the suite's keys with it.
 * @param freeBytes - The bytes it may use beyond what it uses now.
 * @param work - The work.
 * @returns What the work returned.
 */
async function withFreeMemory<T>(freeBytes: number, work: () => Promise<T>): Promise<T> {
    const info: string = await dataSource.connection.info([valKeyGlide().InfoOptions.Memory]);
    const used: number = Number(/^used_memory:(\d+)\s*$/m.exec(info)?.[1]);
    await dataSource.connection.configSet({ maxmemory: `${used + freeBytes}`, 'maxmemory-policy': 'noeviction' });
    try {
        return await work();
    }
    finally {
        await dataSource.connection.configSet({ maxmemory: '0' });
    }
}

/**
 * Runs the given work with the server limited, far beyond what it uses, under the given policy.
 * @param policy - The `maxmemory-policy`.
 * @param work - The work.
 * @returns What the work returned.
 */
async function withMemoryPolicy<T>(policy: string, work: () => Promise<T>): Promise<T> {
    await dataSource.connection.configSet({ maxmemory: `${1024 * 1024 * 1024}`, 'maxmemory-policy': policy });
    try {
        return await work();
    }
    finally {
        await dataSource.connection.configSet({ maxmemory: '0', 'maxmemory-policy': 'noeviction' });
    }
}