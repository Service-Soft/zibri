import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';
import { GdpduAlias } from './gdpdu-alias.model';

/**
 * A foreign key of a table of the description standard: its columns, the table they reference, and the columns
 * there.
 */
export class GdpduForeignKey {
    /**
     * The columns of the key.
     */
    @XmlElement('Name')
    @Property.array({ items: { type: 'string' } })
    names!: string[];

    /**
     * The name of the table it references.
     */
    @XmlElement('References')
    @Property.string()
    references!: string;

    /**
     * The column of that table each column of the key references.
     */
    @XmlElement('Alias')
    @Property.array({ items: { type: 'object', cls: () => GdpduAlias } })
    aliases!: GdpduAlias[];
}
