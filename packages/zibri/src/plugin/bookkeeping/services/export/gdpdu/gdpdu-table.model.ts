import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';
import { GdpduEmpty } from './gdpdu-empty.model';
import { GdpduRange } from './gdpdu-range.model';
import { GdpduValidity } from './gdpdu-validity.model';
import { GdpduVariableLength } from './gdpdu-variable-length.model';

/**
 * A table of the description standard: its file, name and description, the days it is valid for, its encoding, how
 * its numbers are written, the record it is read from, and its layout.
 */
export class GdpduTable {
    /**
     * The file of the table, relative to the folder of `index.xml`, such as `journal-entries.csv`.
     */
    @XmlElement('URL')
    @Property.string()
    url!: string;

    /**
     * The name of the table, which foreign keys reference it by.
     */
    @XmlElement('Name')
    @Property.string()
    name!: string;

    /**
     * What the table holds.
     */
    @XmlElement('Description')
    @Property.string()
    description!: string;

    /**
     * The first and the last day of the fiscal year.
     */
    @XmlElement('Validity')
    @Property.object({ cls: () => GdpduValidity })
    validity!: GdpduValidity;

    /**
     * Set for a file in UTF-8.
     */
    @XmlElement('UTF8')
    @Property.object({ cls: () => GdpduEmpty })
    utf8!: GdpduEmpty;

    /**
     * The decimal symbol of its numbers, `,`.
     */
    @XmlElement('DecimalSymbol')
    @Property.string()
    decimalSymbol!: string;

    /**
     * The symbol grouping the digits of its numbers, `.`, which the numbers of the export are written without.
     */
    @XmlElement('DigitGroupingSymbol')
    @Property.string()
    digitGroupingSymbol!: string;

    /**
     * The record the table is read from: the one after its header.
     */
    @XmlElement('Range')
    @Property.object({ cls: () => GdpduRange })
    range!: GdpduRange;

    /**
     * The layout of its records.
     */
    @XmlElement('VariableLength')
    @Property.object({ cls: () => GdpduVariableLength })
    variableLength!: GdpduVariableLength;
}
