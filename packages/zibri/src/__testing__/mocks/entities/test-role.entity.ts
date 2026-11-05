import { BaseRoleEntity } from '../../../auth/roles/base-role.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The role of the test fixtures, with what an application keeps about a role besides.
 */
@Entity()
export class TestRole extends BaseRoleEntity {
    @Property.string({ required: false })
    description: string | undefined | null;
}