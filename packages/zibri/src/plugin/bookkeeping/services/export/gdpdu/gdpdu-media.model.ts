import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';
import { GdpduTable } from './gdpdu-table.model';

/**
 * A medium of the description standard: the folder of `index.xml` with the tables it describes.
 */
export class GdpduMedia {
    /**
     * The name of the medium, such as the fiscal year it holds.
     */
    @XmlElement('Name')
    @Property.string()
    name!: string;

    /**
     * Its tables.
     */
    @XmlElement('Table')
    @Property.array({ items: { type: 'object', cls: () => GdpduTable } })
    tables!: GdpduTable[];
}