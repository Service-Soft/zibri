import { BaseUserEntity } from '../../../auth/models/base-user.model';
import { Entity } from '../../../entity/decorators/entity.decorator';

/**
 * The user of the test fixtures. Its roles are the names of rows, such as those of `Roles`.
 */
@Entity({ tenant: 'shared' })
export class JwtUser extends BaseUserEntity<string>() {}