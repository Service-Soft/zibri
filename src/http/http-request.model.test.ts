import { describe, expect, it } from '@jest/globals';

import { isHttpRequest } from './http-request.model';

describe('isHttpRequest', () => {
    it('returns true for an object with the expected http request shape', () => {
        expect(isHttpRequest({ params: {}, query: {}, headers: {}, httpVersion: '1.1' })).toBe(true);
    });

    it('returns false for null and undefined', () => {
        // eslint-disable-next-line unicorn/no-null
        expect(isHttpRequest(null)).toBe(false);
        expect(isHttpRequest(undefined)).toBe(false);
    });

    it('returns false for a non-object value', () => {
        expect(isHttpRequest('a string')).toBe(false);
        expect(isHttpRequest(42)).toBe(false);
    });

    it('returns false when any of the required keys is missing', () => {
        expect(isHttpRequest({ query: {}, headers: {}, httpVersion: '1.1' })).toBe(false);
        expect(isHttpRequest({ params: {}, headers: {}, httpVersion: '1.1' })).toBe(false);
        expect(isHttpRequest({ params: {}, query: {}, httpVersion: '1.1' })).toBe(false);
        expect(isHttpRequest({ params: {}, query: {}, headers: {} })).toBe(false);
    });

    it('returns false for a websocket-request-like object without httpVersion', () => {
        expect(isHttpRequest({ params: {}, query: {}, headers: {} })).toBe(false);
    });
});