import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * A value an attribute of a provisioned user holds, such as their family name or one of their email
 * addresses, which filters and sorts find the user by.
 */
// one row per value rather than the attributes as one object: a filter compares any attribute, the
// values of a multi-valued one each on their own and the sub-attributes of one value together
@Entity({ allowOrphan: true, indexes: [['scimUserId'], ['path']] })
export class ScimUserValue extends BaseEntity {
    /**
     * The tenant of the user.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the SCIM resource of the user.
     */
    @Property.string({ format: 'uuid' })
    scimUserId!: string;

    /**
     * The attribute, in lower case and led by the urn of its schema when it belongs to an extension,
     * eg. `emails` or `urn:ietf:params:scim:schemas:extension:enterprise:2.0:user:manager`.
     */
    @Property.string({ fuzzySearchable: false })
    attribute!: string;

    /**
     * The attribute followed by the sub-attribute that holds the value, if it is one, in lower case,
     * eg. `emails.value` or `title`.
     */
    @Property.string({ fuzzySearchable: false })
    path!: string;

    /**
     * The position of the value among those of a multi-valued attribute, 0 for any other.
     */
    @Property.number({ format: 'integer' })
    element!: number;

    /**
     * The value when it is text, in lower case: attributes compare text without regard to case.
     */
    @Property.string({ required: false, fuzzySearchable: false })
    text: string | undefined | null;

    /**
     * The value when it is a number.
     */
    @Property.number({ required: false })
    number: number | undefined | null;

    /**
     * The value when it is true or false.
     */
    @Property.boolean({ required: false })
    boolean: boolean | undefined | null;

    /**
     * Whether a sort by the path reads this value: of a multi-valued attribute the primary value's,
     * or the first one's.
     */
    @Property.boolean()
    sortValue!: boolean;
}