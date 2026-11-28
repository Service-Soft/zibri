import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtPartyId } from './camt-party-id.model';

/**
 * A party of a transaction in a CAMT.053 statement, such as who paid.
 */
// both versions in one model: `.001.02` names the party itself, `.001.08` wraps it in `Pty`
export class CamtParty {
    /**
     * The name of the party.
     */
    @XmlElement('Nm')
    @Property.string({ required: false })
    name?: string;

    /**
     * What identifies the party.
     */
    @XmlElement('Id')
    @Property.object({ cls: () => CamtPartyId, required: false, allowAdditionalProperties: true })
    id?: CamtPartyId;

    /**
     * The party, as `.001.08` names it.
     */
    @XmlElement('Pty')
    @Property.object({ cls: () => CamtParty, required: false, allowAdditionalProperties: true })
    party?: CamtParty;
}