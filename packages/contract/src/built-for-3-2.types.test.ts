// checked by the typecheck: what a frontend of 3.2 builds of the models 3.3 gave a member to still compiles.
import { CurrentUserProfile } from './current-user-profile.model';
import { InvitationTokenValidity } from './invitation-token-validity.model';

// without a kind, as a test of a frontend of 3.2 builds it: a person
const profileOf32: CurrentUserProfile = {
    id: 'a1c3d8f0-5b2e-4c71-9a39-0e6b2f4d7c18',
    email: 'user@example.com',
    memberships: [],
    platformPermissions: []
};

// without withoutPassword: an invitation that takes a password
const validityOf32: InvitationTokenValidity = {
    isValid: true,
    renewed: false,
    email: 'invited@example.com',
    requiresLogin: false,
    declinable: true
};

export const checked: unknown[] = [profileOf32, validityOf32];