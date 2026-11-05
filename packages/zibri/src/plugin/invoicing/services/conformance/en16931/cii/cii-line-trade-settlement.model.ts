import { CiiLineMonetarySummation } from './cii-line-monetary-summation.model';
import { CiiNamespace } from './cii-namespace.enum';
import { CiiTradeTax } from './cii-trade-tax.model';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * How a line is settled.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiLineTradeSettlement {
    /**
     * The tax the line is taxed with.
     */
    @XmlElement('ApplicableTradeTax')
    @Property.object({ cls: () => CiiTradeTax })
    tax!: CiiTradeTax;

    /**
     * The total of the line.
     */
    @XmlElement('SpecifiedTradeSettlementLineMonetarySummation')
    @Property.object({ cls: () => CiiLineMonetarySummation })
    summation!: CiiLineMonetarySummation;
}