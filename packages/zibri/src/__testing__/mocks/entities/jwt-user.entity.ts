import { Roles } from './roles.enum';
import { BaseUserEntity } from '../../../auth/models/base-user.model';
import { Entity } from '../../../entity/decorators/entity.decorator';

@Entity({ tenant: 'shared' })
export class JwtUser extends BaseUserEntity(Roles) {}