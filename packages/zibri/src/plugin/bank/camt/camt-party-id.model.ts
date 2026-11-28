import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtPersonId } from './camt-person-id.model';

/**
 * What identifies a party in a CAMT.053 statement.
 */
export class CamtPartyId {
    /**
     * The identifiers that are not those of an organization, where a creditor identifier is.
     */
    @XmlElement('PrvtId')
    @Property.object({ cls: () => CamtPersonId, required: false, allowAdditionalProperties: true })
    person?: CamtPersonId;
}