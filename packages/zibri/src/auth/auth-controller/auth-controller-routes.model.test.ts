import { describe, expect, it } from '@jest/globals';

import { type CurrentUser } from '../decorators/current-user.decorator';
import { AcceptInvitationInput } from '../invitation/accept-invitation-input.model';
import { InvitationTokenInput } from '../invitation/invitation-token-input.model';
import { InvitationTokenValidity } from '../invitation/invitation-token-validity.model';
import { CurrentUserProfile } from '../models/current-user-profile.model';
import { AuthControllerCurrentUserRoutes, AuthControllerInvitationRoutes } from './auth-controller-routes.model';

/**
 * A call of the invitation routes, with the strategy it names.
 */
type InvitationCall = [AcceptInvitationInput, string | undefined];

/**
 * The routes of the auth controller as a controller of an application of 3.2 overrode them: answering who is logged in
 * and what an invitation link is itself, as 3.2 built those, and accepting an invitation through the route it extends
 * with the arguments of 3.2. The typecheck checks that it still compiles.
 */
class RoutesOf32 implements AuthControllerCurrentUserRoutes, AuthControllerInvitationRoutes {
    constructor(private readonly extended: AuthControllerInvitationRoutes) {}

    async getCurrentUser(user: CurrentUser): Promise<CurrentUserProfile> {
        // without a kind, which 3.2 had not: a person
        return await Promise.resolve({ id: user.id, email: user.email, memberships: [], platformPermissions: user.platformPermissions });
    }

    async verifyInvitationToken(): Promise<InvitationTokenValidity> {
        // without withoutPassword, which 3.2 had not: an invitation that takes a password
        return await Promise.resolve({ isValid: true, renewed: false, requiresLogin: false, declinable: true });
    }

    async acceptInvitation(user: CurrentUser | undefined, input: AcceptInvitationInput): Promise<void> {
        await this.extended.acceptInvitation(user, input);
    }

    async declineInvitation(input: InvitationTokenInput): Promise<void> {
        await this.extended.declineInvitation(input);
    }
}

describe('routes of the auth controller overridden as in 3.2', () => {
    it('accept an invitation through the route they extend, naming no strategy', async () => {
        const calls: InvitationCall[] = [];
        const routes: RoutesOf32 = new RoutesOf32({
            verifyInvitationToken: async () => await Promise.resolve({ isValid: false, renewed: false, requiresLogin: false, declinable: false }),
            acceptInvitation: async (_user, input, strategy) => {
                calls.push([input, strategy]);
                return await Promise.resolve(undefined);
            },
            declineInvitation: async () => await Promise.resolve()
        });

        await routes.acceptInvitation(undefined, { token: 'token', password: 'a password of fifteen characters' });

        expect(calls).toEqual([[{ token: 'token', password: 'a password of fifteen characters' }, undefined]]);
    });

    it('answer an invitation link without withoutPassword', async () => {
        const routes: RoutesOf32 = new RoutesOf32({
            verifyInvitationToken: async () => await Promise.resolve({ isValid: false, renewed: false, requiresLogin: false, declinable: false }),
            acceptInvitation: async () => await Promise.resolve(undefined),
            declineInvitation: async () => await Promise.resolve()
        });

        expect(await routes.verifyInvitationToken()).not.toHaveProperty('withoutPassword');
    });
});
