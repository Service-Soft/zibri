import { Property } from '../../../entity/decorators/property.decorator';
import { XmlAttribute } from '../../../parsing/xml/xml-attribute.decorator';
import { XmlText } from '../../../parsing/xml/xml-text.decorator';
import { BigNumber } from '../../../utilities/number.utilities';

/**
 * An amount of a CAMT.053 statement, in the currency it names, never below zero.
 */
export class CamtAmount {
    /**
     * The currency, such as `EUR`.
     */
    @XmlAttribute('Ccy')
    @Property.string({ regex: /^[A-Z]{3}$/ })
    currency!: string;

    /**
     * The amount.
     */
    @XmlText()
    @Property.number({ format: 'bignumber', min: 0 })
    value!: BigNumber;
}