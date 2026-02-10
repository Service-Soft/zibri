
import { parseArray } from './parse-array.function';
import { parseBoolean } from './parse-boolean.function';
import { parseDate } from './parse-date.function';
import { parseNumber } from './parse-number.function';
import { parseString } from './parse-string.function';
import { PropertyMetadata, Relation } from '../../entity';
import { Newable } from '../../types';
import { MetadataUtilities, ObjectUtilities } from '../../utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
export function parseObject(
    rawValue: unknown,
    cls: Newable<unknown>
): unknown {
    if (rawValue == undefined) {
        return rawValue;
    }

    let simpleParsedValue: unknown = rawValue;
    try {
        if (typeof rawValue === 'string') {
            simpleParsedValue = JSON.parse(rawValue);
        }
    }
    catch {
        return simpleParsedValue;
    }

    if (typeof simpleParsedValue !== 'object' || simpleParsedValue === null) {
        return simpleParsedValue;
    }

    const res: Record<string, unknown> = simpleParsedValue as Record<string, unknown>;
    const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);

    for (const [propertyKey, m] of ObjectUtilities.entries(properties)) {
        switch (m.type) {
            case 'string': {
                res[propertyKey] = parseString(res[propertyKey]);
                break;
            }
            case 'number': {
                res[propertyKey] = parseNumber(res[propertyKey]);
                break;
            }
            case 'boolean': {
                res[propertyKey] = parseBoolean(res[propertyKey]);
                break;
            }
            case 'object': {
                res[propertyKey] = parseObject(res[propertyKey], m.cls());
                break;
            }
            case 'date': {
                res[propertyKey] = parseDate(res[propertyKey]);
                break;
            }
            case 'array': {
                res[propertyKey] = parseArray(res[propertyKey], m);
                break;
            }
            case Relation.ONE_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY:
            case 'file':
            case 'unknown': {
                break;
            }
        }
    }

    return res;
}