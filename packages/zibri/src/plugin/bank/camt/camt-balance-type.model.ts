import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtCode } from './camt-code.model';

/**
 * Which balance of a CAMT.053 statement a balance is, such as its opening or closing balance.
 */
export class CamtBalanceType {
    /**
     * The code of the balance.
     */
    @XmlElement('CdOrPrtry')
    @Property.object({ cls: () => CamtCode, allowAdditionalProperties: true })
    codeOrProprietary!: CamtCode;
}