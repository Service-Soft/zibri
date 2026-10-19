import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';

/**
 * An entry of a directory, linked to the user it signs in as.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['directory', 'entryId']] })
export class LdapIdentity extends BaseEntity {
    /**
     * The name of the authenticator of the directory.
     */
    @Property.string()
    directory!: string;

    /**
     * The id the directory gave the entry.
     */
    @Property.string()
    entryId!: string;

    /**
     * The user the entry is linked to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * When the entry was found disabled or deleted, and the logins of the user ended. Null while it
     * is not, and again once someone signs in as it.
     */
    @Property.date({ required: false })
    disabledAt?: Date | null;
}

/**
 * The data to link an entry of a directory to a user.
 */
export class LdapIdentityCreateData extends OmitClass(LdapIdentity, ['id']) {}