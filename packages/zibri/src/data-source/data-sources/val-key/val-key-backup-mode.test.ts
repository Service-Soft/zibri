import { Readable } from 'node:stream';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { ValKeyBackupMode } from './val-key-backup-mode.model';
import { ValKeyDataSource, ValKeyOptions } from './val-key-data-source.model';
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
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ChainAnchor } from '../../chain/chain-anchor.model';
import { DataSource } from '../../decorators/data-source.decorator';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Repository } from '../../repository/repository';
import { RepositoryClass } from '../../repository/repository-class.type';
import { Transaction } from '../../transaction/transaction.model';

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
        await items.deleteAll({});
    }, 30000);

    it('refuses to start a backed up data source that does not say how it is backed up', () => {
        dataSource.backupMode = undefined;
        try {
            expect(() => dataSource.validateBackupConfiguration()).toThrow(
                'Invalid data source marked with @Backup: backupMode is not set.'
            );
        }
        finally {
            dataSource.backupMode = 'snapshot';
        }
    });

    it.each<ValKeyBackupMode>(['snapshot', 'walk'])('restores the items it was taken with, as a %s', async mode => {
        dataSource.backupMode = mode;
        await items.createAll([{ code: 'a' }, { code: 'b' }]);
        const backup: unknown[] = await readBackup(dataSource.createBackupData());
        await items.deleteAll({});
        await items.create({ code: 'later' });

        await dataSource.restoreBackup(Readable.from(backup));

        expect(await findCodes()).toEqual(['a', 'b']);
    }, 30000);

    it('holds a transaction committed while it is read whole or not at all, as a snapshot', async () => {
        dataSource.backupMode = 'snapshot';
        await items.create({ code: 'before' });
        const reading: AsyncIterator<unknown> = dataSource.createBackupData()[Symbol.asyncIterator]();
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
            const backup: unknown[] = await readBackup(dataSource.createBackupData());

            await dataSource.restoreBackup(Readable.from(backup));

            expect(await findCodes()).toEqual(['a']);
            await expect(items.create({ code: 'b' })).resolves.toBeDefined();
        },
        30000
    );
});