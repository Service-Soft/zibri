/* cspell:disable */
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * The name abbreviation a recipient's invoice numbers carry, eg. `SIEMEN` in `2026-SIEMEN-0001`.
 *
 * Each recipient numbers with one, and each one belongs to one recipient, so the abbreviation in a
 * number says whose invoice it is.
 */
@Entity({ allowOrphan: true })
export class InvoiceRecipientAbbreviation extends BaseEntity {
    /**
     * The tenant whose recipient this is.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;
    /**
     * The id of the recipient.
     */
    @Property.string({ unique: true })
    recipientId!: string;
    /**
     * The abbreviation of the recipient's name.
     */
    @Property.string({ unique: true })
    nameAbbreviation!: string;
}