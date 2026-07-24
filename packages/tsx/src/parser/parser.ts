import { ArrayElement, ArrayExpression, ArrayPattern, ArrowFunctionExpression, BlockStatement, ExportDeclaration, Expression, FunctionDeclaration, IdentifierPattern, ImportDeclaration, ImportSpecifier, JSXAttribute, JSXChild, JSXElement, JSXExpressionContainer, JSXFragment, JSXName, JSXSpreadAttribute, ModuleItem, ObjectExpression, ObjectMember, ObjectPattern, ObjectPatternProperty, Pattern, Program, SpreadElement, Statement, StringLiteral, SwitchCase, TemplateLiteral, VariableDeclaration, VariableDeclarationKind, VariableDeclarator } from './ast';
import { ClientQuerySplit, decodeStringLiteral, stripClientQuery } from './type-erasure';
import { Diagnostic, DiagnosticSeverity, SourceSpan } from '../diagnostics/diagnostic.model';
import { Lexer } from '../lexer/lexer';
import { KEYWORDS, Token, TokenType } from '../lexer/token.model';

/**
 * The result of parsing a source file.
 */
export type ParseResult = {
    /**
     * The parsed program, or undefined when a fatal parse error occurred.
     */
    program: Program | undefined,
    /**
     * Any diagnostics produced while parsing.
     */
    diagnostics: Diagnostic[]
};

/**
 * Thrown internally to unwind to the top-level {@link parse} on a fatal parse error.
 */
class ParseError extends Error {
    constructor(readonly diagnostic: Diagnostic) {
        super(diagnostic.message);
        this.name = 'ParseError';
    }
}

/**
 * Binary operator precedence (higher binds tighter). Logical operators are handled separately.
 */
const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
    '??': 1,
    '||': 2,
    '&&': 3,
    '|': 4,
    '^': 5,
    '&': 6,
    '==': 7,
    '!=': 7,
    '===': 7,
    '!==': 7,
    '<': 8,
    '>': 8,
    '<=': 8,
    '>=': 8,
    instanceof: 8,
    in: 8,
    '<<': 9,
    '>>': 9,
    '>>>': 9,
    '+': 10,
    '-': 10,
    '*': 11,
    '/': 11,
    '%': 11,
    '**': 12
};

const LOGICAL_OPERATORS: ReadonlySet<string> = new Set<string>(['??', '||', '&&']);
const ASSIGN_OPERATORS: ReadonlySet<string> = new Set<string>(
    ['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']
);
const UNARY_KEYWORDS: ReadonlySet<string> = new Set<string>(['typeof', 'void', 'delete', 'await']);

/**
 * A saved parser position for backtracking.
 */
type ParserState = {
    /**
     * The saved lexer mark.
     */
    lexerMark: ReturnType<Lexer['mark']>,
    /**
     * The current token at save time.
     */
    token: Token,
    /**
     * A snapshot of the template-substitution depth stack.
     */
    templateStack: number[],
    /**
     * The brace nesting depth at save time.
     */
    braceDepth: number
};

/**
 * A hand-written recursive-descent parser for the supported TSX dialect. Produces the AST in
 * `./ast`, erasing TypeScript type syntax along the way. Fatal errors are collected as
 * {@link Diagnostic}s rather than thrown to the caller.
 */
class Parser {
    private readonly lexer: Lexer;
    private token: Token;
    private templateStack: number[] = [];
    private braceDepth: number = 0;

    constructor(private readonly source: string) {
        this.lexer = new Lexer(source);
        this.token = this.readRaw();
    }

    /**
     * Parses the whole source file into a {@link Program}.
     * @returns The parsed program.
     */
    parseProgram(): Program {
        const start: number = this.token.start;
        const body: ModuleItem[] = [];
        while (this.token.type !== TokenType.EOF) {
            const item: ModuleItem | undefined = this.parseModuleItem();
            if (item) {
                body.push(item);
            }
        }
        return { kind: 'Program', body, span: { start, end: this.source.length } };
    }

    // -----------------------------------------------------------------------
    // Token stream
    // -----------------------------------------------------------------------

    private readRaw(): Token {
        const token: Token = this.lexer.next();
        if (token.type === TokenType.EOF) {
            return token;
        }
        if (this.closesTemplate(token)) {
            this.lexer.reset({ pos: token.start, prev: undefined });
            const cont: Token = this.lexer.scanTemplateContinuation();
            this.templateStack.pop();
            if (cont.type === TokenType.TEMPLATE_MIDDLE) {
                this.templateStack.push(this.braceDepth);
            }
            return cont;
        }
        this.trackBraces(token);
        return token;
    }

    private closesTemplate(token: Token): boolean {
        return token.type === TokenType.PUNCTUATOR
            && token.value === '}'
            && this.templateStack.length > 0
            && this.templateStack[this.templateStack.length - 1] === this.braceDepth;
    }

    private trackBraces(token: Token): void {
        if (token.type === TokenType.TEMPLATE_HEAD) {
            this.templateStack.push(this.braceDepth);
        }
        else if (token.type === TokenType.PUNCTUATOR && token.value === '{') {
            this.braceDepth++;
        }
        else if (token.type === TokenType.PUNCTUATOR && token.value === '}') {
            this.braceDepth = Math.max(0, this.braceDepth - 1);
        }
    }

    private advance(): Token {
        const current: Token = this.token;
        this.token = this.readRaw();
        return current;
    }

    private saveState(): ParserState {
        return {
            lexerMark: this.lexer.mark(),
            token: this.token,
            templateStack: [...this.templateStack],
            braceDepth: this.braceDepth
        };
    }

    private restoreState(state: ParserState): void {
        this.lexer.reset(state.lexerMark);
        this.token = state.token;
        this.templateStack = [...state.templateStack];
        this.braceDepth = state.braceDepth;
    }

    private atEnd(): boolean {
        return this.token.type === TokenType.EOF;
    }

    private is(value: string): boolean {
        return this.token.type === TokenType.IDENTIFIER || this.token.type === TokenType.PUNCTUATOR
            ? this.token.value === value
            : false;
    }

    private isKeyword(value: string): boolean {
        return this.token.type === TokenType.IDENTIFIER && this.token.value === value;
    }

    private eat(value: string): boolean {
        if (this.is(value)) {
            this.advance();
            return true;
        }
        return false;
    }

    private expect(value: string): Token {
        if (!this.is(value)) {
            throw this.error(`Expected '${value}' but found '${this.token.value || '<eof>'}'.`);
        }
        return this.advance();
    }

    private expectIdentifier(): Token {
        if (this.token.type !== TokenType.IDENTIFIER) {
            throw this.error(`Expected an identifier but found '${this.token.value || '<eof>'}'.`);
        }
        return this.advance();
    }

    private error(message: string, span: SourceSpan = { start: this.token.start, end: this.token.end }): ParseError {
        return new ParseError({
            code: 'ZTSX_PARSE',
            message,
            severity: DiagnosticSeverity.ERROR,
            span
        });
    }

    private span(start: number): SourceSpan {
        return { start, end: this.prevEnd };
    }

    private get prevEnd(): number {
        return this.token.start;
    }

    // -----------------------------------------------------------------------
    // Module items
    // -----------------------------------------------------------------------

    private parseModuleItem(): ModuleItem | undefined {
        if (this.isKeyword('import')) {
            return this.parseImport();
        }
        if (this.isKeyword('export')) {
            return this.parseExport();
        }
        if (this.isKeyword('type') || this.isKeyword('interface')) {
            this.eraseTypeAliasOrInterface();
            return undefined;
        }
        return this.parseStatement();
    }

    private parseImport(): ImportDeclaration {
        const start: number = this.advance().start; // 'import'
        let typeOnly: boolean = false;
        if (this.isKeyword('type') && !this.isFromNext()) {
            typeOnly = true;
            this.advance();
        }

        let defaultImport: string | undefined;
        let namespaceImport: string | undefined;
        const specifiers: ImportSpecifier[] = [];

        // Side-effect only: import 'x'
        if (this.token.type === TokenType.STRING) {
            const src: string = decodeStringLiteral(this.advance().value);
            const stripped: ClientQuerySplit = stripClientQuery(src);
            return this.importNode(start, stripped, typeOnly, undefined, undefined, []);
        }

        if (this.token.type === TokenType.IDENTIFIER && !this.is('{') && !this.is('*')) {
            defaultImport = this.advance().value;
            this.eat(',');
        }
        if (this.is('*')) {
            this.advance();
            this.expectKeyword('as');
            namespaceImport = this.expectIdentifier().value;
        }
        else if (this.is('{')) {
            this.parseNamedImports(specifiers);
        }

        this.expectKeyword('from');
        const raw: string = decodeStringLiteral(this.expectString().value);
        const stripped: ClientQuerySplit = stripClientQuery(raw);
        return this.importNode(start, stripped, typeOnly, defaultImport, namespaceImport, specifiers);
    }

    private parseNamedImports(specifiers: ImportSpecifier[]): void {
        this.expect('{');
        while (!this.is('}') && this.token.type !== TokenType.EOF) {
            let specTypeOnly: boolean = false;
            if (this.isKeyword('type') && !this.isAsOrCommaOrBraceNext()) {
                specTypeOnly = true;
                this.advance();
            }
            const imported: string = this.expectIdentifier().value;
            let local: string = imported;
            if (this.isKeyword('as')) {
                this.advance();
                local = this.expectIdentifier().value;
            }
            specifiers.push({ imported, local, typeOnly: specTypeOnly });
            if (!this.eat(',')) {
                break;
            }
        }
        this.expect('}');
    }

    private importNode(
        start: number,
        stripped: ClientQuerySplit,
        typeOnly: boolean,
        defaultImport: string | undefined,
        namespaceImport: string | undefined,
        specifiers: ImportSpecifier[]
    ): ImportDeclaration {
        this.eat(';');
        return {
            kind: 'ImportDeclaration',
            source: stripped.source,
            client: stripped.client,
            typeOnly,
            defaultImport,
            namespaceImport,
            specifiers,
            span: this.span(start)
        };
    }

    private parseExport(): ExportDeclaration {
        const start: number = this.advance().start; // 'export'
        if (this.isKeyword('default')) {
            this.advance();
            const expression: Expression = this.parseAssignment();
            this.eat(';');
            return {
                kind: 'ExportDeclaration', default: true, declaration: undefined, expression, span: this.span(start)
            };
        }
        if (this.isKeyword('type') || this.isKeyword('interface')) {
            this.eraseTypeAliasOrInterface();
            return {
                kind: 'ExportDeclaration', default: false, declaration: undefined, expression: undefined, span: this.span(start)
            };
        }
        if (this.is('{') || this.is('*')) {
            // Re-export / name list — erase (not meaningful for a single-file template).
            this.eraseUntilStatementEnd();
            return {
                kind: 'ExportDeclaration', default: false, declaration: undefined, expression: undefined, span: this.span(start)
            };
        }
        const declaration: Statement = this.parseStatement();
        return {
            kind: 'ExportDeclaration', default: false, declaration, expression: undefined, span: this.span(start)
        };
    }

    // -----------------------------------------------------------------------
    // Statements
    // -----------------------------------------------------------------------

    private parseStatement(): Statement {
        if (this.is('{')) {
            return this.parseBlock();
        }
        if (this.isKeyword('const') || this.isKeyword('let') || this.isKeyword('var')) {
            return this.parseVariableDeclaration();
        }
        if (this.isKeyword('function')) {
            return this.parseFunctionDeclaration();
        }
        if (this.isKeyword('async') && this.secondIsKeyword('function')) {
            return this.parseFunctionDeclaration();
        }
        if (this.isKeyword('return')) {
            return this.parseReturn();
        }
        if (this.isKeyword('if')) {
            return this.parseIf();
        }
        if (this.isKeyword('for')) {
            return this.parseFor();
        }
        if (this.isKeyword('while')) {
            return this.parseWhile();
        }
        if (this.isKeyword('break') || this.isKeyword('continue')) {
            return this.parseBreakContinue();
        }
        if (this.isKeyword('throw')) {
            return this.parseThrow();
        }
        if (this.isKeyword('try')) {
            return this.parseTry();
        }
        if (this.isKeyword('switch')) {
            return this.parseSwitch();
        }
        if (this.is(';')) {
            const s: number = this.advance().start;
            return { kind: 'EmptyStatement', span: this.span(s) };
        }
        return this.parseLabeledOrExpressionStatement();
    }

    private parseBlock(): BlockStatement {
        const start: number = this.expect('{').start;
        const body: Statement[] = [];
        while (!this.is('}') && this.token.type !== TokenType.EOF) {
            body.push(this.parseStatement());
        }
        this.expect('}');
        return { kind: 'BlockStatement', body, span: this.span(start) };
    }

    private parseVariableDeclaration(): VariableDeclaration {
        const start: number = this.token.start;
        const declarationKind: VariableDeclarationKind = this.advance().value as VariableDeclarationKind;
        const declarations: VariableDeclarator[] = [];
        do {
            const id: Pattern = this.parseBindingTarget();
            if (this.eat('!')) {
                // definite-assignment assertion — no runtime effect
            }
            if (this.is(':')) {
                this.eraseTypeAnnotation('annotation');
            }
            let init: Expression | undefined;
            if (this.eat('=')) {
                init = this.parseAssignment();
            }
            declarations.push({ id, init });
        } while (this.eat(','));
        this.eat(';');
        return { kind: 'VariableDeclaration', declarationKind, declarations, span: this.span(start) };
    }

    private parseFunctionDeclaration(): FunctionDeclaration {
        const start: number = this.token.start;
        const async: boolean = this.eatKeyword('async');
        this.expectKeyword('function');
        const generator: boolean = this.eat('*');
        const id: string = this.expectIdentifier().value;
        if (this.is('<')) {
            this.eraseTypeParams();
        }
        const params: Pattern[] = this.parseParams();
        if (this.is(':')) {
            this.eraseTypeAnnotation('return');
        }
        const body: BlockStatement = this.parseBlock();
        return { kind: 'FunctionDeclaration', id, async, generator, params, body, span: this.span(start) };
    }

    private parseReturn(): Statement {
        const start: number = this.advance().start;
        let argument: Expression | undefined;
        if (!this.is(';') && !this.is('}') && this.token.type !== TokenType.EOF) {
            argument = this.parseExpression();
        }
        this.eat(';');
        return { kind: 'ReturnStatement', argument, span: this.span(start) };
    }

    private parseIf(): Statement {
        const start: number = this.advance().start;
        this.expect('(');
        const test: Expression = this.parseExpression();
        this.expect(')');
        const consequent: Statement = this.parseStatement();
        let alternate: Statement | undefined;
        if (this.eatKeyword('else')) {
            alternate = this.parseStatement();
        }
        return { kind: 'IfStatement', test, consequent, alternate, span: this.span(start) };
    }

    private parseFor(): Statement {
        const start: number = this.advance().start;
        this.expect('(');

        let init: VariableDeclaration | Expression | undefined;
        let left: VariableDeclaration | Pattern | undefined;
        if (this.isKeyword('const') || this.isKeyword('let') || this.isKeyword('var')) {
            const declStart: number = this.token.start;
            const declarationKind: VariableDeclarationKind = this.advance().value as VariableDeclarationKind;
            const target: Pattern = this.parseBindingTarget();
            if (this.is(':')) {
                this.eraseTypeAnnotation('annotation');
            }
            if (this.isKeyword('of')) {
                left = {
                    kind: 'VariableDeclaration',
                    declarationKind,
                    declarations: [{ id: target, init: undefined }],
                    span: this.span(declStart)
                };
            }
            else {
                init = this.finishForInit(declStart, declarationKind, target);
            }
        }
        else if (!this.is(';')) {
            init = this.parseExpression();
        }

        if (left || (init === undefined && this.isKeyword('of')) || this.isKeyword('of')) {
            const target: VariableDeclaration | Pattern = left ?? this.exprToPattern(init as Expression);
            this.expectKeyword('of');
            const right: Expression = this.parseAssignment();
            this.expect(')');
            const body: Statement = this.parseStatement();
            return { kind: 'ForOfStatement', left: target, right, body, span: this.span(start) };
        }

        this.expect(';');
        const test: Expression | undefined = this.is(';') ? undefined : this.parseExpression();
        this.expect(';');
        const update: Expression | undefined = this.is(')') ? undefined : this.parseExpression();
        this.expect(')');
        const body: Statement = this.parseStatement();
        return { kind: 'ForStatement', init, test, update, body, span: this.span(start) };
    }

    private finishForInit(declStart: number, declarationKind: VariableDeclarationKind, first: Pattern): VariableDeclaration {
        const declarations: VariableDeclarator[] = [];
        let init: Expression | undefined;
        if (this.eat('=')) {
            init = this.parseAssignment();
        }
        declarations.push({ id: first, init });
        while (this.eat(',')) {
            const id: Pattern = this.parseBindingTarget();
            let d: Expression | undefined;
            if (this.eat('=')) {
                d = this.parseAssignment();
            }
            declarations.push({ id, init: d });
        }
        return { kind: 'VariableDeclaration', declarationKind, declarations, span: this.span(declStart) };
    }

    private parseWhile(): Statement {
        const start: number = this.advance().start;
        this.expect('(');
        const test: Expression = this.parseExpression();
        this.expect(')');
        const body: Statement = this.parseStatement();
        return { kind: 'WhileStatement', test, body, span: this.span(start) };
    }

    private parseBreakContinue(): Statement {
        const keyword: Token = this.advance();
        let label: string | undefined;
        if (this.token.type === TokenType.IDENTIFIER && !KEYWORDS.has(this.token.value) && this.onSameContext()) {
            label = this.advance().value;
        }
        this.eat(';');
        const kind: 'BreakStatement' | 'ContinueStatement' = keyword.value === 'break' ? 'BreakStatement' : 'ContinueStatement';
        return { kind, label, span: this.span(keyword.start) };
    }

    private onSameContext(): boolean {
        return !this.is(';') && !this.is('}');
    }

    private parseThrow(): Statement {
        const start: number = this.advance().start;
        const argument: Expression = this.parseExpression();
        this.eat(';');
        return { kind: 'ThrowStatement', argument, span: this.span(start) };
    }

    private parseTry(): Statement {
        const start: number = this.advance().start;
        const block: BlockStatement = this.parseBlock();
        let handlerParam: Pattern | undefined;
        let handlerBody: BlockStatement | undefined;
        let finalizer: BlockStatement | undefined;
        if (this.eatKeyword('catch')) {
            if (this.eat('(')) {
                handlerParam = this.parseBindingTarget();
                if (this.is(':')) {
                    this.eraseTypeAnnotation('annotation');
                }
                this.expect(')');
            }
            handlerBody = this.parseBlock();
        }
        if (this.eatKeyword('finally')) {
            finalizer = this.parseBlock();
        }
        return { kind: 'TryStatement', block, handlerParam, handlerBody, finalizer, span: this.span(start) };
    }

    private parseSwitch(): Statement {
        const start: number = this.advance().start; // 'switch'
        this.expect('(');
        const discriminant: Expression = this.parseExpression();
        this.expect(')');
        this.expect('{');
        const cases: SwitchCase[] = [];
        while (!this.is('}') && this.token.type !== TokenType.EOF) {
            let test: Expression | undefined;
            if (this.eatKeyword('case')) {
                test = this.parseExpression();
            }
            else {
                this.expectKeyword('default');
            }
            this.expect(':');
            const consequent: Statement[] = [];
            while (!this.atEnd() && !this.isKeyword('case') && !this.isKeyword('default') && !this.is('}')) {
                consequent.push(this.parseStatement());
            }
            cases.push({ test, consequent });
        }
        this.expect('}');
        return { kind: 'SwitchStatement', discriminant, cases, span: this.span(start) };
    }

    private parseLabeledOrExpressionStatement(): Statement {
        const start: number = this.token.start;
        if (this.token.type === TokenType.IDENTIFIER && !KEYWORDS.has(this.token.value) && this.secondIs(':')) {
            const label: string = this.advance().value;
            this.advance(); // ':'
            const body: Statement = this.parseStatement();
            return { kind: 'LabeledStatement', label, body, span: this.span(start) };
        }
        const expression: Expression = this.parseExpression();
        this.eat(';');
        return { kind: 'ExpressionStatement', expression, span: this.span(start) };
    }

    // -----------------------------------------------------------------------
    // Expressions
    // -----------------------------------------------------------------------

    private parseExpression(): Expression {
        const start: number = this.token.start;
        const first: Expression = this.parseAssignment();
        if (!this.is(',')) {
            return first;
        }
        const expressions: Expression[] = [first];
        while (this.eat(',')) {
            expressions.push(this.parseAssignment());
        }
        return { kind: 'SequenceExpression', expressions, span: this.span(start) };
    }

    private parseAssignment(): Expression {
        const arrow: ArrowFunctionExpression | undefined = this.tryParseArrow();
        if (arrow) {
            return arrow;
        }
        const start: number = this.token.start;
        const left: Expression = this.parseConditional();
        if (this.token.type === TokenType.PUNCTUATOR && ASSIGN_OPERATORS.has(this.token.value)) {
            const operator: string = this.advance().value;
            const right: Expression = this.parseAssignment();
            return { kind: 'AssignmentExpression', operator, left, right, span: this.span(start) };
        }
        return left;
    }

    private parseConditional(): Expression {
        const start: number = this.token.start;
        const test: Expression = this.parseBinary(0);
        if (!this.is('?')) {
            return test;
        }
        this.advance();
        const consequent: Expression = this.parseAssignment();
        this.expect(':');
        const alternate: Expression = this.parseAssignment();
        return { kind: 'ConditionalExpression', test, consequent, alternate, span: this.span(start) };
    }

    private parseBinary(minPrec: number): Expression {
        const start: number = this.token.start;
        let left: Expression = this.parseUnary();
        left = this.parseAsExpression(left, start);

        while (true) {
            const op: string = this.token.value;
            const isOperator: boolean = (this.token.type === TokenType.PUNCTUATOR
                || (this.token.type === TokenType.IDENTIFIER && (op === 'instanceof' || op === 'in')))
            && op in BINARY_PRECEDENCE;
            if (!isOperator) {
                break;
            }
            const prec: number = BINARY_PRECEDENCE[op];
            if (prec < minPrec) {
                break;
            }
            this.advance();
            const nextMin: number = op === '**' ? prec : prec + 1;
            const right: Expression = this.parseBinary(nextMin);
            left = LOGICAL_OPERATORS.has(op)
                ? { kind: 'LogicalExpression', operator: op, left, right, span: this.span(start) }
                : { kind: 'BinaryExpression', operator: op, left, right, span: this.span(start) };
            left = this.parseAsExpression(left, start);
        }
        return left;
    }

    private parseAsExpression(left: Expression, start: number): Expression {
        while (this.isKeyword('as') || this.isKeyword('satisfies')) {
            this.advance();
            if (this.isKeyword('const')) {
                this.advance();
            }
            else {
                this.eraseBareType();
            }
        }
        return { ...left, span: this.span(start) } as Expression;
    }

    private parseUnary(): Expression {
        const start: number = this.token.start;
        if (this.token.type === TokenType.PUNCTUATOR && (this.is('!') || this.is('~') || this.is('+') || this.is('-'))) {
            const operator: string = this.advance().value;
            const argument: Expression = this.parseUnary();
            return { kind: 'UnaryExpression', operator, argument, span: this.span(start) };
        }
        if (this.is('++') || this.is('--')) {
            const operator: string = this.advance().value;
            const argument: Expression = this.parseUnary();
            return { kind: 'UpdateExpression', operator, prefix: true, argument, span: this.span(start) };
        }
        if (this.token.type === TokenType.IDENTIFIER && UNARY_KEYWORDS.has(this.token.value)) {
            const operator: string = this.advance().value;
            const argument: Expression = this.parseUnary();
            return { kind: 'UnaryExpression', operator, argument, span: this.span(start) };
        }
        return this.parsePostfix();
    }

    private parsePostfix(): Expression {
        const start: number = this.token.start;
        let expr: Expression = this.parseCallMember();
        if (this.is('++') || this.is('--')) {
            const operator: string = this.advance().value;
            expr = { kind: 'UpdateExpression', operator, prefix: false, argument: expr, span: this.span(start) };
        }
        return expr;
    }

    private parseCallMember(): Expression {
        const start: number = this.token.start;
        let expr: Expression = this.isKeyword('new') ? this.parseNew() : this.parsePrimary();

        while (true) {
            if (this.is('.')) {
                this.advance();
                const property: Token = this.expectIdentifier();
                expr = {
                    kind: 'MemberExpression',
                    object: expr,
                    property: { kind: 'Identifier', name: property.value, span: { start: property.start, end: property.end } },
                    computed: false,
                    optional: false,
                    span: this.span(start)
                };
            }
            else if (this.is('?.')) {
                expr = this.parseOptionalChain(expr, start);
            }
            else if (this.is('[')) {
                this.advance();
                const property: Expression = this.parseExpression();
                this.expect(']');
                expr = { kind: 'MemberExpression', object: expr, property, computed: true, optional: false, span: this.span(start) };
            }
            else if (this.is('(')) {
                const args: (Expression | SpreadElement)[] = this.parseArguments();
                expr = { kind: 'CallExpression', callee: expr, arguments: args, optional: false, span: this.span(start) };
            }
            else if (this.is('<') && this.looksLikeTypeArgsCall()) {
                this.eraseTypeParams();
                const args: (Expression | SpreadElement)[] = this.parseArguments();
                expr = { kind: 'CallExpression', callee: expr, arguments: args, optional: false, span: this.span(start) };
            }
            else if (this.token.type === TokenType.TEMPLATE_HEAD || this.token.type === TokenType.TEMPLATE_FULL) {
                const quasi: TemplateLiteral = this.parseTemplateLiteral();
                expr = { kind: 'TaggedTemplateExpression', tag: expr, quasi, span: this.span(start) };
            }
            else if (this.is('!')) {
                // Postfix non-null assertion (`expr!`) — erase, keep the operand.
                this.advance();
            }
            else {
                break;
            }
        }
        return expr;
    }

    private parseOptionalChain(object: Expression, start: number): Expression {
        this.advance(); // '?.'
        if (this.is('(')) {
            const args: (Expression | SpreadElement)[] = this.parseArguments();
            return { kind: 'CallExpression', callee: object, arguments: args, optional: true, span: this.span(start) };
        }
        if (this.is('[')) {
            this.advance();
            const property: Expression = this.parseExpression();
            this.expect(']');
            return { kind: 'MemberExpression', object, property, computed: true, optional: true, span: this.span(start) };
        }
        const property: Token = this.expectIdentifier();
        return {
            kind: 'MemberExpression',
            object,
            property: { kind: 'Identifier', name: property.value, span: { start: property.start, end: property.end } },
            computed: false,
            optional: true,
            span: this.span(start)
        };
    }

    private parseNew(): Expression {
        const start: number = this.advance().start; // 'new'
        let callee: Expression = this.parsePrimary();
        // member access on the callee (new a.b.C())
        while (this.is('.')) {
            this.advance();
            const property: Token = this.expectIdentifier();
            callee = {
                kind: 'MemberExpression',
                object: callee,
                property: { kind: 'Identifier', name: property.value, span: { start: property.start, end: property.end } },
                computed: false,
                optional: false,
                span: this.span(start)
            };
        }
        if (this.is('<') && this.looksLikeTypeArgsCall()) {
            this.eraseTypeParams();
        }
        const args: (Expression | SpreadElement)[] = this.is('(') ? this.parseArguments() : [];
        return { kind: 'NewExpression', callee, arguments: args, span: this.span(start) };
    }

    private parseArguments(): (Expression | SpreadElement)[] {
        this.expect('(');
        const args: (Expression | SpreadElement)[] = [];
        while (!this.is(')') && this.token.type !== TokenType.EOF) {
            if (this.is('...')) {
                const s: number = this.advance().start;
                const argument: Expression = this.parseAssignment();
                args.push({ kind: 'SpreadElement', argument, span: this.span(s) });
            }
            else {
                args.push(this.parseAssignment());
            }
            if (!this.eat(',')) {
                break;
            }
        }
        this.expect(')');
        return args;
    }

    private parsePrimary(): Expression {
        const token: Token = this.token;
        const start: number = token.start;

        if (this.is('<')) {
            return this.parseJsxRoot();
        }
        if (token.type === TokenType.NUMBER) {
            this.advance();
            return { kind: 'NumericLiteral', raw: token.value, span: { start, end: token.end } };
        }
        if (token.type === TokenType.STRING) {
            this.advance();
            return { kind: 'StringLiteral', raw: token.value, value: decodeStringLiteral(token.value), span: { start, end: token.end } };
        }
        if (token.type === TokenType.REGEX) {
            this.advance();
            return { kind: 'RegexLiteral', raw: token.value, span: { start, end: token.end } };
        }
        if (token.type === TokenType.TEMPLATE_FULL || token.type === TokenType.TEMPLATE_HEAD) {
            return this.parseTemplateLiteral();
        }
        if (this.is('(')) {
            return this.parseParenthesized();
        }
        if (this.is('[')) {
            return this.parseArrayLiteral();
        }
        if (this.is('{')) {
            return this.parseObjectLiteral();
        }
        if (this.isKeyword('function') || (this.isKeyword('async') && this.secondIsKeyword('function'))) {
            return this.parseFunctionExpression();
        }
        if (token.type === TokenType.IDENTIFIER) {
            return this.parseIdentifierLike();
        }
        throw this.error(`Unexpected token '${token.value || '<eof>'}'.`);
    }

    private parseIdentifierLike(): Expression {
        const token: Token = this.advance();
        const start: number = token.start;
        switch (token.value) {
            case 'true': { return { kind: 'BooleanLiteral', value: true, span: { start, end: token.end } };
            }
            case 'false': { return { kind: 'BooleanLiteral', value: false, span: { start, end: token.end } };
            }
            case 'null': { return { kind: 'NullLiteral', span: { start, end: token.end } };
            }
            case 'this': { return { kind: 'ThisExpression', span: { start, end: token.end } };
            }
            default: { return { kind: 'Identifier', name: token.value, span: { start, end: token.end } };
            }
        }
    }

    private parseParenthesized(): Expression {
        const start: number = this.expect('(').start;
        const expression: Expression = this.parseExpression();
        this.expect(')');
        return { kind: 'ParenthesizedExpression', expression, span: this.span(start) };
    }

    private parseArrayLiteral(): ArrayExpression {
        const start: number = this.expect('[').start;
        const elements: (ArrayElement | null)[] = [];
        while (!this.is(']') && this.token.type !== TokenType.EOF) {
            if (this.is(',')) {
                // eslint-disable-next-line unicorn/no-null
                elements.push(null);
                this.advance();
                continue;
            }
            if (this.is('...')) {
                const s: number = this.advance().start;
                elements.push({ kind: 'SpreadElement', argument: this.parseAssignment(), span: this.span(s) });
            }
            else {
                elements.push(this.parseAssignment());
            }
            if (!this.eat(',')) {
                break;
            }
        }
        this.expect(']');
        return { kind: 'ArrayExpression', elements, span: this.span(start) };
    }

    private parseObjectLiteral(): ObjectExpression {
        const start: number = this.expect('{').start;
        const properties: ObjectMember[] = [];
        while (!this.is('}') && this.token.type !== TokenType.EOF) {
            if (this.is('...')) {
                const s: number = this.advance().start;
                properties.push({ kind: 'SpreadElement', argument: this.parseAssignment(), span: this.span(s) });
            }
            else {
                properties.push(this.parseObjectProperty());
            }
            if (!this.eat(',')) {
                break;
            }
        }
        this.expect('}');
        return { kind: 'ObjectExpression', properties, span: this.span(start) };
    }

    private parseObjectProperty(): ObjectMember {
        const start: number = this.token.start;
        let computed: boolean = false;
        let key: Expression;
        if (this.is('[')) {
            computed = true;
            this.advance();
            key = this.parseAssignment();
            this.expect(']');
        }
        else if (this.token.type === TokenType.STRING) {
            const t: Token = this.advance();
            key = { kind: 'StringLiteral', raw: t.value, value: decodeStringLiteral(t.value), span: { start: t.start, end: t.end } };
        }
        else if (this.token.type === TokenType.NUMBER) {
            const t: Token = this.advance();
            key = { kind: 'NumericLiteral', raw: t.value, span: { start: t.start, end: t.end } };
        }
        else {
            const t: Token = this.expectIdentifier();
            key = { kind: 'Identifier', name: t.value, span: { start: t.start, end: t.end } };
        }

        if (this.is('(')) {
            return this.parseObjectMethod(key, computed, start);
        }
        if (this.is(':')) {
            this.advance();
            const value: Expression = this.parseAssignment();
            return { kind: 'ObjectProperty', key, computed, shorthand: false, value, span: this.span(start) } as ObjectMember;
        }
        // shorthand
        const value: Expression = key.kind === 'Identifier'
            ? key
            : (() => {
                throw this.error('Invalid shorthand property.');
            })();
        return { kind: 'ObjectProperty', key, computed, shorthand: true, value, span: this.span(start) } as ObjectMember;
    }

    private parseObjectMethod(key: Expression, computed: boolean, start: number): ObjectMember {
        const params: Pattern[] = this.parseParams();
        if (this.is(':')) {
            this.eraseTypeAnnotation('return');
        }
        const body: BlockStatement = this.parseBlock();
        const value: Expression = {
            kind: 'FunctionExpression',
            id: undefined,
            async: false,
            generator: false,
            params,
            body,
            span: this.span(start)
        };
        return { kind: 'ObjectProperty', key, computed, shorthand: false, value, span: this.span(start) } as ObjectMember;
    }

    private parseFunctionExpression(): Expression {
        const start: number = this.token.start;
        const async: boolean = this.eatKeyword('async');
        this.expectKeyword('function');
        const generator: boolean = this.eat('*');
        let id: string | undefined;
        if (this.token.type === TokenType.IDENTIFIER && !this.is('(')) {
            id = this.advance().value;
        }
        const params: Pattern[] = this.parseParams();
        if (this.is(':')) {
            this.eraseTypeAnnotation('return');
        }
        const body: BlockStatement = this.parseBlock();
        return { kind: 'FunctionExpression', id, async, generator, params, body, span: this.span(start) };
    }

    private parseTemplateLiteral(): TemplateLiteral {
        const start: number = this.token.start;
        const quasis: string[] = [];
        const expressions: Expression[] = [];

        if (this.token.type === TokenType.TEMPLATE_FULL) {
            const t: Token = this.advance();
            quasis.push(t.value.slice(1, -1));
            return { kind: 'TemplateLiteral', quasis, expressions, span: { start, end: t.end } };
        }

        // TEMPLATE_HEAD
        const head: Token = this.advance();
        quasis.push(head.value.slice(1, -2)); // strip leading ` and trailing ${
        while (true) {
            expressions.push(this.parseExpression());
            const seg: Token = this.token;
            if (seg.type === TokenType.TEMPLATE_MIDDLE) {
                quasis.push(seg.value.slice(1, -2)); // strip leading } and trailing ${
                this.advance();
                continue;
            }
            if (seg.type === TokenType.TEMPLATE_TAIL) {
                quasis.push(seg.value.slice(1, -1)); // strip leading } and trailing `
                this.advance();
                break;
            }
            throw this.error('Unterminated template literal.');
        }
        return { kind: 'TemplateLiteral', quasis, expressions, span: this.span(start) };
    }

    // -----------------------------------------------------------------------
    // Arrow functions
    // -----------------------------------------------------------------------

    private tryParseArrow(): ArrowFunctionExpression | undefined {
        if (!this.looksLikeArrow()) {
            return undefined;
        }
        const start: number = this.token.start;
        const async: boolean = this.eatKeyword('async');
        const params: Pattern[] = this.token.type === TokenType.IDENTIFIER && !this.is('(')
            ? [this.identifierPattern(this.advance())]
            : this.parseParams();
        if (this.is(':')) {
            this.eraseTypeAnnotation('return');
        }
        this.expect('=>');
        const body: BlockStatement | Expression = this.is('{') ? this.parseBlock() : this.parseAssignment();
        return { kind: 'ArrowFunctionExpression', async, params, body, span: this.span(start) };
    }

    private looksLikeArrow(): boolean {
        const state: ParserState = this.saveState();
        try {
            if (this.isKeyword('async')) {
                this.advance();
            }
            if (this.token.type === TokenType.IDENTIFIER && !KEYWORDS.has(this.token.value)) {
                this.advance();
                return this.is('=>');
            }
            if (!this.is('(')) {
                return false;
            }
            this.skipBalanced('(', ')');
            if (this.is(':')) {
                this.eraseTypeAnnotation('return');
            }
            return this.is('=>');
        }
        catch {
            return false;
        }
        finally {
            this.restoreState(state);
        }
    }

    private skipBalanced(open: string, close: string): void {
        this.expect(open);
        let depth: number = 1;
        while (depth > 0 && this.token.type !== TokenType.EOF) {
            if (this.is(open)) {
                depth++;
            }
            else if (this.is(close)) {
                depth--;
            }
            this.advance();
        }
    }

    // -----------------------------------------------------------------------
    // Patterns & params
    // -----------------------------------------------------------------------

    private parseParams(): Pattern[] {
        this.expect('(');
        const params: Pattern[] = [];
        while (!this.is(')') && this.token.type !== TokenType.EOF) {
            if (this.is('...')) {
                const s: number = this.advance().start;
                const inner: Pattern = this.parseBindingTarget();
                if (this.is(':')) {
                    this.eraseTypeAnnotation('annotation');
                }
                // Represent rest param as an ObjectPattern rest-less wrapper is overkill; keep the inner pattern.
                params.push(this.restPattern(inner, s));
            }
            else {
                params.push(this.parseBindingElement());
            }
            if (!this.eat(',')) {
                break;
            }
        }
        this.expect(')');
        return params;
    }

    private restPattern(inner: Pattern, start: number): Pattern {
        return { kind: 'RestElement', argument: inner, span: this.span(start) };
    }

    private parseBindingElement(): Pattern {
        const start: number = this.token.start;
        const target: Pattern = this.parseBindingTarget();
        if (this.eat('?')) {
            // optional parameter marker — no runtime effect
        }
        if (this.is(':')) {
            this.eraseTypeAnnotation('annotation');
        }
        if (this.eat('=')) {
            const right: Expression = this.parseAssignment();
            return { kind: 'AssignmentPattern', left: target, right, span: this.span(start) };
        }
        return target;
    }

    private parseBindingTarget(): Pattern {
        if (this.is('{')) {
            return this.parseObjectPattern();
        }
        if (this.is('[')) {
            return this.parseArrayPattern();
        }
        return this.identifierPattern(this.expectIdentifier());
    }

    private identifierPattern(token: Token): IdentifierPattern {
        return { kind: 'IdentifierPattern', name: token.value, span: { start: token.start, end: token.end } };
    }

    private parseObjectPattern(): ObjectPattern {
        const start: number = this.expect('{').start;
        const properties: ObjectPatternProperty[] = [];
        let rest: string | undefined;
        while (!this.is('}') && this.token.type !== TokenType.EOF) {
            if (this.is('...')) {
                this.advance();
                rest = this.expectIdentifier().value;
                break;
            }
            properties.push(this.parseObjectPatternProperty());
            if (!this.eat(',')) {
                break;
            }
        }
        this.expect('}');
        return { kind: 'ObjectPattern', properties, rest, span: this.span(start) };
    }

    private parseObjectPatternProperty(): ObjectPatternProperty {
        const keyStart: number = this.token.start;
        let computed: boolean = false;
        let key: string;
        if (this.is('[')) {
            computed = true;
            this.advance();
            const keyExpr: Expression = this.parseAssignment();
            key = this.source.slice(keyExpr.span.start, keyExpr.span.end);
            this.expect(']');
        }
        else if (this.token.type === TokenType.STRING) {
            key = decodeStringLiteral(this.advance().value);
        }
        else {
            key = this.expectIdentifier().value;
        }

        let value: Pattern;
        let shorthand: boolean;
        if (this.eat(':')) {
            value = this.parseBindingTarget();
            shorthand = false;
        }
        else {
            value = { kind: 'IdentifierPattern', name: key, span: { start: keyStart, end: keyStart + key.length } };
            shorthand = true;
        }
        if (!this.is(':') && this.eat('=')) {
            const right: Expression = this.parseAssignment();
            value = { kind: 'AssignmentPattern', left: value, right, span: right.span };
        }
        return { key, computed, value, shorthand };
    }

    private parseArrayPattern(): ArrayPattern {
        const start: number = this.expect('[').start;
        const elements: (Pattern | null)[] = [];
        let rest: Pattern | undefined;
        while (!this.is(']') && this.token.type !== TokenType.EOF) {
            if (this.is(',')) {
                // eslint-disable-next-line unicorn/no-null
                elements.push(null);
                this.advance();
                continue;
            }
            if (this.is('...')) {
                this.advance();
                rest = this.parseBindingTarget();
                break;
            }
            elements.push(this.parseBindingElement());
            if (!this.eat(',')) {
                break;
            }
        }
        this.expect(']');
        return { kind: 'ArrayPattern', elements, rest, span: this.span(start) };
    }

    private exprToPattern(expr: Expression): Pattern {
        if (expr.kind === 'Identifier') {
            return { kind: 'IdentifierPattern', name: expr.name, span: expr.span };
        }
        throw this.error('Unsupported for-of binding target.', expr.span);
    }

    // -----------------------------------------------------------------------
    // JSX
    // -----------------------------------------------------------------------

    private parseJsxRoot(): Expression {
        const node: JSXElement | JSXFragment = this.parseJsxElementOrFragment();
        // Consume the final '>' that element/fragment parsing left unconsumed.
        this.expect('>');
        return node;
    }

    private parseJsxElementOrFragment(): JSXElement | JSXFragment {
        const start: number = this.token.start; // '<'
        if (this.source[this.token.end] === '>') {
            return this.parseJsxFragment(start);
        }
        return this.parseJsxElement(start);
    }

    private parseJsxElement(start: number): JSXElement {
        this.expect('<');
        this.lexer.jsxTag = true;
        const name: JSXName = this.parseJsxName();
        const attributes: (JSXAttribute | JSXSpreadAttribute)[] = this.parseJsxAttributes();

        if (this.is('/')) {
            this.advance(); // '/'
            if (!this.is('>')) {
                throw this.error('Expected \'>\' to close a self-closing tag.');
            }
            this.lexer.jsxTag = false;
            // leave '>' unconsumed for the caller/child-loop
            return { kind: 'JSXElement', name, attributes, selfClosing: true, children: [], span: this.span(start) };
        }
        if (!this.is('>')) {
            throw this.error(`Expected '>' to end the opening tag of <${this.jsxNameToString(name)}>.`);
        }
        this.lexer.jsxTag = false;
        // this.token === '>' (unconsumed); scan children from here.
        const children: JSXChild[] = this.parseJsxChildren(this.jsxNameToString(name));
        return { kind: 'JSXElement', name, attributes, selfClosing: false, children, span: this.span(start) };
    }

    private parseJsxFragment(start: number): JSXFragment {
        this.expect('<');
        // this.token === '>' (the fragment open close), unconsumed
        const children: JSXChild[] = this.parseJsxChildren('');
        return { kind: 'JSXFragment', children, span: this.span(start) };
    }

    private parseJsxChildren(tagName: string): JSXChild[] {
        const children: JSXChild[] = [];
        while (true) {
            const text: Token = this.scanJsxTextAndAdvance();
            if (text.value.length > 0) {
                children.push({ kind: 'JSXText', value: text.value, span: { start: text.start, end: text.end } });
            }
            if (this.token.type === TokenType.EOF) {
                throw this.error(`Unterminated JSX: missing closing tag for <${tagName}>.`);
            }
            if (this.is('<')) {
                if (this.source[this.token.end] === '/') {
                    this.lexer.jsxTag = true;
                    this.parseJsxClosingTag();
                    this.lexer.jsxTag = false;
                    break;
                }
                children.push(this.parseJsxElementOrFragment());
                // element/fragment leaves its final '>' unconsumed; loop continues from after it.
            }
            else if (this.is('{')) {
                children.push(this.parseJsxChildExpression());
            }
            else {
                throw this.error(`Unexpected '${this.token.value}' in JSX children.`);
            }
        }
        return children;
    }

    /**
     * Treats the current `>` or `}` boundary token as consumed and scans the JSX text that
     * follows it, then refreshes the current code token. Compensates brace tracking for the
     * `}` that closes a child expression container.
     * @returns The scanned JSX text token.
     */
    private scanJsxTextAndAdvance(): Token {
        const text: Token = this.lexer.scanJsxText();
        this.token = this.readRaw();
        return text;
    }

    private parseJsxChildExpression(): JSXExpressionContainer {
        const start: number = this.expect('{').start;
        if (this.is('}')) {
            // empty container; compensate the '{' we counted, then leave '}' for the child loop.
            this.braceDepth = Math.max(0, this.braceDepth - 1);
            return { kind: 'JSXExpressionContainer', expression: undefined, span: this.span(start) };
        }
        const expression: Expression = this.parseAssignment();
        if (!this.is('}')) {
            throw this.error('Expected \'}\' to close a JSX expression.');
        }
        // Compensate: the '{' incremented braceDepth; the '}' is consumed via scanJsxText, not readRaw.
        this.braceDepth = Math.max(0, this.braceDepth - 1);
        return { kind: 'JSXExpressionContainer', expression, span: this.span(start) };
    }

    private parseJsxClosingTag(): void {
        this.expect('<');
        this.expect('/');
        if (!this.is('>')) {
            this.parseJsxName();
        }
        if (!this.is('>')) {
            throw this.error('Expected \'>\' to close a JSX closing tag.');
        }
        // leave '>' unconsumed
    }

    private parseJsxAttributes(): (JSXAttribute | JSXSpreadAttribute)[] {
        const attributes: (JSXAttribute | JSXSpreadAttribute)[] = [];
        while (!this.is('>') && !this.is('/') && this.token.type !== TokenType.EOF) {
            if (this.is('{')) {
                this.lexer.jsxTag = false;
                const s: number = this.expect('{').start;
                this.expect('...');
                const argument: Expression = this.parseAssignment();
                if (!this.is('}')) {
                    throw this.error('Expected \'}\' to close a JSX spread attribute.');
                }
                this.lexer.jsxTag = true;
                this.expect('}');
                attributes.push({ kind: 'JSXSpreadAttribute', argument, span: this.span(s) });
                continue;
            }
            attributes.push(this.parseJsxAttribute());
        }
        return attributes;
    }

    private parseJsxAttribute(): JSXAttribute {
        const start: number = this.token.start;
        const name: string = this.parseJsxAttributeName();
        let value: StringLiteral | JSXExpressionContainer | undefined;
        if (this.eat('=')) {
            if (this.token.type === TokenType.STRING) {
                const t: Token = this.advance();
                value = { kind: 'StringLiteral', raw: t.value, value: decodeStringLiteral(t.value), span: { start: t.start, end: t.end } };
            }
            else if (this.is('{')) {
                value = this.parseJsxAttributeExpression();
            }
            else {
                throw this.error('Expected a JSX attribute value.');
            }
        }
        return { kind: 'JSXAttribute', name, value, span: this.span(start) };
    }

    private parseJsxAttributeExpression(): JSXExpressionContainer {
        this.lexer.jsxTag = false;
        const start: number = this.expect('{').start;
        const expression: Expression = this.parseAssignment();
        if (!this.is('}')) {
            throw this.error('Expected \'}\' to close a JSX attribute expression.');
        }
        this.lexer.jsxTag = true;
        this.expect('}');
        return { kind: 'JSXExpressionContainer', expression, span: this.span(start) };
    }

    private parseJsxAttributeName(): string {
        const first: Token = this.expectIdentifier();
        let name: string = first.value;
        let end: number = first.end;
        while ((this.is('-') || this.is(':')) && this.token.start === end) {
            name += this.advance().value;
            if (this.token.type === TokenType.IDENTIFIER && this.token.start === end + 1) {
                name += this.token.value;
            }
            if (this.token.type === TokenType.IDENTIFIER) {
                end = this.token.end;
                this.advance();
            }
            else {
                end = name.length + first.start;
            }
        }
        return name;
    }

    private parseJsxName(): JSXName {
        const first: Token = this.expectIdentifier();
        let name: JSXName = { kind: 'JSXIdentifier', name: first.value, span: { start: first.start, end: first.end } };
        while (this.is('.')) {
            this.advance();
            const property: Token = this.expectIdentifier();
            name = { kind: 'JSXMemberName', object: name, property: property.value, span: { start: first.start, end: property.end } };
        }
        return name;
    }

    private jsxNameToString(name: JSXName): string {
        if (name.kind === 'JSXIdentifier') {
            return name.name;
        }
        return `${this.jsxNameToString(name.object)}.${name.property}`;
    }

    // -----------------------------------------------------------------------
    // Type erasure
    // -----------------------------------------------------------------------

    private eraseTypeParams(): void {
        let i: number = this.token.start;
        let depth: number = 0;
        while (i < this.source.length) {
            const c: string = this.source[i];
            const next: string = this.source[i + 1] ?? '';
            if (c === '"' || c === '\'' || c === '`') {
                i = this.skipStringAt(i);
                continue;
            }
            if (c === '=' && next === '>') {
                // A function type inside type arguments (e.g. `Array<() => void>`) — skip the arrow.
                i += 2;
                continue;
            }
            if (c === '<') {
                depth++;
            }
            else if (c === '>') {
                depth--;
                if (depth === 0) {
                    i++;
                    break;
                }
            }
            i++;
        }
        this.resyncTo(i);
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private eraseTypeAnnotation(context: 'annotation' | 'return'): void {
        // this.token === ':'
        let i: number = this.token.end;
        let depth: number = 0;
        while (i < this.source.length) {
            const c: string = this.source[i];
            const next: string = this.source[i + 1] ?? '';
            if (c === '"' || c === '\'' || c === '`') {
                i = this.skipStringAt(i);
                continue;
            }
            // In an annotation, `=>` belongs to a function type (e.g. `: (a) => void`); skip it.
            if (context === 'annotation' && c === '=' && next === '>') {
                i += 2;
                continue;
            }
            // Stop chars must be checked before bracket handling so that a return type's function
            // body `{` (a stop) is not mistaken for an object-type open brace.
            if (depth === 0 && this.isTypeStopChar(c, next, context)) {
                break;
            }
            if (c === '(' || c === '[' || c === '{' || c === '<') {
                depth++;
                i++;
                continue;
            }
            if (c === ')' || c === ']' || c === '}' || c === '>') {
                if (depth === 0) {
                    break;
                }
                depth--;
                i++;
                continue;
            }
            i++;
        }
        this.resyncTo(i);
    }

    private isTypeStopChar(c: string, next: string, context: 'annotation' | 'return'): boolean {
        if (context === 'return') {
            return c === '{' || (c === '=' && next === '>') || c === ';';
        }
        // A function-type annotation (e.g. `: (a: string) => void`) contains `=>`; only a real
        // assignment `=` (not the `=>` arrow) terminates the annotation.
        return c === ',' || c === ';' || (c === '=' && next !== '>');
    }

    private eraseBareType(): void {
        // Erase a type expression in value position (after 'as'/'satisfies'), stopping at any
        // operator/terminator that cannot be part of a type.
        let i: number = this.token.start;
        let depth: number = 0;
        while (i < this.source.length) {
            const c: string = this.source[i];
            if (c === '"' || c === '\'' || c === '`') {
                i = this.skipStringAt(i);
                continue;
            }
            if (c === '(' || c === '[' || c === '{' || c === '<') {
                depth++;
                i++;
                continue;
            }
            if (c === ')' || c === ']' || c === '}' || c === '>') {
                if (depth === 0) {
                    break;
                }
                depth--;
                i++;
                continue;
            }
            if (depth === 0 && this.isBareTypeStop(c)) {
                break;
            }
            i++;
        }
        this.resyncTo(i);
    }

    private isBareTypeStop(c: string): boolean {
        return c === ',' || c === ';' || c === ')' || c === ']' || c === '}'
            || c === '?' || c === ':' || c === '=' || c === '*' || c === '+'
            || c === '-' || c === '/' || c === '%' || c === '<' || c === '>'
            || c === '&' || c === '|' || c === '\n';
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private eraseTypeAliasOrInterface(): void {
        const isInterface: boolean = this.isKeyword('interface');
        let i: number = this.token.end;
        let depth: number = 0;
        let seenBrace: boolean = false;
        while (i < this.source.length) {
            const c: string = this.source[i];
            if (c === '"' || c === '\'' || c === '`') {
                i = this.skipStringAt(i);
                continue;
            }
            if (c === '{' || c === '(' || c === '[' || c === '<') {
                if (c === '{') {
                    seenBrace = true;
                }
                depth++;
                i++;
                continue;
            }
            if (c === '}' || c === ')' || c === ']' || c === '>') {
                depth = Math.max(0, depth - 1);
                i++;
                if (isInterface && seenBrace && depth === 0) {
                    break;
                }
                continue;
            }
            if (!isInterface && depth === 0 && c === ';') {
                i++;
                break;
            }
            i++;
        }
        this.resyncTo(i);
    }

    private eraseUntilStatementEnd(): void {
        let i: number = this.token.start;
        let depth: number = 0;
        while (i < this.source.length) {
            const c: string = this.source[i];
            if (c === '"' || c === '\'' || c === '`') {
                i = this.skipStringAt(i);
                continue;
            }
            if (c === '{' || c === '(' || c === '[') {
                depth++;
            }
            else if (c === '}' || c === ')' || c === ']') {
                depth = Math.max(0, depth - 1);
            }
            else if (depth === 0 && c === ';') {
                i++;
                break;
            }
            i++;
        }
        this.resyncTo(i);
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private skipStringAt(start: number): number {
        const quote: string = this.source[start];
        let i: number = start + 1;
        while (i < this.source.length) {
            const c: string = this.source[i];
            if (c === '\\') {
                i += 2;
                continue;
            }
            if (quote === '`' && c === '$' && this.source[i + 1] === '{') {
                i += 2;
                let depth: number = 1;
                while (i < this.source.length && depth > 0) {
                    if (this.source[i] === '{') {
                        depth++;
                    }
                    else if (this.source[i] === '}') {
                        depth--;
                    }
                    i++;
                }
                continue;
            }
            if (c === quote) {
                return i + 1;
            }
            i++;
        }
        return i;
    }

    private resyncTo(pos: number): void {
        this.lexer.reset({ pos, prev: undefined });
        this.token = this.readRaw();
    }

    // -----------------------------------------------------------------------
    // Lookahead helpers
    // -----------------------------------------------------------------------

    private secondIs(value: string): boolean {
        const state: ParserState = this.saveState();
        this.advance();
        const result: boolean = this.is(value);
        this.restoreState(state);
        return result;
    }

    private secondIsKeyword(value: string): boolean {
        const state: ParserState = this.saveState();
        this.advance();
        const result: boolean = this.isKeyword(value);
        this.restoreState(state);
        return result;
    }

    private isFromNext(): boolean {
        const state: ParserState = this.saveState();
        this.advance();
        const result: boolean = this.isKeyword('from');
        this.restoreState(state);
        return result;
    }

    private isAsOrCommaOrBraceNext(): boolean {
        const state: ParserState = this.saveState();
        this.advance();
        const result: boolean = this.isKeyword('as') || this.is(',') || this.is('}');
        this.restoreState(state);
        return result;
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private looksLikeTypeArgsCall(): boolean {
        const state: ParserState = this.saveState();
        try {
            let i: number = this.token.start;
            let depth: number = 0;
            while (i < this.source.length) {
                const c: string = this.source[i];
                if (c === '"' || c === '\'' || c === '`') {
                    i = this.skipStringAt(i);
                    continue;
                }
                // A function type inside the type arguments (`<() => T>`) contains `=>`; skip it so
                // the `>` of the arrow does not close the angle group early.
                if (c === '=' && this.source[i + 1] === '>') {
                    i += 2;
                    continue;
                }
                if (c === '<') {
                    depth++;
                }
                else if (c === '>') {
                    depth--;
                    if (depth === 0) {
                        i++;
                        break;
                    }
                }
                else if (depth === 0 && (c === ';' || c === ')')) {
                    // A bare `<` that never opened a balanced group: this is a comparison, not a call.
                    return false;
                }
                i++;
            }
            if (depth !== 0) {
                return false;
            }
            // After the balanced <...>, a call must follow.
            while (i < this.source.length && /\s/.test(this.source[i])) {
                i++;
            }
            return this.source[i] === '(';
        }
        finally {
            this.restoreState(state);
        }
    }

    // -----------------------------------------------------------------------
    // Keyword helpers
    // -----------------------------------------------------------------------

    private expectKeyword(value: string): Token {
        if (!this.isKeyword(value)) {
            throw this.error(`Expected '${value}' but found '${this.token.value || '<eof>'}'.`);
        }
        return this.advance();
    }

    private eatKeyword(value: string): boolean {
        if (this.isKeyword(value)) {
            this.advance();
            return true;
        }
        return false;
    }

    private expectString(): Token {
        if (this.token.type !== TokenType.STRING) {
            throw this.error(`Expected a string but found '${this.token.value || '<eof>'}'.`);
        }
        return this.advance();
    }
}

/**
 * Parses a TSX source string into an AST, erasing TypeScript type syntax.
 * @param source - The source text to parse.
 * @returns The parsed program and any diagnostics.
 * @throws Any non-parse error encountered while parsing (parse errors are returned as diagnostics).
 */
export function parse(source: string): ParseResult {
    const parser: Parser = new Parser(source);
    try {
        const program: Program = parser.parseProgram();
        return { program, diagnostics: [] };
    }
    catch (error) {
        if (error instanceof ParseError) {
            return { program: undefined, diagnostics: [error.diagnostic] };
        }
        throw error;
    }
}