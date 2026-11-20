import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { compileTsxTemplate } from '../../__testing__/compile-tsx-template.function';
import { TestTimeouts } from '../../__testing__/constants';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { TestServerInvitationRepository } from '../../__testing__/test-server/invitation-repository';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { RepositoryFor } from '../../data-source/repository/repository-for.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { defineProvider } from '../../di/models/di-provider.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { OtpTwoFactorMethod } from '../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../auth-controller/auth-controller.model';
import { PasswordAuthenticator } from '../authenticators/password/password.authenticator';
import { BaseUser } from '../models/base-user.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';
import { BaseInvitationRepository } from './base-invitation-repository.model';
import { BaseInvitationEntity } from './base-invitation.model';
import { InvitationEmailTemplate } from './invitation-email-template.model';
import { InvitationOptions } from './invitation-options.model';

// a file of its own, for the reason the start of the MembershipService gives

/**
 * An invitation whose rows nothing deletes once they ended.
 */
@Entity({ allowOrphan: true })
class EndlessInvitation extends BaseInvitationEntity() {}

@RepositoryFor(EndlessInvitation)
class EndlessInvitationRepository extends BaseInvitationRepository<EndlessInvitation>() {

    // eslint-disable-next-line typescript/require-await
    override async createInvitedUser(): Promise<BaseUser<string>> {
        throw new Error('No account is created while the application refuses to start.');
    }
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class InvitationRoutesAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        invitationRoutes: true
    }) {}

const options: InvitationOptions = {
    acceptInvitationUrl: 'https://app.example.com/invitation',
    invitationEmail: compileTsxTemplate<InvitationEmailTemplate>('export const Email = ({ link }) => <a href={link}></a>;'),
    tokenExpiresInMs: 60000,
    onExpiredToken: 'refuse'
};

describe('InvitationService - starting', () => {
    it('refuses to start an application with invitations and no options to send them with', async () => {
        const start: Promise<StartedTestServer> = startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, TestInvitation],
                    repositories: [...defaultTestServerRepositories, TestServerInvitationRepository],
                    allowOrphan: true
                })
            ]
        });

        await expect(start).rejects.toThrow(/ZIBRI_DI_TOKENS.INVITATION_OPTIONS is not provided/);
    }, TestTimeouts.inMemory.start);

    it('refuses an invitation entity whose rows do not expire by their expiresAt', async () => {
        const start: Promise<StartedTestServer> = startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, EndlessInvitation],
                    repositories: [...defaultTestServerRepositories, EndlessInvitationRepository],
                    allowOrphan: true
                })
            ],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.INVITATION_OPTIONS, useValue: options })]
        });

        await expect(start).rejects.toThrow(/Declare it with @Entity\({ expiresBy: 'expiresAt' }\)/);
    }, TestTimeouts.inMemory.start);

    it('refuses the routes answering invitations in an application without them', async () => {
        const server: StartedTestServer = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: defaultTestServerEntities,
                    repositories: defaultTestServerRepositories,
                    allowOrphan: true
                })
            ],
            authStrategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [OtpTwoFactorMethod],
            controllers: [InvitationRoutesAuthController]
        });

        try {
            // checked as the application starts, once every authenticator has been initialized
            await expect(server.start()).rejects.toThrow(/defines the routes answering invitations, and no invitation repository is listed/);
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});