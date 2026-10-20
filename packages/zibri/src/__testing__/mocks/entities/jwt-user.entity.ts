import { Roles } from './roles.enum.ts';
import { BaseUserEntity } from '../../../auth/models/base-user.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';

@Entity({ tenant: 'shared' })
export class JwtUser extends BaseUserEntity(Roles) {}