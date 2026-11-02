import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { CronServiceInterface } from './cron-service.interface';
import { CronService } from './cron.service';
import { ExpiredRowsCleanupCronJob } from './expired-rows-cleanup.cron-job';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { TwoFactorCode } from '../auth/2fa/methods/code/two-factor-code.model';
import { FederatedConnectionCode } from '../auth/authenticators/federated/federated-connection-code.model';
import { FederatedHandoverCode } from '../auth/authenticators/federated/federated-handover-code.model';
import { FederatedLoginAttempt } from '../auth/authenticators/federated/federated-login-attempt.model';
import { FederatedRegistrationTicket } from '../auth/authenticators/federated/federated-registration-ticket.model';
import { EmailVerificationToken } from '../auth/email-verification/email-verification-token.model';
import { LoginTicket } from '../auth/models/login-ticket.model';
import { PasswordResetToken, PasswordResetTokenCreateData } from '../auth/models/password-reset-token.model';
import { CookieAuthRefreshSession } from '../auth/strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../auth/strategies/cookie/cookie-auth-session.model';
import { JwtRefreshToken } from '../auth/strategies/jwt/jwt-refresh-token.model';
import { JwtRevokedAccessToken } from '../auth/strategies/jwt/jwt-revoked-access-token.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { DiProvider, defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Lease } from '../leases/lease.model';
import { Log } from '../logging/log.model';
import { MailingListSubscriptionConfirmationToken } from '../plugin/mailing-list/models/mailing-list-subscription-confirmation-token.model';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * An invitation of the application's own, which a team sends and which lapses after a week.
 */
@Entity({ expiresBy: 'expiresAt' })
class Invitation extends BaseEntity {
    /**
     * The team that sent it.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * Who it was sent to.
     */
    @Property.string()
    email!: string;

    /**
     * When it lapses.
     */
    @Property.date()
    expiresAt!: Date;
}

/**
 * What an invitation is created with.
 */
type InvitationCreateData = Pick<Invitation, 'email' | 'expiresAt'>;

/**
 * The test providers with the real cron service, rather than the stub that registers nothing: that the
 * application registers the job is part of what is tested.
 */
const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders.filter(provider => provider.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
    defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
];

describe('ExpiredRowsCleanupCronJob', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Invitation], repositories: defaultTestServerRepositories })],
            providers
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('is registered for an application holding an entity whose rows expire', () => {
        expect(inject<CronServiceInterface>(ZIBRI_DI_TOKENS.CRON_SERVICE).cronJobs.some(job => job instanceof ExpiredRowsCleanupCronJob)).toBe(true);
    });

    it('deletes the rows of an entity of the application once their date passed, in every tenant, and keeps the others', async () => {
        const invitations: Repository<Invitation, InvitationCreateData> = inject(repositoryTokenFor(Invitation));
        const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        const inTeam: (tenantId: string, expiresAt: Date) => Promise<Invitation> = async (tenantId, expiresAt) => await tenants.runAs(
            tenantId,
            async () => await invitations.create({ email: 'ada@example.com', expiresAt })
        );
        const team: string = UUIDUtilities.generate();
        const otherTeam: string = UUIDUtilities.generate();
        const lapsed: Invitation[] = [
            await inTeam(team, new Date(Date.now() - Ms.MINUTE)),
            await inTeam(otherTeam, new Date(Date.now() - Ms.DAY))
        ];
        const open: Invitation[] = [
            await inTeam(team, new Date(Date.now() + Ms.DAY)),
            await inTeam(otherTeam, new Date(Date.now() + Ms.HOUR))
        ];

        await inject(ExpiredRowsCleanupCronJob).onTick();

        const left: string[] = (await invitations.findAll({ where: { id: { oneOf: [...lapsed, ...open].map(i => i.id) } }, acrossTenants: true }))
            .map(invitation => invitation.id)
            .sort();
        expect(left).toEqual(open.map(invitation => invitation.id).sort());
    });

    // what PasswordResetTokenCleanupCronJob held: an expired, unused reset token was kept
    // for good, since nothing deleted it but the next reset its user asked for
    it('deletes the reset tokens that expired, and keeps the ones that did not', async () => {
        const tokens: Repository<PasswordResetToken, PasswordResetTokenCreateData> = inject(repositoryTokenFor(PasswordResetToken));
        const expired: PasswordResetToken = await tokens.create({
            userId: UUIDUtilities.generate(),
            value: UUIDUtilities.generate(),
            expirationDate: new Date(Date.now() - Ms.MINUTE)
        });
        const current: PasswordResetToken = await tokens.create({
            userId: UUIDUtilities.generate(),
            value: UUIDUtilities.generate(),
            expirationDate: new Date(Date.now() + Ms.HOUR)
        });

        await inject(ExpiredRowsCleanupCronJob).onTick();

        const left: string[] = (await tokens.findAll({ where: { id: { oneOf: [expired.id, current.id] } } })).map(token => token.id);
        expect(left).toEqual([current.id]);
    });
});

describe('the entities of the framework whose rows expire', () => {
    it('each declare the date they expire by, which the one job deletes them by', () => {
        const expiring: [Newable<BaseEntity>, string][] = [
            [TwoFactorCode, 'expirationDate'],
            [PasswordResetToken, 'expirationDate'],
            [EmailVerificationToken, 'expirationDate'],
            [LoginTicket, 'expirationDate'],
            [CookieAuthSession, 'expirationDate'],
            [CookieAuthRefreshSession, 'expirationDate'],
            [JwtRefreshToken, 'expirationDate'],
            [JwtRevokedAccessToken, 'expirationDate'],
            [FederatedLoginAttempt, 'expirationDate'],
            [FederatedHandoverCode, 'expirationDate'],
            [FederatedRegistrationTicket, 'expirationDate'],
            [FederatedConnectionCode, 'expirationDate'],
            [MailingListSubscriptionConfirmationToken, 'expirationDate'],
            [Lease, 'expiresAt'],
            [Log, 'cleanupAt']
        ];

        expect(expiring.map(([entity]) => [entity.name, MetadataUtilities.getEntityMetadata(entity)?.expiresBy]))
            .toEqual(expiring.map(([entity, property]) => [entity.name, property]));
    });
});