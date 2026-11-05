import { describe, expect, it } from '@jest/globals';

import { BaseMembershipRepository } from './base-membership-repository.model';
import { BaseMembershipEntity } from './base-membership.model';
import { ChangeSetEntity } from '../../data-source/change-sets/models/change-set-entity.model';
import { isChangeSetEntityNewable } from '../../data-source/change-sets/models/is-change-set-entity.function';
import { isSoftDeleteEntityNewable } from '../../data-source/change-sets/models/is-soft-delete-entity.function';
import { SoftDeleteEntity } from '../../data-source/change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../data-source/change-sets/soft-delete-repository';
import { MEMBERSHIP_ENTITY } from '../../data-source/repository/repository-kind.model';
import { Entity } from '../../entity/decorators/entity.decorator';

/**
 * A membership that soft deletes, declared through the base alone: the base extended `BaseEntity`,
 * so a soft deleting membership declared its columns and the mark by hand.
 */
@Entity({ allowOrphan: true })
class ArchivedMembership extends BaseMembershipEntity(SoftDeleteEntity) {}

@Entity({ allowOrphan: true })
class AuditedMembership extends BaseMembershipEntity(ChangeSetEntity) {}

// the repository base composes the same way, over the entity's own repository
class ArchivedMembershipRepository extends BaseMembershipRepository<ArchivedMembership>(SoftDeleteRepository) {}

describe('BaseMembershipEntity', () => {

    it('extends the base it is given, and stays a membership', () => {
        const membership: ArchivedMembership = new ArchivedMembership();
        // typed as the base and as a membership both
        const deleted: boolean | undefined = membership.deleted;
        const userId: string | undefined = membership.userId;

        expect({ deleted, userId }).toEqual({ deleted: undefined, userId: undefined });
        expect(MEMBERSHIP_ENTITY in ArchivedMembership).toBe(true);
        expect(isSoftDeleteEntityNewable(ArchivedMembership)).toBe(true);
        expect(isChangeSetEntityNewable(AuditedMembership)).toBe(true);
        expect(isSoftDeleteEntityNewable(AuditedMembership)).toBe(false);
        expect(ArchivedMembershipRepository.prototype).toBeInstanceOf(SoftDeleteRepository);
    });

    it('asks nothing of a soft deleting base, since it declares no unique', () => {
        // @ts-expect-error -- a membership has no value a deleted row could keep taken
        expect(() => BaseMembershipEntity(SoftDeleteEntity, { deletedUserKeepsEmail: true })).not.toThrow();
    });
});