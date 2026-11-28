/* eslint-disable cspell/spellchecker */
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { RecordingEmailTransport } from 'zibri-testing';

import { compileTsxTemplate } from '../../../__testing__/compile-tsx-template.function';
import { TestTimeouts } from '../../../__testing__/constants';
import { companyInfoProvider } from '../../../__testing__/mocks/company-info-provider.function';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { TestInvitation } from '../../../__testing__/mocks/entities/test-invitation.entity';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { TestServerInvitationRepository } from '../../../__testing__/test-server/invitation-repository';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { AuditEntry } from '../../../audit/audit-entry.model';
import { OtpTwoFactorMethod } from '../../../auth/2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../../auth/auth-controller/auth-controller.model';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../../auth/authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../../../auth/authenticators/password/password.authenticator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { InvitationEmailTemplate } from '../../../auth/invitation/invitation-email-template.model';
import { InvitationOptions } from '../../../auth/invitation/invitation-options.model';
import { LoginTicket } from '../../../auth/models/login-ticket.model';
import { ApiKeyAuthStrategy } from '../../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../../auth/strategies/api-key/api-key.model';
import { CreatedApiKey } from '../../../auth/strategies/api-key/created-api-key.model';
import { JwtRefreshToken } from '../../../auth/strategies/jwt/jwt-refresh-token.model';
import { JwtAuthStrategy } from '../../../auth/strategies/jwt/jwt.auth-strategy';
import { type UserServiceInterface } from '../../../auth/user/user-service.interface';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { EmailConfigInput } from '../../../email/models/email-config.model';
import { Email } from '../../../email/models/email.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { coversEveryRow } from '../../../entity/models/unique-declaration.model';
import { keyGroupsOf } from '../../../global/model-registry/key-descriptor';
import { KnownHeader } from '../../../http/known-header.enum';
import { MimeType } from '../../../http/mime-type.enum';
import { getZonedDate } from '../../../localization/get-zoned-date.function';
import { Logger } from '../../../logging/logger';
import { ZibriInvoicingPlugin } from '../../../plugin/invoicing/invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../../plugin/invoicing/invoicing.tokens';
import { InvoiceAddress } from '../../../plugin/invoicing/models/invoice-address.model';
import { InvoiceRecipientAbbreviation } from '../../../plugin/invoicing/models/invoice-recipient-abbreviation.model';
import { Invoice } from '../../../plugin/invoicing/models/invoice.model';
import { NumberInvoices } from '../../../plugin/invoicing/models/number-invoices.model';
import { InvoiceCancellationServiceInterface } from '../../../plugin/invoicing/services/invoice-cancellation-service.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { Newable } from '../../../types/newable.type';
import { SemVerVersion } from '../../../utilities/sem-ver.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { FrameworkColumnRegistry } from '../../migration/framework-column.registry';
import { FrameworkColumnUtilities } from '../../migration/framework-column.utilities';
import { MigratedEntityUtilities } from '../../migration/migrated-entity.utilities';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Migration } from '../../migration/migration.model';
import { MissingFrameworkColumnError } from '../../migration/missing-framework-column.error';
import { MissingFrameworkColumn } from '../../migration/missing-framework-column.model';
import { MissingUniqueError } from '../../migration/missing-unique.error';
import { Repository } from '../../repository/repository';
import { Transaction } from '../../transaction/transaction.model';
import { uniqueConstraintName } from '../../unique-constraint-name.function';
import { keyWhereToSql } from '../../where/key-where-to-sql.function';
import { PostgresDataSource } from './postgres-data-source.model';

/**
 * An application of 3.2 managing its own schema, with `schemaManagement: 'external'`, starts on this release
 * unchanged: its tables lack the columns 3.3 added, its rows are read and written without them, a feature needing one
 * refuses naming it, and the start warns once with the statements that add them. Once they are added, the features
 * work from the next start.
 */

/**
 * The columns 3.3 added to the entities of this application, which the schema of 3.2 lacks.
 */
const ADDED_IN_THREE_THREE: readonly [Newable<BaseEntity>, string][] = [
    [JwtUser, 'locale'],
    [JwtUser, 'kind'],
    [TestInvitation, 'locale'],
    [TestInvitation, 'withoutPassword'],
    [TestInvitation, 'rowShares'],
    [LoginTicket, 'excludedTwoFactorMethods'],
    [LoginTicket, 'countsAsRecentLogin'],
    [JwtRefreshToken, 'countsAsRecentLogin'],
    [ApiKey, 'userKind'],
    [AuditEntry, 'userKind'],
    [AuditEntry, 'approvalRequestId'],
    [Email, 'replyTo'],
    [Invoice, 'type'],
    [Invoice, 'precedingInvoices'],
    [Invoice, 'issuedAt'],
    [NumberInvoices, 'scope']
];

const ENTITIES: Newable<BaseEntity>[] = [...defaultTestServerEntities, TestInvitation, ApiKey, Invoice, NumberInvoices, InvoiceRecipientAbbreviation];

const PASSWORD: string = 'correct horse battery staple';

const TEAM: string = UUIDUtilities.generate();

const YEAR: number = getZonedDate(new Date(), 'Europe/Berlin').year;

const acme: InvoiceAddress = {
    formOfAddress: '',
    firstName: '',
    lastName: '',
    street: 'Great Street',
    number: '42',
    postcode: '12345',
    city: 'Great City',
    company: true,
    companyName: 'Acme',
    countryId: 'DE'
};

const transport: RecordingEmailTransport = new RecordingEmailTransport();

/**
 * Creates the schema of the application as 3.2 had it, the way whoever manages it outside the application did.
 */
@Injectable()
class SchemaOfThreeTwoMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(getDataSourceClass());
    }

    override async up(transaction: Transaction): Promise<void> {
        // the migration table is the one the data source creates itself, before any migration runs
        for (const entity of ENTITIES.filter(e => e !== MigrationEntity)) {
            await this.dataSource.createEntity({ entity, properties: 'resolveFromEntity', transaction });
        }
        for (const [entity, propertyKey] of ADDED_IN_THREE_THREE) {
            await this.dataSource.removePropertyFromEntity({ entity, propertyKey, transaction });
        }
        // which 3.2 created beside the columns, and a table of a migration gets only once the data source keeps its keys
        for (const entity of ENTITIES.filter(e => e !== MigrationEntity)) {
            await this.createUniquesOfThreeTwo(entity, transaction);
        }
    }

    /**
     * Creates the uniques an entity declares over the columns 3.2 had, under the names the framework gives them.
     * @param entity - The entity.
     * @param transaction - The transaction of the migration.
     */
    private async createUniquesOfThreeTwo(entity: Newable<BaseEntity>, transaction: Transaction): Promise<void> {
        const table: string = MigratedEntityUtilities.resolveTableName(entity);
        const added: Set<string> = new Set(ADDED_IN_THREE_THREE.filter(([e]) => e === entity).map(([, property]) => property));
        for (const unique of keyGroupsOf(entity).uniques.filter(u => !u.properties.some(p => added.has(p)))) {
            const where: string | undefined = unique.where == undefined || coversEveryRow(unique.where) ? undefined : keyWhereToSql(entity, unique.where);
            const name: string = uniqueConstraintName(table, unique.properties, where);
            const columns: string = unique.properties.map(p => `"${p}"`).join(', ');
            await queryPostgres(
                inject(getDataSourceClass()),
                where == undefined
                    ? `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" UNIQUE (${columns})`
                    : `CREATE UNIQUE INDEX "${name}" ON "${table}" (${columns}) WHERE ${where}`,
                [],
                transaction
            );
        }
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('Not needed for this test.');
    }
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: ENTITIES,
    repositories: [...defaultTestServerRepositories, TestServerInvitationRepository],
    schemaManagement: 'external',
    migrations: [SchemaOfThreeTwoMigration]
});

/**
 * The data source, for the migration declared before it.
 * @returns The class.
 */
function getDataSourceClass(): Newable<PostgresDataSource> {
    return dataSourceClass;
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class ExternalSchemaAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        invitationRoutes: true
    }) {}

@Controller('/machine')
class MachineController {
    @Get('/me')
    me(
        @CurrentUser()
        user: CurrentUser<JwtUser>
    ): { id: string } {
        return { id: user.id };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;
const warn: jest.SpiedFunction<Logger['warn']> = jest.spyOn(Logger.prototype, 'warn');

/**
 * The repository of the users.
 * @returns The repository.
 */
function users(): Repository<JwtUser> {
    return inject(repositoryTokenFor(JwtUser));
}

/**
 * Creates a user who logs in with a password, as a sign up does.
 * @returns The user.
 */
async function signUp(): Promise<JwtUser> {
    const user: JwtUser = await users().create({ email: `${UUIDUtilities.generate()}@external.example.com`, roles: [Roles.USER] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ userId: user.id, password: PASSWORD });
    return user;
}

/**
 * Changes the locale of a user through the user service.
 * @param userId - The user.
 * @param locale - The locale.
 */
async function updateLocale(userId: string, locale: 'en-US'): Promise<void> {
    const userService: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    if (userService.updateLocale == undefined) {
        throw new Error('The user service of the test server changes no locale.');
    }
    await userService.updateLocale(userId, locale, undefined);
}

/**
 * Posts to a route.
 * @param path - The route.
 * @param body - The body.
 * @returns The answer.
 */
async function post(path: string, body: object): Promise<Response> {
    return await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JSON.stringify(body)
    });
}

/**
 * The caller an invitation is sent by.
 * @param user - The user.
 * @returns The caller.
 */
function callerOf(user: JwtUser): CurrentUser {
    return { id: user.id, email: user.email, deactivatedAt: user.deactivatedAt, permissions: [], platformPermissions: [] };
}

/**
 * Runs the given work in the team.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTeam<T>(fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(TEAM, fn);
}

/**
 * Creates an invoice of the team with a final number, as an application of 3.2 does.
 * @param number - Its number.
 * @returns The invoice.
 */
async function createInvoice(number: string): Promise<Invoice> {
    return await inTeam(async () => await inject<Repository<Invoice>>(repositoryTokenFor(Invoice)).create({
        number,
        items: [{ name: 'Consulting', amount: 1, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { categoryCode: 'S', rate: 19 }, price: 100 }],
        date: new Date(),
        performanceDate: new Date(),
        dueDate: new Date(),
        customerAddressData: acme,
        textBeforeItems: [],
        textAfterItems: [],
        currency: 'EUR'
    }));
}

/**
 * The statements the start warned with.
 * @returns What was warned, joined.
 */
function warnings(): string {
    return warn.mock.calls.map(call => String(call[0])).join('\n');
}

beforeAll(async () => {
    const invitationOptions: InvitationOptions = {
        acceptInvitationUrl: 'https://app.example.com/invitation',
        invitationEmail: compileTsxTemplate<InvitationEmailTemplate>('export const Email = ({ link }) => <a href={link}>Welcome</a>;'),
        tokenExpiresInMs: 60000,
        onExpiredToken: 'refuse'
    };
    server = await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        controllers: [ExternalSchemaAuthController, MachineController],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            companyInfoProvider(() => ({
                name: 'Example Company',
                fullName: 'Example Company LLC',
                email: 'info@example.com',
                phone: '12345 67890123',
                timezone: 'Europe/Berlin',
                address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' }
            })),
            defineProvider({ token: ZIBRI_DI_TOKENS.INVITATION_OPTIONS, useValue: invitationOptions }),
            defineProvider({
                token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                useFactory: (): EmailConfigInput => ({ maxEmailsPerHour: 1000, defaultSender: 'Ada', failedRetentionInMs: 'forever' })
            }),
            defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.postgres.start);

afterAll(async () => {
    warn.mockRestore();
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

describe('a schema of 3.2 the data source does not manage', () => {
    it('starts, finding exactly the columns 3.3 added, and warns once with the statements that add them', () => {
        const missing: MissingFrameworkColumn[] = ENTITIES.flatMap(entity => FrameworkColumnRegistry.findMissing(
            entity,
            ...ADDED_IN_THREE_THREE.filter(([e]) => e === entity).map(([, property]) => property)
        ));

        expect(missing.map(c => [c.entity, c.property])).toEqual(expect.arrayContaining([...ADDED_IN_THREE_THREE]));
        expect(missing).toHaveLength(ADDED_IN_THREE_THREE.length);
        const warned: string = warnings();
        for (const [entity, property] of ADDED_IN_THREE_THREE) {
            expect(warned).toContain(`ALTER TABLE "${MigratedEntityUtilities.resolveTableName(entity)}" ADD COLUMN "${property}"`);
        }
        expect(warned).toContain(`UPDATE "${MigratedEntityUtilities.resolveTableName(JwtUser)}" SET "kind" = 'person' WHERE "kind" IS NULL`);
        expect(warned).toContain(`UPDATE "${MigratedEntityUtilities.resolveTableName(ApiKey)}" SET "userKind" = 'person' WHERE "userKind" IS NULL`);
        expect(warned).toContain(`UPDATE "${MigratedEntityUtilities.resolveTableName(Invoice)}" SET "type" = 'INVOICE' WHERE "type" IS NULL`);
        expect(warned).toMatch(/CREATE UNIQUE INDEX CONCURRENTLY \S+ ON "[^"]+" \("tenantId", "scope"\)/);
        expect(warn.mock.calls.filter(call => String(call[0]).includes('lacks columns the framework added'))).toHaveLength(1);
        // the uniques of 3.2 are there, and one over a column 3.3 added comes with the statements of the column
        expect(warned).not.toContain('lacks uniques');
    });

    it('signs up and logs in with a password, as in 3.2', async () => {
        const user: JwtUser = await signUp();

        expect((await users().findById(user.id)).kind).toBeUndefined();
        expect((await post('/auth/login', { email: user.email, password: PASSWORD })).status).toBe(200);
    });

    it('invites somebody and accepts the invitation with a password, as in 3.2', async () => {
        const invitation: TestInvitation = await inject(ZIBRI_DI_TOKENS.INVITATION_SERVICE).invite<TestInvitation>(callerOf(await signUp()), {
            name: 'Ada',
            email: `${UUIDUtilities.generate()}@external.example.com`,
            tenantId: undefined,
            roles: [],
            createOn: 'accept',
            declinable: true,
            expiresInMs: undefined
        }, undefined);
        await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
        const mail: Email | undefined = transport.sends.find(sent => sent.recipients.includes(invitation.email));
        const token: string | undefined = /invitation\/([\da-f]+)/.exec(mail?.html ?? '')?.[1];

        expect((await post('/auth/accept-invitation', { token, password: PASSWORD })).status).toBe(204);
        expect((await post('/auth/login', { email: invitation.email, password: PASSWORD })).status).toBe(200);
    });

    it('creates an API key for a person and calls with it, as in 3.2', async () => {
        const user: JwtUser = await signUp();
        const { key }: CreatedApiKey = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).createApiKey(
            user.id,
            { name: 'ci', permissions: [], expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
            undefined
        );

        const res: Response = await fetch(`${baseUrl}/machine/me`, { headers: { 'x-api-key': key } });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: user.id });
    });

    it('numbers invoices as in 3.2, and a final number issues none', async () => {
        const numbers: [string, string] = await inTeam(async () => [
            await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE).generateInvoiceNumber('acme', acme, undefined, 'ACME'),
            await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE).generateInvoiceNumber('acme', acme, undefined, 'ACME')
        ]);
        const invoices: Repository<Invoice> = inject(repositoryTokenFor(Invoice));
        const invoice: Invoice = await createInvoice(numbers[0]);
        await inTeam(async () => await invoices.updateById(invoice.id, { textAfterItems: ['Thank you'] }));

        expect(numbers).toEqual([`${YEAR}-ACME-0001`, `${YEAR}-ACME-0002`]);
        expect(await inTeam(async () => await invoices.findById(invoice.id))).toMatchObject({ number: numbers[0], textAfterItems: ['Thank you'] });
        expect((await inTeam(async () => await invoices.findById(invoice.id))).issuedAt).toBeUndefined();
    });

    describe('refuses a feature that needs a missing column, naming it', () => {
        it('a service account', async () => {
            const creating: Promise<unknown> = inject(ZIBRI_DI_TOKENS.USER_SERVICE).createServiceAccount?.(JwtUser, { name: 'billing', roles: [] }, undefined)
                ?? Promise.resolve();

            await expect(creating).rejects.toThrow(MissingFrameworkColumnError);
            await expect(creating).rejects.toThrow('"kind"');
        });

        it('the locale of a user', async () => {
            const user: JwtUser = await signUp();

            await expect(updateLocale(user.id, 'en-US')).rejects.toThrow('"locale"');
        });

        it('a reply-to address of a mail', async () => {
            await expect(inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).queue({
                recipients: ['ada@external.example.com'],
                subject: 'Contact',
                html: '<p>Hello</p>',
                replyTo: 'visitor@external.example.com'
            })).rejects.toThrow('"replyTo"');
        });

        it('a credit note', async () => {
            const invoice: Invoice = await createInvoice(`${YEAR}-ACME-0099`);
            const cancellations: InvoiceCancellationServiceInterface<Invoice> = inject<InvoiceCancellationServiceInterface<Invoice>>(
                ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE
            );

            await expect(inTeam(async () => await cancellations.cancelInvoice(invoice.id)))
                .rejects.toThrow(MissingFrameworkColumnError);
        });

        it('a filter on a missing column', async () => {
            await expect(inTeam(async () => await inject<Repository<Invoice>>(repositoryTokenFor(Invoice)).findAll({ where: { issuedAt: null } })))
                .rejects.toThrow('"issuedAt"');
        });
    });

    // nothing told of one: an upsert by it failed with "constraint ... does not exist", and its values were not kept apart
    describe('a unique the database lacks', () => {
        const table: string = MigratedEntityUtilities.resolveTableName(InvoiceRecipientAbbreviation);
        const unique: string = uniqueConstraintName(table, ['tenantId', 'recipientId']);

        beforeAll(async () => {
            await queryPostgres(inject(dataSourceClass), `ALTER TABLE "${table}" DROP CONSTRAINT "${unique}"`);
            warn.mockClear();
            await server?.reInit();
        }, TestTimeouts.postgres.restart);

        afterAll(async () => {
            await queryPostgres(inject(dataSourceClass), `ALTER TABLE "${table}" ADD CONSTRAINT "${unique}" UNIQUE ("tenantId", "recipientId")`);
        }, TestTimeouts.postgres.shutdown);

        it('warns once at the start, naming it with the statements that create it', () => {
            const warned: string[] = warn.mock.calls.map(call => String(call[0])).filter(message => message.includes('lacks uniques'));

            expect(warned).toHaveLength(1);
            expect(warned[0]).toContain(`${table}: tenantId, recipientId, as "${unique}"`);
            expect(warned[0]).toContain(`CREATE UNIQUE INDEX CONCURRENTLY "${unique}" ON "${table}" ("tenantId", "recipientId")`);
            expect(warned[0]).toContain(`ALTER TABLE "${table}" ADD CONSTRAINT "${unique}" UNIQUE USING INDEX "${unique}"`);
        });

        it('refuses an upsert by it, naming it', async () => {
            const numbering: Promise<string> = inTeam(async () => await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE)
                .generateInvoiceNumber('globex', acme, undefined, 'GLOBEX'));

            await expect(numbering).rejects.toThrow(MissingUniqueError);
            await expect(numbering).rejects.toThrow(`"${unique}"`);
        });
    });

    describe('once the columns are added', () => {
        beforeAll(async () => {
            const dataSource: PostgresDataSource = inject(dataSourceClass);
            const statements: string[] = ENTITIES.flatMap(entity => FrameworkColumnRegistry.findMissing(
                entity,
                ...ADDED_IN_THREE_THREE.map(([, property]) => property)
            )).flatMap(c => c.statements);
            for (const statement of statements) {
                await queryPostgres(dataSource, statement);
            }
            warn.mockClear();
            await server?.reInit();
        }, TestTimeouts.postgres.restart);

        it('starts without the warning, and the features work', async () => {
            const user: JwtUser = await signUp();
            await updateLocale(user.id, 'en-US');

            expect(warnings()).not.toContain('lacks columns the framework added');
            expect(warnings()).not.toContain('lacks uniques');
            expect(FrameworkColumnUtilities.hasColumns(Invoice, 'type', 'precedingInvoices', 'issuedAt')).toBe(true);
            expect(await users().findById(user.id)).toMatchObject({ kind: 'person', locale: 'en-US' });
        });
    });
});