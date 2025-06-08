import { Jwt } from './jwt.model';
import { Property } from '../../entity';

export class JwtAuthData<Role extends string> {
    @Property.string({ format: 'uuid' })
    userId!: string;

    @Property.object({ cls: Jwt })
    accessToken!: Jwt;

    @Property.object({ cls: Jwt })
    refreshToken!: Jwt;

    @Property.array({ items: { type: 'string' } })
    roles!: Role[];
}

// export class JwtAuthData<Role extends string> {
//     @Property.object({ cls: Jwt })
//     accessToken!: Jwt;

//     @Property.object({ cls: Jwt })
//     refreshToken!: Jwt;

//     @Property.array({ items: { type: 'string' } })
//     roles!: Role[];
// }