import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * A group an identity provider provisioned through SCIM. Its id is the id of the SCIM resource, and
 * its members are kept as `ScimGroupMember`.
 */
@Entity({ allowOrphan: true })
export class ScimGroup extends BaseEntity {
    /**
     * The tenant whose identity provider provisioned the group.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The name of the group, as it was sent.
     */
    @Property.string()
    displayName!: string;

    /**
     * The name in lower case, which a filter finds the group by: SCIM compares it without regard to
     * case.
     */
    @Property.string({ index: true })
    displayNameKey!: string;

    /**
     * The id the identity provider gave the group, if it sent one.
     */
    @Property.string({ required: false, index: true })
    externalId: string | undefined | null;

    /**
     * When the group was provisioned.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;

    /**
     * When the group was last changed through SCIM.
     */
    @Property.date({ default: () => new Date() })
    updatedAt!: Date;

    /**
     * Counts the changes of the resource, its members included, which is what its etag says. A change
     * names the version it was based on, so of two at once only one lands.
     */
    @Property.number({ format: 'integer', optimisticLocking: true, default: () => 1 })
    version!: number;
}