import { XliffFile } from './xliff-file.model.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { XmlAttribute } from '../../../parsing/xml/xml-attribute.decorator.ts';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator.ts';
import { XmlRoot } from '../../../parsing/xml/xml-root.decorator.ts';

/**
 * An XLIFF 1.2 document, which holds translation strings and their translations.
 */
@XmlRoot({ name: 'xliff', namespace: 'urn:oasis:names:tc:xliff:document:1.2' })
export class XliffDocument {
    /**
     * The version of XLIFF the document is written in.
     */
    @XmlAttribute()
    @Property.string()
    version!: string;

    /**
     * The files of the document, one per origin and language.
     */
    // a translation tool's header in each file is of no interest here
    @XmlElement('file')
    @Property.array({ items: { type: 'object', cls: () => XliffFile, allowAdditionalProperties: true }, required: false })
    files?: XliffFile[];
}