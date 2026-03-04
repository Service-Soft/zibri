import { parseBoolean } from './parse-boolean.function';
import { parseDate } from './parse-date.function';
import { parseNumber } from './parse-number.function';
import { parseObject } from './parse-object.function';
import { parseString } from './parse-string.function';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model';
import { ArrayParamItemMetadata } from '../../routing/models/array-param-metadata.model';

// eslint-disable-next-line jsdoc/require-jsdoc
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
            simpleParsedValue = JSON.parse(rawValue);
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
                simpleParsedValue[i] = parseNumber(simpleParsedValue[i]);
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
            case 'file':
            case 'unknown': {
                break;
            }
        }
    }

    return simpleParsedValue;
}