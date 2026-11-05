import { type EventTypeFor } from './event-type-for.type';
import { type MembershipEventData } from './membership-event-data.model';
import { type RolesChangedEventData } from './roles-changed-event-data.model';
import { type UserEventData } from './user-event-data.model';

/**
 * Which writes of users, memberships and roles are emitted as events, each under a type your
 * `ZibriEventMap` declares with a payload it fits. A write left out is emitted as no event.
 */
export type FrameworkEventNames = {
    /**
     * A user removed from the store. A soft deleted user is not.
     */
    userDeleted?: EventTypeFor<UserEventData>,
    /**
     * A user deactivated, who was active before.
     */
    userDeactivated?: EventTypeFor<UserEventData>,
    /**
     * A user reactivated, who was deactivated before.
     */
    userReactivated?: EventTypeFor<UserEventData>,
    /**
     * A user who becomes an active member of a tenant: a membership created, reactivated, or moved to
     * them.
     */
    membershipStarted?: EventTypeFor<MembershipEventData>,
    /**
     * A user who stops being an active member of a tenant: their membership deleted, deactivated, or
     * moved to somebody else.
     */
    membershipEnded?: EventTypeFor<MembershipEventData>,
    /**
     * A role created, changed or deleted, once for each tenant whose own roles changed, and once for
     * the roles every tenant shares.
     */
    rolesChanged?: EventTypeFor<RolesChangedEventData>
};