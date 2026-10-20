import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';

/**
 * An access token a client was issued and that was revoked before it expired, kept until it expires.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class JwtRevokedAccessToken extends BaseEntity {
    /**
     * The id of the token, its `jti`.
     */
    @Property.string({ format: 'uuid', unique: true })
    tokenId!: string;

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