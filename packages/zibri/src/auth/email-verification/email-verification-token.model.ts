import { type EmailVerificationPurpose } from './email-verification-purpose.type';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitClass } from '../../entity/omit-class.model';
import type { HashString } from '../hash/hash.utilities';
import { Sha256HashStrategy } from '../hash/strategies/sha256.hash-strategy';

/**
 * The verification purposes, as the enum of the column.
 */
const PURPOSES: Readonly<Record<string, EmailVerificationPurpose>> = { verification: 'verification', change: 'change' };

/**
 * A short lived token a link to verify an email address carries.
 */
@Entity({ tenant: 'shared', allowOrphan: true, expiresBy: 'expirationDate' })
export class EmailVerificationToken extends BaseEntity {
    /**
     * The token, stored hashed and found by its hash, for the reason `PasswordResetToken` gives.
     */
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy } })
    value!: HashString;

    /**
     * The id of the user the address is verified for.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * The address the link was sent to, which it verifies.
     */
    @Property.string({ format: 'email' })
    email!: string;

    /**
     * Whether the link verifies the user's address, or changes it to this one.
     */
    @Property.string({ enum: PURPOSES })
    purpose!: EmailVerificationPurpose;

    /**
     * When the link stops working.
     */
    @Property.date()
    expirationDate!: Date;
}

/**
 * The data to create a new email verification token.
 */
export class EmailVerificationTokenCreateData extends OmitClass(EmailVerificationToken, ['id', 'value']) {
    /**
     * The token as it is generated and mailed out, before the hook hashes it.
     */
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy } })
    value!: string;
}