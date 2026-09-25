import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlAttribute } from '../../../../../../parsing/xml/xml-attribute.decorator';
import { XmlText } from '../../../../../../parsing/xml/xml-text.decorator';

/**
 * An id, with the scheme it belongs to when it names one, eg. `EM` for an email address.
 */
export class CiiSchemedId {
    /**
     * The scheme of the id.
     */
    @XmlAttribute('schemeID')
    @Property.string({ required: false })
    schemeId?: string;

    /**
     * The id.
     */
    @XmlText()
    @Property.string()
    value!: string;
}