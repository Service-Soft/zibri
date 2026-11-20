import { afterAll, beforeAll } from '@jest/globals';

import { testFileFolder, TestTimeouts } from '../../../__testing__/constants';
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
import { BackupEntity } from '../../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../../backup/backup-resource-entity.model';
import { describeKeysAcrossRestore, RestoredSecret } from '../../../backup/backup-service.encryption-keys.cases';
import { Backup } from '../../../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../../../backup/decorators/backup-transport.decorator';
import { FsBackupTransport } from '../../../backup/transports/fs.backup-transport';
import { CacheInvalidation } from '../../../caching/cache-invalidation.model';
import { Email } from '../../../email/models/email.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { EventSubscriberRegistration } from '../../../event/event-subscriber-registration.model';
import { EventSubscriberRun } from '../../../event/event-subscriber-run.model';
import { Event } from '../../../event/event.model';
import { Lease } from '../../../leases/lease.model';
import { Log } from '../../../logging/log.model';
import { Newable } from '../../../types/newable.type';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ChainAnchor } from '../../chain/chain-anchor.model';
import { DataSource } from '../../decorators/data-source.decorator';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { RepositoryClass } from '../../repository/repository-class.type';
import { ValKeyBackupMode } from './val-key-backup-mode.model';
import { ValKeyDataSource, ValKeyOptions } from './val-key-data-source.model';
import { ValKeyRestoreMode } from './val-key-restore-mode.model';

/**
 * The keys across a restore of valkey, whose uniques are kept beside the rows.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `val-key-restore-encryption-keys-${UUIDUtilities.generate()}`);

// once for the suite rather than per instance: a restart builds the data source anew, which reads under
// the prefix it was given, and a prefix of its own would find nothing stored
const keyPrefix: string = `test-${UUIDUtilities.generate()}`;

@BackupTransport()
class KeysValKeyTransport extends FsBackupTransport {
    constructor() {
        super('keys-val-key-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [KeysValKeyTransport], encrypt: true })
class KeysValKeyDataSource extends ValKeyDataSource {
    override readonly backupMode: ValKeyBackupMode = 'walk';
    override readonly restoreMode: ValKeyRestoreMode = 'staged';
    override options: ValKeyOptions = {
        host: 'localhost',
        // the container serves no tls
        useTLS: false,
        keyPrefix
    };
    // what the backups of valkey boot with elsewhere, and the secret
    entities: Newable<BaseEntity>[] = [
        MigrationEntity,
        RestoredSecret,
        BackupEntity,
        BackupResourceEntity,
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

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [KeysValKeyDataSource] });
}, TestTimeouts.valKey.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.valKey.shutdown);

describeKeysAcrossRestore('valkey', () => server);