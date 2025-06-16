import { BaseEntity, Entity, OmitType, Property } from '../../entity';

@Entity()
export class RefreshToken implements BaseEntity {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ format: 'uuid' })
    userId!: string;

    @Property.string({ unique: true })
    value!: string;

    @Property.boolean()
    blacklisted!: boolean;

    @Property.date()
    expirationDate!: Date;

    @Property.string({ format: 'uuid' })
    familyId!: string;
}

export class RefreshTokenCreateDto extends OmitType(RefreshToken, ['id']) {}