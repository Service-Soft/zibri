import { parseBoolean } from './parse-boolean.function.ts';
import { parseDate } from './parse-date.function.ts';
import { parseNumber } from './parse-number.function.ts';
import { parseObject } from './parse-object.function.ts';
import { parseOneOf } from './parse-one-of.function.ts';
import { parseString } from './parse-string.function.ts';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model.ts';
import { ArrayParamItemMetadata } from '../../routing/models/array-param-metadata.model.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
export function parseArray(
    rawValue: unknown,
    itemMetadata: ArrayPropertyItemMetadata | ArrayParamItemMetadata
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

    if (!Array.isArray(simpleParsedValue)) {
        return simpleParsedValue;
    }

    for (let i: number = 0; i < simpleParsedValue.length; i++) {
        switch (itemMetadata.type) {
            case 'string': {
                simpleParsedValue[i] = parseString(simpleParsedValue[i]);
                break;
            }
            case 'number': {
                simpleParsedValue[i] = parseNumber(simpleParsedValue[i], itemMetadata.format);
                break;
            }
            case 'boolean': {
                simpleParsedValue[i] = parseBoolean(simpleParsedValue[i]);
                break;
            }
            case 'object': {
                simpleParsedValue[i] = parseObject(simpleParsedValue[i], itemMetadata.cls());
                break;
            }
            case 'array': {
                simpleParsedValue[i] = parseArray(simpleParsedValue[i], itemMetadata.items);
                break;
            }
            case 'date': {
                simpleParsedValue[i] = parseDate(simpleParsedValue[i]);
                break;
            }
            case 'oneOf': {
                simpleParsedValue[i] = parseOneOf(simpleParsedValue[i], itemMetadata);
                break;
            }
            case 'file':
            case 'unknown': {
                break;
            }
        }
    }

    return simpleParsedValue;
}