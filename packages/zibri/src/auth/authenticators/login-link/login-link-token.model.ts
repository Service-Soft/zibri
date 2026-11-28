import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';

/**
 * The token of a link to log in with, sent by email. Spent by the login it starts.
 */
// not backed up: a restore keeps the tokens of now, so that one used since the backup stays used
@Entity({ tenant: 'shared', allowOrphan: true, expiresBy: 'expiresAt', backedUp: false })
export class LoginLinkToken extends BaseEntity {
    /**
     * The token, stored hashed and found by its hash, for the reason `PasswordResetToken` gives.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy }, password: false })
    value!: HashString;

    /**
     * The id of the user the link logs in.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * When the link stops working.
     */
    @Property.date()
    expiresAt!: Date;

    /**
     * The hash of the cookie of the browser that asked for the link, which only that browser presents. Null for a
     * link that works in any browser.
     */
    @Property.string({ required: false })
    browserBinding?: string | null;
}

/**
 * The data to create a token of a link to log in with.
 */
export class LoginLinkTokenCreateData extends OmitClass(LoginLinkToken, ['id', 'value']) {
    /**
     * The token as it is generated and mailed out, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy }, password: false })
    value!: string;
}