/**
 * A kind of token a highlighted code block tells apart. Its span has the class `shiki-token-` followed by the kind,
 * such as `shiki-token-keyword`.
 */
export type CodeTokenKind
    = | 'keyword'
        | 'keyword-control'
        | 'type'
        | 'function'
        | 'variable'
        | 'constant'
        | 'number'
        | 'string'
        | 'regexp'
        | 'regexp-constant'
        | 'escape'
        | 'comment'
        | 'tag-punctuation'
        | 'list-marker'
        | 'label'
        | 'invalid'
        | 'header';

/**
 * The kinds of token, each with the color VS Code's Dark+ theme gives it: the kinds are the ones that theme tells
 * apart, so a stylesheet giving each class this color shows code as VS Code does. A token Dark+ shows in the color of
 * plain text has no class.
 */
export const CODE_TOKEN_KIND_COLORS: Readonly<Record<CodeTokenKind, string>> = {
    // storage such as `const`, other keywords, `this`, `true`, and the tags of html
    keyword: '#569cd6',
    // `import`, `return`, `if` and the other keywords of control flow
    'keyword-control': '#c586c0',
    // classes, interfaces and other types
    type: '#4ec9b0',
    function: '#dcdcaa',
    // variables, parameters, properties, keys of an object, and the attributes of html
    variable: '#9cdcfe',
    // constants such as `MAX_SIZE`, and the members of an enum
    constant: '#4fc1ff',
    number: '#b5cea8',
    string: '#ce9178',
    regexp: '#d16969',
    'regexp-constant': '#646695',
    // escapes in a string, such as `\n`, and the selectors of css
    escape: '#d7ba7d',
    comment: '#6a9955',
    // the `<` and `>` around a tag
    'tag-punctuation': '#808080',
    // the marker of an item of a list in markdown
    'list-marker': '#6796e6',
    label: '#c8c8c8',
    invalid: '#f44747',
    header: '#000080'
};