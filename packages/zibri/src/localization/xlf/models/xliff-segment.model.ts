import { XliffPlaceholder } from './xliff-placeholder.model.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OneOf } from '../../../entity/models/one-of.model.ts';
import { XmlMixed } from '../../../parsing/xml/xml-mixed.decorator.ts';

/**
 * What a part of a translation string can be.
 */
type XliffSegmentShapes = {
    /**
     * A piece of text.
     */
    text: string,
    /**
     * A placeholder.
     */
    x: XliffPlaceholder
};

/**
 * The text of a translation string and the placeholders in it, in order: a `<source>` or a `<target>`.
 */
export class XliffSegment {
    /**
     * The pieces of text and the placeholders between them.
     */
    @XmlMixed()
    @Property.array({
        items: {
            type: 'oneOf',
            shapes: {
                text: { type: 'string' },
                x: { type: 'object', cls: () => XliffPlaceholder }
            }
        }
    })
    parts!: OneOf<XliffSegmentShapes>[];
}