/**
 * Writes a value as json that can be placed inside an inline `<script>`.
 *
 * Every `<` is written as `<`, which is the same character to javascript and no character to
 * the html parser: a string holding `</script>` in any spelling, or `<!--`, cannot end the element or
 * change how it is read. The line and paragraph separators are escaped as well, which json allows
 * and older javascript does not inside a string.
 * @param value - The value.
 * @returns The javascript source of the value.
 */
export function toScriptJson(value: unknown): string {
    // undefined for undefined, which json has no form for and javascript does
    const json: string | undefined = JSON.stringify(value);
    if (json === undefined) {
        return 'undefined';
    }
    return json
        .replaceAll('<', String.raw`<`)
        .replaceAll('', String.raw``)
        .replaceAll('', String.raw``);
}