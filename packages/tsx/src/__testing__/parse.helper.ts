import * as ts from 'typescript';

import { parseTemplate, syntaxErrorsOf } from '../semantics/symbols';

/**
 * Parses a template into TypeScript's syntax tree, asserting that it has no syntax error.
 * @param source - The source to parse.
 * @returns The parsed file.
 * @throws When the source has a syntax error.
 */
export function parseTemplateOk(source: string): ts.SourceFile {
    const file: ts.SourceFile = parseTemplate(source);
    const [error] = syntaxErrorsOf(file);
    if (error !== undefined) {
        throw new Error(`Expected source without syntax errors: ${error.message}`);
    }
    return file;
}

/**
 * Parses source that holds a single top-level statement and returns it.
 * @param source - The source to parse.
 * @returns The statement.
 * @throws When the source holds no statement.
 */
export function parseTemplateStatement(source: string): ts.Statement {
    const statement: ts.Statement | undefined = parseTemplateOk(source).statements[0];
    if (statement === undefined) {
        throw new Error('Expected a statement.');
    }
    return statement;
}

/**
 * Parses a single expression statement and returns its expression.
 * @param source - The expression source (without a trailing semicolon).
 * @returns The expression.
 * @throws When the source isn't an expression.
 */
export function parseTemplateExpression(source: string): ts.Expression {
    const statement: ts.Statement = parseTemplateStatement(`${source};`);
    if (!ts.isExpressionStatement(statement)) {
        throw new Error(`Expected an expression statement, got ${ts.SyntaxKind[statement.kind]}.`);
    }
    return statement.expression;
}

/**
 * Parses an arrow function expression.
 * @param source - The arrow function source.
 * @returns The arrow function.
 * @throws When the source isn't an arrow function.
 */
export function parseTemplateArrow(source: string): ts.ArrowFunction {
    const expression: ts.Expression = parseTemplateExpression(source);
    if (!ts.isArrowFunction(expression)) {
        throw new Error(`Expected an arrow function, got ${ts.SyntaxKind[expression.kind]}.`);
    }
    return expression;
}

/**
 * Parses a single variable statement and returns its first declaration's binding name.
 * @param source - The variable statement source.
 * @returns The binding name.
 * @throws When the source isn't a variable statement.
 */
export function parseTemplateBinding(source: string): ts.BindingName {
    const statement: ts.Statement = parseTemplateStatement(source);
    if (!ts.isVariableStatement(statement)) {
        throw new Error(`Expected a variable statement, got ${ts.SyntaxKind[statement.kind]}.`);
    }
    return statement.declarationList.declarations[0].name;
}