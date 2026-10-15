import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { optionalPeer } from './optional-peer.function';

describe('optionalPeer', () => {
    let directory: string;
    let brokenPeer: string;

    beforeAll(() => {
        directory = mkdtempSync(path.join(tmpdir(), 'optional-peer-'));
        // a peer that is there and fails as it loads, the way an es module only package does in a
        // runtime that cannot load it
        brokenPeer = path.join(directory, 'broken-peer.js');
        writeFileSync(brokenPeer, 'throw new Error(\'Must use import to load ES Module\');');
    });

    afterAll(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    it('says a peer that is not installed is not installed', () => {
        expect(() => optionalPeer('zibri-no-such-peer', 'The feature')).toThrow(
            'The feature needs the optional peer dependency "zibri-no-such-peer", which is not installed.'
        );
    });

    it('says a peer that is installed and fails to load could not be loaded, and why', () => {
        let message: string = '';
        try {
            optionalPeer(brokenPeer, 'The feature');
        }
        catch (error) {
            message = error instanceof Error ? error.message : '';
        }
        expect(message).toContain(`The feature needs the optional peer dependency "${brokenPeer}", which is installed but could not be loaded`);
        expect(message).toContain('Must use import to load ES Module');
        expect(message).not.toContain('not installed');
    });
});