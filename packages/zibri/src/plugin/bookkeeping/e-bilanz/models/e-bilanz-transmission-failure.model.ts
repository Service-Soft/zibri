import { type EBilanzTransmissionFailureModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';

/**
 * What a transmitter failed with, as a record of a failed transmission keeps it.
 */
export class EBilanzTransmissionFailure implements EBilanzTransmissionFailureModel {
    /**
     * The name of the error, such as `EBilanzNotSentError`.
     */
    @Property.string()
    name!: string;

    /**
     * The message of the error.
     */
    @Property.string()
    message!: string;

    /**
     * The message and what caused it, one paragraph each.
     */
    @Property.array({ items: { type: 'string' } })
    paragraphs!: string[];
}
