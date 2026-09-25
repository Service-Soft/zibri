import { CiiAmount } from './cii-amount.model';
import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * The totals of the invoice.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiHeaderMonetarySummation {
    /**
     * The sum of the lines, before tax.
     */
    @XmlElement('LineTotalAmount')
    @Property.string()
    lineTotalAmount!: string;

    /**
     * What tax is calculated on.
     */
    @XmlElement('TaxBasisTotalAmount')
    @Property.string()
    taxBasisTotalAmount!: string;

    /**
     * The tax, in the currency of the invoice.
     */
    @XmlElement('TaxTotalAmount')
    @Property.object({ cls: () => CiiAmount })
    taxTotalAmount!: CiiAmount;

    /**
     * The total, after tax.
     */
    @XmlElement('GrandTotalAmount')
    @Property.string()
    grandTotalAmount!: string;

    /**
     * What is left to pay.
     */
    @XmlElement('DuePayableAmount')
    @Property.string()
    duePayableAmount!: string;
}