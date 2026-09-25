import { XliffSegment } from './xliff-segment.model';
import { Property } from '../../../entity/decorators/property.decorator';
import { XmlAttribute } from '../../../parsing/xml/xml-attribute.decorator';

/**
 * One translation string, with its translation when there is one.
 */
export class XliffTransUnit {
    /**
     * The string as it is written in the source code, which is what it is looked up by.
     */
    @XmlAttribute()
    @Property.string()
    id!: string;

    /**
     * How whitespace in the string is treated: `preserve` keeps every space as it is.
     */
    @XmlAttribute('xml:space')
    @Property.string({ required: false })
    space?: string;

    /**
     * The string.
     */
    @Property.object({ cls: () => XliffSegment })
    source!: XliffSegment;

    /**
     * Its translation, once there is one.
     */
    @Property.object({ cls: () => XliffSegment, required: false })
    target?: XliffSegment;

    /**
     * Where the string is used, as `file:line`, separated by `, `.
     */
    @Property.string({ required: false })
    note?: string;
}