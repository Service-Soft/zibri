import { Property } from '../../../entity/decorators/property.decorator.ts';
import { XmlAttribute } from '../../../parsing/xml/xml-attribute.decorator.ts';

/**
 * A placeholder inside a translation string, `<x id="name" equiv-text="{name}"/>`, which a translator moves but
 * does not translate.
 */
export class XliffPlaceholder {
    /**
     * The name of the placeholder.
     */
    @XmlAttribute()
    @Property.string()
    id!: string;

    /**
     * How the placeholder is written in the string, shown to a translator in its place.
     */
    @XmlAttribute('equiv-text')
    @Property.string({ required: false })
    equivText?: string;
}