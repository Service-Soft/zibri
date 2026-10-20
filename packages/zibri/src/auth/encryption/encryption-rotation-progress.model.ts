import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../entity/omit-class.model.ts';

/**
 * How far `EncryptionRotationCronJob` is through the stored values. There is one row.
 *
 * A pass reads every row of every entity holding an encrypted property, a bounded number per run, and
 * continues where the last run stopped.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class EncryptionRotationProgress extends BaseEntity {
    /**
     * The name of the entity the pass in progress is at. Null while no pass is in progress.
     */
    @Property.string({ required: false })
    entityName: string | undefined | null;
    /**
     * Where the pass in progress continues reading that entity, as `findAllAfter` hands it out. Null
     * before its first page.
     */
    @Property.string({ required: false })
    cursor: string | undefined | null;
    /**
     * The data keys being retired when the pass in progress started.
     */
    @Property.array({ items: { type: 'string' } })
    passRetiredKeyIds!: string[];
    /**
     * The data keys being retired when the last finished pass started. A pass starts again once
     * another key is retired.
     */
    @Property.array({ items: { type: 'string' } })
    sweptRetiredKeyIds!: string[];
}

/**
 * The data to create the progress row.
 */
export class EncryptionRotationProgressCreateData extends OmitClass(EncryptionRotationProgress, ['id']) {}