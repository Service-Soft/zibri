import { Roles } from './roles.enum';
import { BaseUserEntity } from '../../../auth/models/base-user.model';
import { Entity } from '../../../entity/decorators/entity.decorator';

@Entity()
export class JwtUser extends BaseUserEntity(Roles) {}