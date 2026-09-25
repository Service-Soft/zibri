import { describe, expect, it } from '@jest/globals';
import { Chart } from 'chart.js?client';
import { io } from 'socket.io-client?client';

/**
 * A package a template imports with `?client` is the package itself on the server.
 *
 * The build resolves it that way through the NormalModuleReplacementPlugin in webpack.config.js, and
 * jest.config.mjs maps it the same way. Without that, every test that reaches a template importing one
 * fails before it runs.
 */
describe('a ?client import', () => {

    it('resolves to the package itself', () => {
        expect(typeof Chart).toBe('function');
        expect(typeof io).toBe('function');
    });
});