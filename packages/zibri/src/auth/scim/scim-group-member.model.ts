import { ScimMemberType } from './scim-member-type.enum.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';

/**
 * That a user or a group an identity provider provisioned is a member of a group it provisioned.
 */
@Entity({ allowOrphan: true, uniques: [['groupId', 'memberId']] })
export class ScimGroupMember extends BaseEntity {
    /**
     * The tenant of the group.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the group.
     */
    @Property.string({ format: 'uuid' })
    groupId!: string;

    /**
     * The id of the SCIM resource of the member.
     */
    // the groups of a member are looked up by it, which the unique, led by the group, does not answer
    @Property.string({ format: 'uuid', index: true })
    memberId!: string;

    /**
     * Whether the member is a user or a group.
     */
    @Property.string({ enum: ScimMemberType })
    memberType!: ScimMemberType;
}