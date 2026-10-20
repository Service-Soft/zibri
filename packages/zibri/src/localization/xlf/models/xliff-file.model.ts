import { XliffBody } from './xliff-body.model.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { XmlAttribute } from '../../../parsing/xml/xml-attribute.decorator.ts';

/**
 * The translation strings of one origin in one language.
 */
export class XliffFile {
    /**
     * The language the strings are written in.
     */
    @XmlAttribute('source-language')
    @Property.string()
    sourceLanguage!: string;

    /**
     * The language they are translated into, in a file of translations.
     */
    @XmlAttribute('target-language')
    @Property.string({ required: false })
    targetLanguage?: string;

    /**
     * What kind of text the strings are.
     */
    @XmlAttribute()
    @Property.string()
    datatype!: string;

    /**
     * Where the strings come from, eg. `zibri` or `project`.
     */
    @XmlAttribute()
    @Property.string()
    original!: string;

    /**
     * The strings.
     */
    @Property.object({ cls: () => XliffBody, allowAdditionalProperties: true })
    body!: XliffBody;
}