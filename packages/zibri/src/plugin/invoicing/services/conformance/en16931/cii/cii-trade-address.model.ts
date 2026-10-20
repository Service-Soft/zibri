import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * A postal address.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiTradeAddress {
    /**
     * The postcode.
     */
    @XmlElement('PostcodeCode')
    @Property.string()
    postcode!: string;

    /**
     * The street and the house number.
     */
    @XmlElement('LineOne')
    @Property.string()
    lineOne!: string;

    /**
     * The city.
     */
    @XmlElement('CityName')
    @Property.string()
    city!: string;

    /**
     * The code of the country.
     */
    @XmlElement('CountryID')
    @Property.string()
    countryId!: string;
}