import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlAttribute } from '../../../../../../parsing/xml/xml-attribute.decorator';
import { XmlText } from '../../../../../../parsing/xml/xml-text.decorator';

/**
 * An amount, in the currency it names.
 */
export class CiiAmount {
    /**
     * The currency.
     */
    @XmlAttribute('currencyID')
    @Property.string()
    currency!: string;

    /**
     * The amount.
     */
    @XmlText()
    @Property.string()
    value!: string;
}