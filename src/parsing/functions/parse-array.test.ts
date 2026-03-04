/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseArray } from './parse-array.function';
import { ArrayParamMetadata } from '../../routing/models/array-param-metadata.model';

describe('parseArray', () => {
    const meta: ArrayParamMetadata = {
        name: 'foo',
        type: 'array',
        items: {
            type: 'string',
            required: true,
            description: undefined,
            format: undefined,
            unique: false,
            maxLength: undefined,
            minLength: undefined,
            regex: undefined,
            enum: undefined
        },
        required: true,
        description: undefined,
        totalMaxSize: '100kb'
    };

    it('returns undefined for undefined input', () => {
        expect(parseArray(undefined, meta)).toBeUndefined();
    });

    it('returns null for null input', () => {
        expect(parseArray(null, meta)).toBeNull();
    });

    it('returns value as-is if not a string', () => {
        const input: number = 42;
        expect(parseArray(input, meta)).toBe(input);
    });

    it('parses valid JSON string', () => {
        expect(parseArray('["a", "b"]', meta)).toEqual(['a', 'b']);
    });

    it('parses invalid json', () => {
        expect(parseArray('[invalid]', meta)).toEqual('[invalid]');
    });
});