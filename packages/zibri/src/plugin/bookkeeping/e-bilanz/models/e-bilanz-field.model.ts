import { type EBilanzFieldModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';

/**
 * A field of the GCD module of an E-Bilanz: the company, the report and its period.
 */
export class EBilanzField implements EBilanzFieldModel {
    /**
     * The element name of the field, such as `genInfo.company.id.name`.
     */
    @Property.string()
    name!: string;

    /**
     * The German label of the field.
     */
    @Property.string()
    label!: string;

    /**
     * The value, or null for NIL.
     */
    @Property.string({ required: false })
    value!: string | null;

    /**
     * Which occurrence of a field stated more than once it is, such as the second shareholder, from 0.
     */
    @Property.number({ format: 'integer', min: 0 })
    occurrence!: number;
}