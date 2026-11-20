import { BaseInvitationEntity } from '../../../auth/invitation/base-invitation.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The invitation of the test fixtures, with a column of its own the account of an invitation is created from.
 */
// an orphan for every suite that imports a file declaring it without storing it
@Entity({ uniques: [['email']], expiresBy: 'expiresAt', allowOrphan: true })
export class TestInvitation extends BaseInvitationEntity() {
    /**
     * Who is invited, as the inviter wrote it.
     */
    @Property.string()
    name!: string;
}