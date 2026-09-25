import { parseArray } from './parse-array.function';
import { parseBoolean } from './parse-boolean.function';
import { parseDate } from './parse-date.function';
import { parseNumber } from './parse-number.function';
import { parseOneOf } from './parse-one-of.function';
import { parseString } from './parse-string.function';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { Relation } from '../../entity/models/relation.enum';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

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
            simpleParsedValue = JsonUtilities.parse(rawValue);
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
        // only what the payload carries, decided on the key being there rather than on what it
        // holds - so a value set to null or written out as undefined still comes through. Assigning
        // every declared property gave a partial body a key for each one the caller left out, and a
        // key that exists cannot be told from one that was sent: anything asking which columns a
        // change touches was told it touches all of them.
        if (!(propertyKey in res)) {
            continue;
        }
        switch (m.type) {
            case 'string': {
                res[propertyKey] = parseString(res[propertyKey]);
                break;
            }
            case 'number': {
                res[propertyKey] = parseNumber(res[propertyKey], m.format);
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
                res[propertyKey] = parseArray(res[propertyKey], m.items);
                break;
            }
            case 'oneOf': {
                res[propertyKey] = parseOneOf(res[propertyKey], m);
                break;
            }
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
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