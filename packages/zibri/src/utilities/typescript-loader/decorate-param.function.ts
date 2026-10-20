/**
 * A legacy parameter decorator.
 */
type ParameterDecorator = (target: object, key: string | symbol | undefined, index: number) => void;

/**
 * Turns a parameter decorator into one that is applied like a member decorator, the way
 * TypeScript's own emit does.
 * @param index - The position of the decorated parameter.
 * @param decorator - The parameter decorator.
 * @returns A decorator that calls it with that position.
 */
function decorateParam(index: number, decorator: ParameterDecorator): (target: object, key?: string | symbol) => undefined {
    return (target, key) => {
        decorator(target, key, index);
        return undefined;
    };
}

// the transformed code imports this as a default export from an es module and requires it from a
// commonjs one, where `require` of an es module hands back the export named "module.exports"
// oxlint-disable-next-line jsdoc-js/require-jsdoc
export { decorateParam as default, decorateParam as 'module.exports' };
