import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';
import { GdpduColumn } from './gdpdu-column.model';
import { GdpduForeignKey } from './gdpdu-foreign-key.model';

/**
 * How the records of a table of the description standard are laid out, as delimited text: the column delimiter, the
 * character text is enclosed in, the columns and the foreign keys. The records end with CRLF, which the standard
 * takes by default.
 */
export class GdpduVariableLength {
    /**
     * What separates the values of a record, `;`.
     */
    @XmlElement('ColumnDelimiter')
    @Property.string()
    columnDelimiter!: string;

    /**
     * What a text is enclosed in, `"`.
     */
    @XmlElement('TextEncapsulator')
    @Property.string()
    textEncapsulator!: string;

    /**
     * The columns identifying a record, first.
     */
    @XmlElement('VariablePrimaryKey')
    @Property.array({ items: { type: 'object', cls: () => GdpduColumn } })
    primaryKeys!: GdpduColumn[];

    /**
     * The other columns, in their order after the primary key.
     */
    @XmlElement('VariableColumn')
    @Property.array({ items: { type: 'object', cls: () => GdpduColumn } })
    columns!: GdpduColumn[];

    /**
     * The columns referencing other tables.
     */
    @XmlElement('ForeignKey')
    @Property.array({ items: { type: 'object', cls: () => GdpduForeignKey } })
    foreignKeys!: GdpduForeignKey[];
}
