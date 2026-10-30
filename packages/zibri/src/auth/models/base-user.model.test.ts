import { describe, expect, it } from '@jest/globals';

import { BaseUserEntity } from './base-user.model';
import { ChangeSetEntity } from '../../data-source/change-sets/models/change-set-entity.model';
import { isSoftDeleteEntityNewable } from '../../data-source/change-sets/models/is-soft-delete-entity.function';
import { SoftDeleteEntity } from '../../data-source/change-sets/models/soft-delete-entity.model';
import { USER_ENTITY } from '../../data-source/repository/repository-kind.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { InternalError } from '../../error-handling/internal-error.model';
import { keyGroupsOf } from '../../global/model-registry/key-descriptor';

/**
 * A user that soft deletes, declared through the base alone: a user entity that soft deleted had to
 * declare its columns and the user mark by hand, since the base extended `BaseEntity` and nothing
 * outside it could say whether a deleted user keeps their address (08 §X28).
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class ArchivedAccount extends BaseUserEntity(SoftDeleteEntity, { deletedUserKeepsEmail: false }) {}

@Entity({ tenant: 'shared', allowOrphan: true })
class BurnedAccount extends BaseUserEntity(SoftDeleteEntity, { deletedUserKeepsEmail: true }) {}

@Entity({ tenant: 'shared', allowOrphan: true })
class AuditedAccount extends BaseUserEntity(ChangeSetEntity) {}

describe('BaseUserEntity', () => {

    it('extends the base it is given, and stays a user', () => {
        const account: ArchivedAccount = new ArchivedAccount();
        // typed as the base and as a user both
        const deleted: boolean | undefined = account.deleted;
        const email: string | undefined = account.email;

        expect({ deleted, email }).toEqual({ deleted: undefined, email: undefined });
        expect(isSoftDeleteEntityNewable(ArchivedAccount)).toBe(true);
        expect(USER_ENTITY in ArchivedAccount).toBe(true);
        expect(new AuditedAccount()).toBeInstanceOf(ChangeSetEntity);
    });

    it('frees or keeps the address of a soft deleted user, as the option says', () => {
        expect(keyGroupsOf(ArchivedAccount).uniques).toEqual([{ properties: ['email'], where: { deleted: false } }]);
        expect(keyGroupsOf(BurnedAccount).uniques).toEqual([{ properties: ['email'], where: {} }]);
        expect(keyGroupsOf(AuditedAccount).uniques).toEqual([{ properties: ['email'] }]);
    });

    it('asks a soft deleting base whether a deleted user keeps their address', () => {
        // @ts-expect-error -- a soft deleting base takes the option, so the answer is never a default
        expect(() => BaseUserEntity(SoftDeleteEntity)).toThrow(InternalError);
        // @ts-expect-error -- a base that keeps every row has nothing to ask
        expect(() => BaseUserEntity(ChangeSetEntity, { deletedUserKeepsEmail: true })).not.toThrow();
    });

    // soft deleting one on a data source, beside the role and membership entities an application with
    // users declares, is in repository-for.decorator.test.ts
});