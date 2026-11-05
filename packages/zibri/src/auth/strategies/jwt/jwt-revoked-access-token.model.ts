import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';

/**
 * An access token a client was issued and that was revoked before it expired, kept until it expires.
 */
@Entity({ tenant: 'shared', allowOrphan: true, expiresBy: 'expirationDate' })
export class JwtRevokedAccessToken extends BaseEntity {
    /**
     * The id of the token, its `jti`.
     */
    @Property.string({ format: 'uuid', unique: true })
    tokenId!: string;

    /**
     * The id of the user the token was issued for, its `sub`.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * When the token expires, after which it is refused anyway.
     */
    @Property.date()
    expirationDate!: Date;
}

/**
 * Data for storing a revoked access token.
 */
export class JwtRevokedAccessTokenCreateData extends OmitClass(JwtRevokedAccessToken, ['id']) {}