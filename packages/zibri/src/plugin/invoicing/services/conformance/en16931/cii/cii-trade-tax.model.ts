import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * A tax applied, to one line or to everything taxed at one rate.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiTradeTax {
    /**
     * The tax, for everything taxed at this rate.
     */
    @XmlElement('CalculatedAmount')
    @Property.string({ required: false })
    calculatedAmount?: string;

    /**
     * The kind of tax, eg. `VAT`.
     */
    @XmlElement('TypeCode')
    @Property.string()
    typeCode!: string;

    /**
     * Why the tax does not apply, for an exempt category.
     */
    @XmlElement('ExemptionReason')
    @Property.string({ required: false })
    exemptionReason?: string;

    /**
     * What the tax is calculated on, for everything taxed at this rate.
     */
    @XmlElement('BasisAmount')
    @Property.string({ required: false })
    basisAmount?: string;

    /**
     * The category of the tax.
     */
    @XmlElement('CategoryCode')
    @Property.string()
    categoryCode!: string;

    /**
     * The rate, in percent.
     */
    @XmlElement('RateApplicablePercent')
    @Property.string()
    rateApplicablePercent!: string;
}