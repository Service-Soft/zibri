import { BaseEntity, Entity, OmitType, Property } from '../../entity';

@Entity()
export class JwtCredentials implements BaseEntity {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ format: 'uuid' })
    userId!: string;

    @Property.string({ unique: true })
    username!: string;

    @Property.string()
    password!: string;
}

export class JwtCredentialsDto extends OmitType(JwtCredentials, ['id', 'userId']) {}