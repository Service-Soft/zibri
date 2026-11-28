import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';
import { XmlRoot } from '../../../../../parsing/xml/xml-root.decorator';
import { GdpduDataSupplier } from './gdpdu-data-supplier.model';
import { GdpduMedia } from './gdpdu-media.model';

/**
 * The `index.xml` of the description standard for the data handed over in a German tax audit
 * (Beschreibungsstandard für die Datenüberlassung), which `gdpdu-01-09-2004.dtd` defines.
 */
@XmlRoot({ name: 'DataSet' })
export class GdpduDataSet {
    /**
     * The version of the description, `1.0`.
     */
    @XmlElement('Version')
    @Property.string()
    version!: string;

    /**
     * Who supplies the data.
     */
    @XmlElement('DataSupplier')
    @Property.object({ cls: () => GdpduDataSupplier })
    dataSupplier!: GdpduDataSupplier;

    /**
     * The media, one.
     */
    @XmlElement('Media')
    @Property.array({ items: { type: 'object', cls: () => GdpduMedia } })
    media!: GdpduMedia[];
}
