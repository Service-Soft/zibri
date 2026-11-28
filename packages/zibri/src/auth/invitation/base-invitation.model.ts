import { FrameworkColumnRegistry } from '../../data-source/migration/framework-column.registry';
import { INVITATION_ENTITY } from '../../data-source/repository/repository-kind.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';
import { type LocaleCode } from '../../localization/models/locale-code.model';
import { PendingRowShare } from '../../sharing/pending-row-share.model';
import { Newable } from '../../types/newable.type';
import type { HashString } from '../hash/hash.utilities';
import { Sha256HashStrategy } from '../hash/strategies/sha256.hash-strategy';
import { type InvitationCreateOn } from './invitation-create-on.type';

/**
 * The values of `createOn`, as the enum of the column.
 */
const CREATE_ON: Readonly<Record<string, InvitationCreateOn>> = { invite: 'invite', accept: 'accept' };

/**
 * Common properties shared by all invitations: somebody invited to the application, or to a tenant with roles there,
 * until they accept or decline, or the invitation is revoked.
 */
export type BaseInvitation = BaseEntity & {
    /**
     * The tenant the invitation is to, or null for one to the application only.
     */
    tenantId?: string | null,
    /**
     * The email the invitation is sent to, and the account it is for.
     */
    email: string,
    /**
     * The roles the invited person gets: tenant roles of the tenant, or platform roles without one.
     */
    roles: string[],
    /**
     * The id of the user who invited them.
     */
    invitedBy: string,
    /**
     * When the account and the membership are created.
     */
    createOn: InvitationCreateOn,
    /**
     * Whether the invited person may decline it.
     */
    declinable: boolean,
    /**
     * The token of the link that was mailed, stored hashed and found by its hash.
     */
    token: HashString,
    /**
     * When the link stops working. A link followed later is refused, or renewed, as
     * `ZIBRI_DI_TOKENS.INVITATION_OPTIONS` says.
     */
    tokenExpiresAt: Date,
    /**
     * When the invitation ends, or null for one that lasts until it is answered or revoked.
     */
    expiresAt?: Date | null,
    /**
     * The account the invitation created when it was sent, with `createOn` `'invite'`, or null when the account
     * existed or is created once it is accepted.
     */
    createdUserId?: string | null,
    /**
     * The locale the invitation is mailed in, and the account it creates gets. Null for the default locale.
     */
    locale?: LocaleCode | null,
    /**
     * Whether the account the invitation creates gets no password: accepting takes none, and logs the person
     * accepting in by the link. Null for an invitation that takes a password.
     */
    withoutPassword?: boolean | null,
    /**
     * The rows shared with the invited person once they accept, see `ShareServiceInterface`. Null for an invitation
     * sharing nothing.
     */
    rowShares?: PendingRowShare[] | null
};

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a base invitation entity class. Declare it with `@Entity({ expiresBy: 'expiresAt' })`, and with the
 * columns of your own the account of an invitation is created from, such as a name.
 */
export function BaseInvitationEntity(): Newable<BaseInvitation> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class InvitationEntity extends BaseEntity implements BaseInvitation {
        // eslint-disable-next-line jsdoc/require-jsdoc
        static readonly [INVITATION_ENTITY]: true = true;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'uuid', required: false })
        tenantId?: string | null;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'email' })
        email!: string;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.array({ items: { type: 'string' } })
        roles!: string[];
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'uuid' })
        invitedBy!: string;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ enum: CREATE_ON })
        createOn!: InvitationCreateOn;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.boolean()
        declinable!: boolean;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy }, password: false })
        token!: HashString;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.date()
        tokenExpiresAt!: Date;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.date({ required: false })
        expiresAt?: Date | null;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'uuid', required: false })
        createdUserId?: string | null;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ required: false })
        locale?: LocaleCode | null;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.boolean({ required: false })
        withoutPassword?: boolean | null;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.array({ items: { type: 'object', cls: () => PendingRowShare }, required: false })
        rowShares?: PendingRowShare[] | null;
    }
    // added by the data source to a table that lacks them, so that an invitation entity of 3.2 takes no migration of
    // the application's. Without the column, the locale an invitation is sent in by default is left out, as one of
    // 3.2 had none, and invite refuses one given
    FrameworkColumnRegistry.register(
        { entity: InvitationEntity, property: 'locale', meansAbsent: () => true },
        { entity: InvitationEntity, property: 'withoutPassword', meansAbsent: value => value === false },
        { entity: InvitationEntity, property: 'rowShares', meansAbsent: value => Array.isArray(value) && value.length === 0 }
    );

    return InvitationEntity;
}