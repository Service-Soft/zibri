import { describe, expect, it, jest } from '@jest/globals';

import { CacheTagMatcher, matchesAnyTag, matchesTag } from './cache-tag-matchers';

describe('matchesTag', () => {
    it('matches exact string tags', () => {
        expect(matchesTag('user:1', 'user:1')).toBe(true);
        expect(matchesTag('user:1', 'user:2')).toBe(false);
    });

    it('matches regex tags', () => {
        expect(matchesTag(/^user:\d+$/, 'user:1')).toBe(true);
        expect(matchesTag(/^user:\d+$/, 'profile:1')).toBe(false);
    });

    it('matches predicate tags', () => {
        const matcher: CacheTagMatcher = (tag: string): boolean => tag.startsWith('user:');
        expect(matchesTag(matcher, 'user:1')).toBe(true);
        expect(matchesTag(matcher, 'profile:1')).toBe(false);
    });

    it('supports broad regex matches', () => {
        expect(matchesTag(/.*/, 'anything')).toBe(true);
    });

    it('regex matching is case sensitive by default', () => {
        expect(matchesTag(/^user$/, 'User')).toBe(false);
    });

    it('predicate matchers receive the exact tag string', () => {
        const matcher: CacheTagMatcher = jest.fn((tag: string): boolean => tag === 'abc');
        expect(matchesTag(matcher, 'abc')).toBe(true);
        expect(matcher).toHaveBeenCalledTimes(1);
        expect(matcher).toHaveBeenCalledWith('abc');
    });
});

describe('matchesAnyTag', () => {
    it('returns true when at least one matcher matches at least one tag', () => {
        const matchers: CacheTagMatcher[] = ['foo', /^bar$/, (tag: string): boolean => tag === 'baz'] as const;
        const tags: string[] = ['nope', 'baz'];

        expect(matchesAnyTag(matchers, tags)).toBe(true);
    });

    it('returns false when no matcher matches any tag', () => {
        const matchers: CacheTagMatcher[] = ['foo', /^bar$/, (tag: string): boolean => tag === 'baz'] as const;
        const tags: string[] = ['nope', 'also-nope'];

        expect(matchesAnyTag(matchers, tags)).toBe(false);
    });

    it('returns true for a single string match', () => {
        expect(matchesAnyTag(['user:1'], ['x', 'user:1', 'y'])).toBe(true);
    });

    it('returns true for a single regex match', () => {
        expect(matchesAnyTag([/^user:\d+$/], ['profile:1', 'user:42'])).toBe(true);
    });

    it('returns true for a single predicate match', () => {
        expect(matchesAnyTag([(tag: string): boolean => tag.endsWith(':write')], ['cache:read', 'cache:write'])).toBe(true);
    });

    it('returns false for empty matcher list', () => {
        expect(matchesAnyTag([], ['a', 'b'])).toBe(false);
    });

    it('returns false for empty tag list', () => {
        expect(matchesAnyTag(['a', /b/, (tag: string): boolean => tag === 'c'], [])).toBe(false);
    });

    it('short-circuits once a match is found', () => {
        const matcher1: CacheTagMatcher = jest.fn((tag: string): boolean => tag === 'match');
        const matcher2: CacheTagMatcher = jest.fn((): boolean => true);

        expect(matchesAnyTag([matcher1, matcher2], ['match'])).toBe(true);
        expect(matcher1).toHaveBeenCalledTimes(1);
        expect(matcher2).not.toHaveBeenCalled();
    });

    it('checks tags against all matchers until one succeeds', () => {
        const matcher1: CacheTagMatcher = jest.fn((tag: string): boolean => tag === 'nope');
        const matcher2: CacheTagMatcher = jest.fn((tag: string): boolean => tag === 'match');

        expect(matchesAnyTag([matcher1, matcher2], ['a', 'match'])).toBe(true);
        expect(matcher1).toHaveBeenCalled();
        expect(matcher2).toHaveBeenCalled();
    });

    it('handles duplicate tags without issue', () => {
        expect(matchesAnyTag(['x'], ['a', 'x', 'x'])).toBe(true);
    });

    it('handles duplicate matchers without issue', () => {
        const matcher: CacheTagMatcher = jest.fn((tag: string): boolean => tag === 'x');

        expect(matchesAnyTag([matcher, matcher], ['x'])).toBe(true);
        expect(matcher).toHaveBeenCalledTimes(1);
    });

    it('does not mutate matchers or tags', () => {
        const matchers: CacheTagMatcher[] = ['x', /y/];
        const tags: string[] = ['x', 'y'];

        const matchersBefore: CacheTagMatcher[] = [...matchers];
        const tagsBefore: string[] = [...tags];

        matchesAnyTag(matchers, tags);

        expect(matchers).toEqual(matchersBefore);
        expect(tags).toEqual(tagsBefore);
    });
});