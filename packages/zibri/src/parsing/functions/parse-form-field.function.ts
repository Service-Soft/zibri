import { parseArray } from './parse-array.function.ts';
import { parseBoolean } from './parse-boolean.function.ts';
import { parseDate } from './parse-date.function.ts';
import { parseNumber } from './parse-number.function.ts';
import { parseObject } from './parse-object.function.ts';
import { parseOneOf } from './parse-one-of.function.ts';
import { parseString } from './parse-string.function.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { RelationType } from '../../entity/models/relation-type.enum.ts';

/**
 * Reads the text of a form field as the property it fills.
 * @param value - The text the field carried, or the texts of a field that was sent more than once.
 * @param property - The property, or undefined when the model does not declare one of that name.
 * @returns The value of the property.
 */
export function parseFormField(value: string | string[], property: PropertyMetadata | undefined): unknown {
    if (property == undefined) {
        // a field the model does not declare. Kept as it arrived, which lets validation report it as an
        // unknown key instead of reading a type off nothing
        return value;
    }
    if (Array.isArray(value)) {
        // a field sent once per item, which is how a form sends a list: each one is an item
        return property.type === 'array' ? value.map(item => parseFormField(item, property.items)) : value;
    }
    switch (property.type) {
        case 'string': {
            return parseString(value);
        }
        case 'number': {
            return parseNumber(value, property.format);
        }
        case 'boolean': {
            return parseBoolean(value);
        }
        case 'object': {
            return parseObject(value, property.cls());
        }
        case 'array': {
            const parsed: unknown = parseArray(value, property.items);
            // a field sent once is a list of one item, which is how a form sends a list holding one
            return Array.isArray(parsed) ? parsed : [parseFormField(value, property.items)];
        }
        case 'date': {
            return parseDate(value);
        }
        case 'oneOf': {
            return parseOneOf(value, property);
        }
        case RelationType.HAS_ONE:
        case RelationType.BELONGS_TO_ONE:
        case RelationType.ONE_TO_MANY:
        case RelationType.MANY_TO_ONE:
        case RelationType.MANY_TO_MANY:
        case 'file':
        case 'unknown': {
            return value;
        }
    }
}