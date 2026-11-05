import { XliffTransUnit } from './xliff-trans-unit.model';
import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * The translation strings of a file.
 */
export class XliffBody {
    /**
     * The translation strings.
     */
    // what a translation tool adds to a string, eg. its context or other translations it suggests, is
    // kept by the tool and of no interest here
    @XmlElement('trans-unit')
    @Property.array({ items: { type: 'object', cls: () => XliffTransUnit, allowAdditionalProperties: true }, required: false })
    units?: XliffTransUnit[];
}