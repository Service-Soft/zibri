import { beforeAll, describe, expect, it } from '@jest/globals';

import { initDiContainer } from '../../di/init-di-container.function';
import { HandlebarUtilities } from '../handlebar.utilities';

describe('the helpers registered for handlebar templates', () => {
    beforeAll(async () => {
        initDiContainer();
        await HandlebarUtilities.init();
    });

    describe('and', () => {
        it('renders its block when every value is truthy', () => {
            expect(HandlebarUtilities.renderTemplateString('{{#and a b}}yes{{else}}no{{/and}}', { a: true, b: 1 })).toBe('yes');
            expect(HandlebarUtilities.renderTemplateString('{{#and a b}}yes{{else}}no{{/and}}', { a: true, b: 0 })).toBe('no');
        });

        it('renders its block with the context it is used in, inside an each', () => {
            // the same as if and unless: `this` inside the block is the item, not the whole template's data
            const html: string = HandlebarUtilities.renderTemplateString(
                '{{#each items}}{{#and this.visible}}{{this.label}}{{else}}hidden {{this.label}}{{/and}};{{/each}}',
                { label: 'root', items: [{ visible: true, label: 'first' }, { visible: false, label: 'second' }] }
            );

            expect(html).toBe('first;hidden second;');
        });

        it('returns whether every value is truthy when used inline', () => {
            expect(HandlebarUtilities.renderTemplateString('{{#if (and a b)}}yes{{/if}}', { a: 'x', b: true })).toBe('yes');
        });
    });
});