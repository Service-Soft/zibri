import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitClass } from '../../entity/omit-class.model';

/**
 * A row `EncryptionRotationCronJob` could not rewrite, and when it tries again.
 *
 * Removed once the row is rewritten, or once it no longer exists.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class EncryptionRotationFailure extends BaseEntity {
    /**
     * The name of the entity the row belongs to.
     */
    @Property.string()
    entityName!: string;
    /**
     * The id of the row.
     */
    @Property.string()
    rowId!: string;
    /**
     * The data keys the stored values of the row are encrypted with.
     */
    @Property.array({ items: { type: 'string' } })
    keyIds!: string[];
    /**
     * Why the last attempt failed.
     */
    @Property.string()
    error!: string;
    /**
     * How many times rewriting the row failed.
     */
    @Property.number({ format: 'integer' })
    attempts!: number;
    /**
     * When rewriting the row failed first.
     */
    @Property.date()
    failedAt!: Date;
    /**
     * When the job tries again. Each failure doubles the wait, up to a day.
     */
    @Property.date()
    retryAt!: Date;
}

/**
 * The data to record a row that could not be rewritten.
 */
export class EncryptionRotationFailureCreateData extends OmitClass(EncryptionRotationFailure, ['id']) {}