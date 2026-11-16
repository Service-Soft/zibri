import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };

import { ApiReferenceUtilities } from './api-reference.utilities';
import { ApiToken } from './api-token.model';
import { REFLECTION_KINDS } from './reflection-kinds';

/**
 * A type kind of typedoc, such as `union`.
 */
type TypeKind = JSONOutput.SomeType['type'];

// the types that need parentheses where they are part of a type binding tighter, such as the element of an array
const LOOSE_IN_POSTFIX: TypeKind[] = ['union', 'intersection', 'conditional', 'typeOperator', 'predicate', 'inferred', 'reflection'];
const LOOSE_IN_UNION: TypeKind[] = ['conditional', 'reflection'];
const LOOSE_IN_INTERSECTION: TypeKind[] = ['union', 'conditional', 'reflection'];

// the intrinsic types the TypeScript grammar colors as keywords, as VS Code does; the rest are types
const KEYWORD_INTRINSICS: string[] = ['null', 'undefined', 'this'];

/**
 * A token of punctuation or blank space, of no kind.
 * @param text - The text.
 * @returns The token.
 */
function plain(text: string): ApiToken {
    return { text };
}

/**
 * A token of a keyword.
 * @param text - The keyword, with the space around it.
 * @returns The token.
 */
function keyword(text: string): ApiToken {
    return { text, kind: 'keyword' };
}

/**
 * Prints types, signatures and declarations of typedoc's json as code, in tokens.
 */
export abstract class ApiTypeUtilities {
    /**
     * The tokens of a type.
     * @param type - The type.
     * @returns The tokens.
     */
    static resolveTypeTokens(type: JSONOutput.SomeType): ApiToken[] {
        switch (type.type) {
            case 'array': {
                return [...this.resolveWrapped(type.elementType, LOOSE_IN_POSTFIX), plain('[]')];
            }
            case 'conditional': {
                return [
                    ...this.resolveTypeTokens(type.checkType),
                    keyword(' extends '),
                    ...this.resolveTypeTokens(type.extendsType),
                    plain(' ? '),
                    ...this.resolveTypeTokens(type.trueType),
                    plain(' : '),
                    ...this.resolveTypeTokens(type.falseType)
                ];
            }
            case 'indexedAccess': {
                return [
                    ...this.resolveWrapped(type.objectType, LOOSE_IN_POSTFIX),
                    plain('['),
                    ...this.resolveTypeTokens(type.indexType),
                    plain(']')
                ];
            }
            case 'inferred': {
                return [
                    keyword('infer '),
                    { text: type.name, kind: 'type' },
                    ...type.constraint == undefined ? [] : [keyword(' extends '), ...this.resolveTypeTokens(type.constraint)]
                ];
            }
            case 'intersection': {
                return this.join(type.types.map(part => this.resolveWrapped(part, LOOSE_IN_INTERSECTION)), ' & ');
            }
            case 'intrinsic': {
                return [{ text: type.name, kind: KEYWORD_INTRINSICS.includes(type.name) ? 'keyword' : 'type' }];
            }
            case 'literal': {
                return [this.resolveLiteralToken(type.value)];
            }
            case 'mapped': {
                return this.resolveMappedTokens(type);
            }
            case 'namedTupleMember': {
                return [
                    { text: type.name, kind: 'variable' },
                    plain(type.isOptional ? '?: ' : ': '),
                    ...this.resolveTypeTokens(type.element)
                ];
            }
            case 'optional': {
                return [...this.resolveWrapped(type.elementType, LOOSE_IN_POSTFIX), plain('?')];
            }
            case 'predicate': {
                return [
                    ...type.asserts ? [keyword('asserts ')] : [],
                    { text: type.name, kind: 'variable' },
                    ...type.targetType == undefined ? [] : [keyword(' is '), ...this.resolveTypeTokens(type.targetType)]
                ];
            }
            case 'query': {
                return [keyword('typeof '), ...this.resolveTypeTokens(type.queryType)];
            }
            case 'reference': {
                return this.resolveReferenceTokens(type);
            }
            case 'reflection': {
                return this.resolveObjectTokens(type.declaration);
            }
            case 'rest': {
                return [plain('...'), ...this.resolveTypeTokens(type.elementType)];
            }
            case 'templateLiteral': {
                return [
                    { text: `\`${type.head}`, kind: 'string' },
                    ...type.tail.flatMap(([part, text]) => [
                        { text: '${', kind: 'keyword' } satisfies ApiToken,
                        ...this.resolveTypeTokens(part),
                        { text: '}', kind: 'keyword' } satisfies ApiToken,
                        { text, kind: 'string' } satisfies ApiToken
                    ]),
                    { text: '`', kind: 'string' }
                ];
            }
            case 'tuple': {
                return [plain('['), ...this.join((type.elements ?? []).map(element => this.resolveTypeTokens(element)), ', '), plain(']')];
            }
            case 'typeOperator': {
                return [keyword(`${type.operator} `), ...this.resolveWrapped(type.target, LOOSE_IN_POSTFIX)];
            }
            case 'union': {
                return this.join(type.types.map(part => this.resolveWrapped(part, LOOSE_IN_UNION)), ' | ');
            }
            case 'unknown': {
                return [plain(type.name)];
            }
        }
    }

    /**
     * The tokens of a signature, without the keyword in front of it.
     * @param signature - The signature.
     * @param name - The name it is called by, or undefined for one that has none, such as the type of a callback.
     * @param arrow - Whether it is the type of a function, `(a: A) => R`, rather than a declared one, `f(a: A): R`.
     * @returns The tokens.
     */
    static resolveSignatureTokens(signature: JSONOutput.SignatureReflection, name: string | undefined, arrow: boolean): ApiToken[] {
        return [
            ...name == undefined ? [] : [{ text: name, kind: 'function' } satisfies ApiToken],
            ...this.resolveTypeParameterTokens(signature.typeParameters),
            plain('('),
            ...this.join((signature.parameters ?? []).map(parameter => this.resolveParameterTokens(parameter)), ', '),
            plain(arrow ? ') => ' : '): '),
            ...signature.type == undefined ? [{ text: 'void', kind: 'type' } satisfies ApiToken] : this.resolveTypeTokens(signature.type)
        ];
    }

    /**
     * The tokens of the type parameters of a declaration or a signature.
     * @param typeParameters - The type parameters.
     * @returns The tokens, none for none.
     */
    static resolveTypeParameterTokens(typeParameters: JSONOutput.TypeParameterReflection[] | undefined): ApiToken[] {
        if (!typeParameters?.length) {
            return [];
        }
        return [
            plain('<'),
            ...this.join(typeParameters.map(parameter => [
                { text: parameter.name, kind: 'type' } satisfies ApiToken,
                ...parameter.type == undefined ? [] : [keyword(' extends '), ...this.resolveTypeTokens(parameter.type)],
                ...parameter.default == undefined ? [] : [plain(' = '), ...this.resolveTypeTokens(parameter.default)]
            ]), ', '),
            plain('>')
        ];
    }

    /**
     * The tokens of an export as it is declared: each signature of a function on a line of its own, and the members of
     * the object a type or a variable is each on a line of its own.
     * @param declaration - The declaration of the export.
     * @returns The lines.
     */
    static resolveDeclarationLines(declaration: JSONOutput.DeclarationReflection): ApiToken[][] {
        const typeParameters: ApiToken[] = this.resolveTypeParameterTokens(declaration.typeParameters);
        const name: ApiToken = { text: declaration.name, kind: 'type' };
        if (declaration.kind === REFLECTION_KINDS.Class) {
            return [
                [
                    ...declaration.flags.isAbstract === true ? [keyword('abstract ')] : [],
                    keyword('class '),
                    name,
                    ...typeParameters,
                    ...this.resolveHeritageTokens(' extends ', declaration.extendedTypes),
                    ...this.resolveHeritageTokens(' implements ', declaration.implementedTypes)
                ]
            ];
        }
        if (declaration.kind === REFLECTION_KINDS.Interface) {
            const heritage: ApiToken[] = this.resolveHeritageTokens(' extends ', declaration.extendedTypes);
            return [[keyword('interface '), name, ...typeParameters, ...heritage]];
        }
        if (declaration.kind === REFLECTION_KINDS.TypeAlias) {
            return this.resolveTypedLines([keyword('type '), name, ...typeParameters, plain(' = ')], declaration.type);
        }
        if (declaration.kind === REFLECTION_KINDS.Variable) {
            const isConst: boolean = declaration.flags.isConst === true;
            const variable: ApiToken = { text: declaration.name, kind: isConst ? 'constant' : 'variable' };
            return this.resolveTypedLines([keyword(isConst ? 'const ' : 'let '), variable, plain(': ')], declaration.type);
        }
        if (declaration.kind === REFLECTION_KINDS.Function) {
            return (declaration.signatures ?? [])
                .map(signature => [keyword('function '), ...this.resolveSignatureTokens(signature, declaration.name, false)]);
        }
        return [[keyword(declaration.kind === REFLECTION_KINDS.Enum ? 'enum ' : 'namespace '), name]];
    }

    /**
     * The tokens of a member of a class, an interface or an object, as it is declared: each signature of a method or
     * an accessor on a line of its own.
     * @param member - The member.
     * @returns The lines.
     */
    static resolveMemberLines(member: JSONOutput.DeclarationReflection): ApiToken[][] {
        const modifiers: ApiToken[] = [
            ...member.flags.isStatic === true ? [keyword('static ')] : [],
            ...member.flags.isAbstract === true ? [keyword('abstract ')] : [],
            ...member.flags.isReadonly === true ? [keyword('readonly ')] : []
        ];
        if (member.kind === REFLECTION_KINDS.Constructor) {
            return (member.signatures ?? []).map(signature => [
                keyword('constructor'),
                plain('('),
                ...this.join((signature.parameters ?? []).map(parameter => this.resolveParameterTokens(parameter)), ', '),
                plain(')')
            ]);
        }
        if (member.kind === REFLECTION_KINDS.Accessor) {
            return [
                ...member.getSignature == undefined
                    ? []
                    : [
                        [
                            ...modifiers,
                            keyword('get '),
                            ...this.resolveSignatureTokens(member.getSignature, member.name, false)
                        ]
                    ],
                ...member.setSignature == undefined
                    ? []
                    : [
                        [
                            ...modifiers,
                            keyword('set '),
                            ...this.resolveSignatureTokens(member.setSignature, member.name, false)
                        ]
                    ]
            ];
        }
        if (member.signatures != undefined) {
            return member.signatures.map(signature => [...modifiers, ...this.resolveSignatureTokens(signature, member.name, false)]);
        }
        if (member.kind === REFLECTION_KINDS.EnumMember) {
            const value: ApiToken[] = member.type == undefined ? [] : [plain(' = '), ...this.resolveTypeTokens(member.type)];
            return [[{ text: member.name, kind: 'constant' }, ...value]];
        }
        return [
            [
                ...modifiers,
                { text: member.name, kind: 'variable' },
                plain(member.flags.isOptional === true ? '?: ' : ': '),
                ...member.type == undefined ? [{ text: 'unknown', kind: 'type' } satisfies ApiToken] : this.resolveTypeTokens(member.type)
            ]
        ];
    }

    private static resolveHeritageTokens(keywordText: string, types: JSONOutput.SomeType[] | undefined): ApiToken[] {
        return !types?.length
            ? []
            : [keyword(keywordText), ...this.join(types.map(type => this.resolveTypeTokens(type)), ', ')];
    }

    // what a declaration is of a type follows it: an object with members, each member on a line of its own
    private static resolveTypedLines(start: ApiToken[], type: JSONOutput.SomeType | undefined): ApiToken[][] {
        if (type == undefined) {
            return [[...start, { text: 'unknown', kind: 'type' }]];
        }
        const members: JSONOutput.DeclarationReflection[] | undefined = type.type === 'reflection' ? type.declaration.children : undefined;
        if (members == undefined) {
            return [[...start, ...this.resolveTypeTokens(type)]];
        }
        return [
            [...start, plain('{')],
            ...members.flatMap(member => this.resolveMemberLines(member).map(line => [plain('    '), ...line, plain(';')])),
            [plain('}')]
        ];
    }

    private static resolveParameterTokens(parameter: JSONOutput.ParameterReflection): ApiToken[] {
        const optional: boolean = parameter.flags.isOptional === true || parameter.defaultValue != undefined;
        return [
            ...parameter.flags.isRest === true ? [plain('...')] : [],
            { text: parameter.name, kind: 'variable' },
            plain(optional ? '?: ' : ': '),
            ...parameter.type == undefined ? [{ text: 'unknown', kind: 'type' } satisfies ApiToken] : this.resolveTypeTokens(parameter.type)
        ];
    }

    private static resolveReferenceTokens(type: JSONOutput.ReferenceType): ApiToken[] {
        // an export of zibri leads to its page, a type of another package to the page typedoc knows for it
        const href: string | undefined = typeof type.target === 'number'
            ? ApiReferenceUtilities.findAddressOf(type.target)
            : type.externalUrl;
        return [
            { text: type.name, kind: 'type', href },
            ...!type.typeArguments?.length
                ? []
                : [
                    plain('<'),
                    ...this.join(type.typeArguments.map(argument => this.resolveTypeTokens(argument)), ', '),
                    plain('>')
                ]
        ];
    }

    private static resolveLiteralToken(value: JSONOutput.LiteralType['value']): ApiToken {
        if (value === null || typeof value === 'boolean') {
            return { text: String(value), kind: 'keyword' };
        }
        if (typeof value === 'string') {
            return { text: JSON.stringify(value), kind: 'string' };
        }
        if (typeof value === 'number') {
            return { text: String(value), kind: 'number' };
        }
        return { text: `${value.negative ? '-' : ''}${value.value}n`, kind: 'number' };
    }

    private static resolveMappedTokens(type: JSONOutput.MappedType): ApiToken[] {
        return [
            plain('{ '),
            ...type.readonlyModifier == undefined ? [] : [keyword(type.readonlyModifier === '-' ? '-readonly ' : 'readonly ')],
            plain('['),
            { text: type.parameter, kind: 'type' },
            keyword(' in '),
            ...this.resolveTypeTokens(type.parameterType),
            ...type.nameType == undefined ? [] : [keyword(' as '), ...this.resolveTypeTokens(type.nameType)],
            plain(']'),
            ...type.optionalModifier == undefined ? [] : [plain(type.optionalModifier === '-' ? '-?' : '?')],
            plain(': '),
            ...this.resolveTypeTokens(type.templateType),
            plain(' }')
        ];
    }

    // an object type, or the type of a function when it is one signature and nothing else
    private static resolveObjectTokens(declaration: JSONOutput.DeclarationReflection): ApiToken[] {
        const signatures: JSONOutput.SignatureReflection[] = declaration.signatures ?? [];
        const [only] = signatures;
        if (only != undefined && this.isFunctionType(declaration)) {
            return this.resolveSignatureTokens(only, undefined, true);
        }
        const members: ApiToken[][] = [
            ...signatures.map(signature => this.resolveSignatureTokens(signature, undefined, false)),
            ...(declaration.indexSignatures ?? []).map(signature => this.resolveIndexSignatureTokens(signature)),
            ...(declaration.children ?? []).flatMap(member => this.resolveMemberLines(member))
        ];
        return members.length ? [plain('{ '), ...this.join(members, '; '), plain(' }')] : [plain('{}')];
    }

    private static resolveIndexSignatureTokens(signature: JSONOutput.SignatureReflection): ApiToken[] {
        return [
            plain('['),
            ...this.join((signature.parameters ?? []).map(parameter => this.resolveParameterTokens(parameter)), ', '),
            plain(']: '),
            ...signature.type == undefined ? [{ text: 'unknown', kind: 'type' } satisfies ApiToken] : this.resolveTypeTokens(signature.type)
        ];
    }

    // a type in parentheses where it binds looser than what it is part of
    private static resolveWrapped(type: JSONOutput.SomeType, loose: TypeKind[]): ApiToken[] {
        const tokens: ApiToken[] = this.resolveTypeTokens(type);
        // of the object types, only that of a function binds looser
        const isLoose: boolean = type.type === 'reflection' ? this.isFunctionType(type.declaration) : true;
        const needsParentheses: boolean = loose.includes(type.type) && isLoose;
        return needsParentheses ? [plain('('), ...tokens, plain(')')] : tokens;
    }

    private static isFunctionType(declaration: JSONOutput.DeclarationReflection): boolean {
        return declaration.signatures?.length === 1 && declaration.children == undefined && declaration.indexSignatures == undefined;
    }

    private static join(parts: ApiToken[][], separator: string): ApiToken[] {
        return parts.flatMap((part, index) => index === 0 ? part : [plain(separator), ...part]);
    }
}