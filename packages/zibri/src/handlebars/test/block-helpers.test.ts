import { describe, expect, it } from '@jest/globals';

import { AstProgram } from '../ast.model';
import { PathTree } from '../generate-handlebar-type-files.function';
import { HandlebarUtilities } from '../handlebar.utilities';
import { resolveAllArrayKeys } from '../resolve-all-array-keys.function';
import { resolveTree } from '../resolve-tree.function';

/**
 * What a template needs to be rendered with, the way the type file is generated from it.
 */
type InferredContext = {
    /**
     * The keys the template reads, as a tree.
     */
    tree: PathTree,
    /**
     * The keys the template iterates over.
     */
    arrayKeys: string[]
};

/**
 * Infers the context a template needs.
 * @param source - The template.
 * @returns The keys it reads and the keys it iterates over.
 */
function inferContext(source: string): InferredContext {
    const ast: AstProgram = HandlebarUtilities.parse(source, { srcName: 'inline.hbs' });
    const arrayKeys: string[] = [...new Set(resolveAllArrayKeys(ast, undefined))];
    return { tree: resolveTree(ast, arrayKeys), arrayKeys };
}

describe('inferring the context of a template with block helpers', () => {
    describe('a helper the template registers itself', () => {
        it('reads the keys passed to it and the keys used inside it', () => {
            expect(inferContext('{{#and isAdmin isActive}}{{secret}}{{/and}}')).toEqual({
                tree: { isAdmin: {}, isActive: {}, secret: {} },
                arrayKeys: []
            });
        });

        it('reads the keys passed to it by name and through a sub expression', () => {
            expect(inferContext('{{#paginate (lookup pages current) limit=settings.pageSize}}{{title}}{{/paginate}}').tree)
                .toEqual({ pages: {}, current: {}, settings: { pageSize: {} }, title: {} });
        });

        it('reads the keys inside its else branch', () => {
            expect(inferContext('{{#and isAdmin isActive}}{{secret}}{{else}}{{publicNote}}{{/and}}').tree)
                .toEqual({ isAdmin: {}, isActive: {}, secret: {}, publicNote: {} });
        });

        it('keeps the context it is used in, inside an each', () => {
            expect(inferContext('{{#each items}}{{#and this.visible this.enabled}}{{this.label}}{{/and}}{{/each}}')).toEqual({
                tree: { items: { visible: {}, enabled: {}, label: {} } },
                arrayKeys: ['items']
            });
        });

        it('finds an each inside it', () => {
            expect(inferContext('{{#and showTags}}{{#each tags}}{{this}}{{/each}}{{/and}}')).toEqual({
                tree: { showTags: {}, tags: {} },
                arrayKeys: ['tags']
            });
        });
    });

    describe('with', () => {
        it('reads the keys inside it from the object it names', () => {
            expect(inferContext('{{#with author}}{{this.name}} {{this.email}}{{/with}}')).toEqual({
                tree: { author: { name: {}, email: {} } },
                arrayKeys: []
            });
        });

        it('reads the keys inside its else branch from where it is used', () => {
            expect(inferContext('{{#with author}}{{this.name}}{{else}}{{anonymousLabel}}{{/with}}').tree)
                .toEqual({ author: { name: {} }, anonymousLabel: {} });
        });

        it('names an object inside an each', () => {
            expect(inferContext('{{#each posts}}{{#with this.author}}{{this.name}}{{/with}}{{/each}}')).toEqual({
                tree: { posts: { author: { name: {} } } },
                arrayKeys: ['posts']
            });
        });
    });

    describe('log', () => {
        it('reads nothing for what it logs, and the keys used inside it', () => {
            expect(inferContext('{{#log debugInfo}}{{title}}{{/log}}').tree).toEqual({ title: {} });
        });
    });

    describe('the else branch of the built in blocks', () => {
        it('reads the keys inside the else branch of an if', () => {
            expect(inferContext('{{#if user}}{{user.name}}{{else}}{{guestLabel}}{{/if}}').tree)
                .toEqual({ user: { name: {} }, guestLabel: {} });
        });

        it('reads the keys inside the else branch of an unless', () => {
            expect(inferContext('{{#unless archived}}{{title}}{{else}}{{archivedAt}}{{/unless}}').tree)
                .toEqual({ archived: {}, title: {}, archivedAt: {} });
        });

        it('reads the keys inside the else branch of an each from where the each is used', () => {
            expect(inferContext('{{#each items}}{{this.name}}{{else}}{{emptyLabel}}{{/each}}')).toEqual({
                tree: { items: { name: {} }, emptyLabel: {} },
                arrayKeys: ['items']
            });
        });
    });

    describe('the condition of an if', () => {
        it('reads every key a sub expression is given', () => {
            expect(inferContext('{{#if (and isAdmin isActive)}}{{secret}}{{/if}}').tree)
                .toEqual({ isAdmin: {}, isActive: {}, secret: {} });
        });

        it('reads no key for a literal', () => {
            expect(inferContext('{{#if "always"}}{{title}}{{/if}}').tree).toEqual({ title: {} });
        });
    });
});