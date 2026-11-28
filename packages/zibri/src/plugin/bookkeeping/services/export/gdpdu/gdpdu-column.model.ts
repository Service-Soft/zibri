import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';
import { GdpduDate } from './gdpdu-date.model';
import { GdpduEmpty } from './gdpdu-empty.model';
import { GdpduNumeric } from './gdpdu-numeric.model';

/**
 * A column of a table of the description standard, as a `VariableColumn` or a `VariablePrimaryKey`: its name, what
 * it holds, and exactly one of its kinds of value.
 */
export class GdpduColumn {
    /**
     * The name of the column, as its header names it.
     */
    @XmlElement('Name')
    @Property.string()
    name!: string;

    /**
     * What the column holds.
     */
    @XmlElement('Description')
    @Property.string()
    description!: string;

    /**
     * Set for a column of numbers.
     */
    @XmlElement('Numeric')
    @Property.object({ cls: () => GdpduNumeric, required: false })
    numeric?: GdpduNumeric;

    /**
     * Set for a column of text.
     */
    @XmlElement('AlphaNumeric')
    @Property.object({ cls: () => GdpduEmpty, required: false })
    alphaNumeric?: GdpduEmpty;

    /**
     * Set for a column of days.
     */
    @XmlElement('Date')
    @Property.object({ cls: () => GdpduDate, required: false })
    date?: GdpduDate;
}
