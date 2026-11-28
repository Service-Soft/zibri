import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { compileTsxTemplate } from '../../__testing__/compile-tsx-template.function';
import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { queryPostgres } from '../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { TestServerInvitationRepository } from '../../__testing__/test-server/invitation-repository';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { AuditEntry } from '../../audit/audit-entry.model';
import { InvitationEmailTemplate } from '../../auth/invitation/invitation-email-template.model';
import { InvitationOptions } from '../../auth/invitation/invitation-options.model';
import { LoginTicket } from '../../auth/models/login-ticket.model';
import { JwtRefreshToken } from '../../auth/strategies/jwt/jwt-refresh-token.model';
import { BackupEntity } from '../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../backup/backup-resource-entity.model';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Email } from '../../email/models/email.model';
import { GlobalRegistry } from '../../global/global-registry';
import { Log } from '../../logging/log.model';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { Transaction } from '../transaction/transaction.model';
import { MigratedEntityUtilities } from './migrated-entity.utilities';
import { MigrationEntity } from './migration-entity.model';
import { Migration } from './migration.model';

const LOGS: string = MigratedEntityUtilities.resolveTableName(Log);
const RESOURCES: string = MigratedEntityUtilities.resolveTableName(BackupResourceEntity);
const EMAILS: string = MigratedEntityUtilities.resolveTableName(Email);
const USERS: string = MigratedEntityUtilities.resolveTableName(JwtUser);
const INVITATIONS: string = MigratedEntityUtilities.resolveTableName(TestInvitation);
const REFRESH_TOKENS: string = MigratedEntityUtilities.resolveTableName(JwtRefreshToken);
const LOGIN_TICKETS: string = MigratedEntityUtilities.resolveTableName(LoginTicket);
const AUDIT_ENTRIES: string = MigratedEntityUtilities.resolveTableName(AuditEntry);

/**
 * The migrations of an application of 3.0: every table as 3.0 stored it, without the columns the framework added
 * since, and a log written before the upgrade.
 */
@Injectable()
class SchemaOfThreeMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(getDataSourceClass());
    }

    override async up(transaction: Transaction): Promise<void> {
        // the migration table is the one the data source creates itself, before any migration runs
        // the invitations as 3.2 stored them, the first release with them
        for (const entity of [...defaultTestServerEntities.filter(e => e !== MigrationEntity), BackupEntity, BackupResourceEntity, TestInvitation]) {
            await this.dataSource.createEntity({ entity, properties: 'resolveFromEntity', transaction });
        }
        await this.dataSource.removePropertyFromEntity({ entity: JwtUser, propertyKey: 'locale', transaction });
        await this.dataSource.removePropertyFromEntity({ entity: JwtUser, propertyKey: 'kind', transaction });
        for (const propertyKey of ['userKind', 'approvalRequestId']) {
            await this.dataSource.removePropertyFromEntity({ entity: AuditEntry, propertyKey, transaction });
        }
        await this.dataSource.removePropertyFromEntity({ entity: TestInvitation, propertyKey: 'locale', transaction });
        await this.dataSource.removePropertyFromEntity({ entity: Log, propertyKey: 'application', transaction });
        for (const propertyKey of ['stagedSize', 'baseBackupId', 'readCursor']) {
            await this.dataSource.removePropertyFromEntity({ entity: BackupResourceEntity, propertyKey, transaction });
        }
        await this.dataSource.removePropertyFromEntity({ entity: Email, propertyKey: 'replyTo', transaction });
        await this.dataSource.removePropertyFromEntity({ entity: TestInvitation, propertyKey: 'withoutPassword', transaction });
        await this.dataSource.removePropertyFromEntity({ entity: JwtRefreshToken, propertyKey: 'countsAsRecentLogin', transaction });
        for (const propertyKey of ['excludedTwoFactorMethods', 'countsAsRecentLogin']) {
            await this.dataSource.removePropertyFromEntity({ entity: LoginTicket, propertyKey, transaction });
        }
        const dataSource: PostgresDataSource = inject(getDataSourceClass());
        await queryPostgres(
            dataSource,
            `INSERT INTO "${LOGS}" ("level", "message", "context", "createdAt", "cleanupAt") VALUES (2, 'written by 3.0', '{}', now(), now() + interval '1 day')`,
            [],
            transaction
        );
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('Not needed for this test.');
    }
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, BackupEntity, BackupResourceEntity, TestInvitation],
    repositories: [...defaultTestServerRepositories, TestServerInvitationRepository],
    schemaManagement: 'migrations',
    migrations: [SchemaOfThreeMigration]
});

/**
 * The data source the migration runs in. Read through a function, because the data source names the
 * migration and so is built after it.
 * @returns The data source.
 */
function getDataSourceClass(): Newable<PostgresDataSource> {
    return dataSourceClass;
}

// a column the framework added to an entity of its own took a migration of every application managing its schema by
// migrations, which the upgrade from 3.0 did not tell it about
describe('a data source whose migrations manage the schema, migrated as 3.0 stored it', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        // listed for the columns of its table, which a listed invitation repository sends invitations for
        const invitationOptions: InvitationOptions = {
            acceptInvitationUrl: 'https://app.example.com/invitation',
            invitationEmail: compileTsxTemplate<InvitationEmailTemplate>('export const Email = ({ link }) => <a href={link}>Welcome</a>;'),
            tokenExpiresInMs: 60000,
            onExpiredToken: 'refuse'
        };
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.INVITATION_OPTIONS, useValue: invitationOptions })]
        });
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

    /**
     * The columns of a table, as postgres lists them.
     * @param table - The table.
     * @returns The name and the default of each.
     */
    async function findColumns(table: string): Promise<Record<string, unknown>[]> {
        return await queryPostgres(
            inject(dataSourceClass),
            'SELECT column_name AS "name", column_default AS "default" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
            [table]
        );
    }

    it('adds the columns the framework added since, without a migration of the application', async () => {
        const logColumns: string[] = (await findColumns(LOGS)).map(c => String(c['name']));
        const resourceColumns: string[] = (await findColumns(RESOURCES)).map(c => String(c['name']));

        expect(logColumns).toContain('application');
        expect(resourceColumns).toEqual(expect.arrayContaining(['stagedSize', 'baseBackupId', 'readCursor']));
        expect((await findColumns(EMAILS)).map(c => String(c['name']))).toContain('replyTo');
        // of the classes the application extends from a factory of the framework, whose tables are its own
        expect((await findColumns(USERS)).map(c => String(c['name']))).toEqual(expect.arrayContaining(['locale', 'kind']));
        expect((await findColumns(AUDIT_ENTRIES)).map(c => String(c['name']))).toEqual(expect.arrayContaining(['userKind', 'approvalRequestId']));
        expect((await findColumns(INVITATIONS)).map(c => String(c['name']))).toEqual(expect.arrayContaining(['locale', 'withoutPassword']));
        expect((await findColumns(REFRESH_TOKENS)).map(c => String(c['name']))).toContain('countsAsRecentLogin');
        expect((await findColumns(LOGIN_TICKETS)).map(c => String(c['name'])))
            .toEqual(expect.arrayContaining(['excludedTwoFactorMethods', 'countsAsRecentLogin']));
    });

    it('gives the logs stored before the name of the application, and leaves the column without a default', async () => {
        const rows: Record<string, unknown>[] = await queryPostgres(
            inject(dataSourceClass),
            `SELECT "application" FROM "${LOGS}" WHERE "message" = 'written by 3.0'`
        );
        const application: Record<string, unknown> | undefined = (await findColumns(LOGS)).find(c => c['name'] === 'application');

        expect(rows).toEqual([{ application: GlobalRegistry.getAppData('name') }]);
        expect(application?.['default']).toBeNull();
    });

    it('adds nothing on the next start, which finds the columns there', async () => {
        await server?.reInit();

        expect(server?.bootLog.join('\n')).not.toContain('adds what the framework added to its entities');
    }, TestTimeouts.postgres.start);
});