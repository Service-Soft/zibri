import { BaseEntity, Entity, OmitType, Property } from '../../entity';

/**
 * The jwt refresh token that gets stored in the database.
 */
@Entity()
export class JwtRefreshToken extends BaseEntity {
    /**
     * The id of the user that this token belongs to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * The actual token value.
     */
    @Property.string({ unique: true })
    value!: string;

    /**
     * Whether or not this refresh token has been blacklisted.
     *
     * Is used for automatic reuse detection.
     */
    @Property.boolean()
    blacklisted!: boolean;

    /**
     * The expiration date of the token.
     */
    @Property.date()
    expirationDate!: Date;

    /**
     * The id of the "family" this token belongs to.
     * All tokens that belong to the same "ancestor" are considered to be in a family.
     *
     * Is used for automatic reuse detection.
     */
    @Property.string({ format: 'uuid' })
    familyId!: string;
}

/**
 * Data for creating a new jwt refresh token.
 */
export class JwtRefreshTokenCreateDto extends OmitType(JwtRefreshToken, ['id']) {}