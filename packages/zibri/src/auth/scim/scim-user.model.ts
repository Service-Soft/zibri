import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';

/**
 * A user the identity provider of a tenant provisioned through SCIM, linked to the user of the
 * application it stands for. Its id is the id of the SCIM resource.
 */
@Entity({ allowOrphan: true })
export class ScimUser extends BaseEntity {
    /**
     * The tenant whose identity provider provisioned the user.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the user of the application.
     */
    @Property.string({ format: 'uuid', unique: true })
    userId!: string;

    /**
     * Whether the identity provider created the user, which makes its tenant their owner: it changes,
     * deactivates and deletes the user in every tenant. The identity provider of any other tenant
     * reaches only the user's membership in its own.
     */
    @Property.boolean()
    ownsUser!: boolean;

    /**
     * The name the identity provider knows the user by, as it was sent.
     */
    @Property.string()
    userName!: string;

    /**
     * The name in lower case, which is what tells two users apart: SCIM compares it without regard to
     * case.
     */
    @Property.string({ unique: true })
    userNameKey!: string;

    /**
     * The id the identity provider gave the user, if it sent one.
     */
    @Property.string({ required: false, index: true })
    externalId: string | undefined | null;

    /**
     * Whether the identity provider has the user active.
     */
    @Property.boolean()
    active!: boolean;

    /**
     * Every other attribute of the resource, as it was last provisioned.
     */
    @Property.unknown()
    attributes!: Record<string, unknown>;

    /**
     * When the user was provisioned.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;

    /**
     * When the user was last changed through SCIM.
     */
    @Property.date({ default: () => new Date() })
    updatedAt!: Date;

    /**
     * Counts the changes of the resource, which is what its etag says. A change names the version it
     * was based on, so of two at once only one lands.
     */
    @Property.number({ format: 'integer', optimisticLocking: true, default: () => 1 })
    version!: number;
}