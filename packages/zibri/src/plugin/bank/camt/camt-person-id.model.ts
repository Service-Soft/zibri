import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtGenericId } from './camt-generic-id.model';

/**
 * The identifiers of a party in a CAMT.053 statement that are not those of an organization.
 */
export class CamtPersonId {
    /**
     * The identifiers, each of the scheme it names.
     */
    @XmlElement('Othr')
    @Property.array({ items: { type: 'object', cls: () => CamtGenericId, allowAdditionalProperties: true }, required: false })
    others?: CamtGenericId[];
}