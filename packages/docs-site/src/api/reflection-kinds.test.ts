import { describe, expect, it } from '@jest/globals';

import { REFLECTION_KINDS } from './reflection-kinds';

describe('the kinds of reflection', () => {
    it('are the numbers typedoc gives them', async () => {
        const { ReflectionKind } = await import('typedoc');

        expect(ReflectionKind).toMatchObject(REFLECTION_KINDS);
    });
});