import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtCode } from './camt-code.model';

/**
 * An identifier of a party in a CAMT.053 statement, of the scheme it names, such as a SEPA creditor identifier.
 */
export class CamtGenericId {
    /**
     * The identifier.
     */
    @XmlElement('Id')
    @Property.string()
    id!: string;

    /**
     * The scheme of the identifier, `SEPA` for a creditor identifier.
     */
    @XmlElement('SchmeNm')
    @Property.object({ cls: () => CamtCode, required: false, allowAdditionalProperties: true })
    schemeName?: CamtCode;
}