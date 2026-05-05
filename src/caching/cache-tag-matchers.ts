
/**
 * Matcher for a tag.
 */
export type CacheTagMatcher = | string | RegExp | ((tag: string) => boolean);

/**
 * Checks whether the given matchers match any of the given tags.
 * @param matchers - The matchers used for the check.
 * @param tags - The tags to check.
 * @returns True if any of the tags are matched by at least one of the matchers, false otherwise.
 */
export function matchesAnyTag(matchers: readonly CacheTagMatcher[], tags: string[]): boolean {
    return matchers.some(matcher => tags.some(tag => matchesTag(matcher, tag)));
}

/**
 * Checks whether or not the given matcher matches the given tag.
 * @param matcher - The matcher used for the check.
 * @param tag - The tag to check.
 * @returns True if the matcher matches the tag, false otherwise.
 */
export function matchesTag(matcher: CacheTagMatcher, tag: string): boolean {
    if (typeof matcher === 'string') {
        return matcher === tag;
    }
    if (matcher instanceof RegExp) {
        return matcher.test(tag);
    }
    return matcher(tag);
}