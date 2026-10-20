import { beforeAll, describe, expect, it } from 'vitest';

import { StoredRoute } from './stored-route.model.ts';
import { VersionFile } from './version.model.ts';
import { initDiContainer } from '../di/init-di-container.function.ts';
import { GlobalRegistry } from '../global/global-registry.ts';
import { parseObject } from '../parsing/functions/parse-object.function.ts';

describe('VersionFile', () => {
    beforeAll(() => {
        // version files are read once the application exists, which is the state choosing between the
        // shapes of `versions` runs its rules in
        initDiContainer();
        GlobalRegistry.markAppAsCreated();
    });

    it('restores the dates of a stored version file as dates', () => {
        const file: VersionFile = parseObject(
            '{"value":"1.0.0","startsAt":"2026-05-27T08:11:12.332Z","endsAt":"2026-05-27T08:19:29.305Z","routes":[]}',
            VersionFile
        ) as VersionFile;

        expect(file.startsAt).toBeInstanceOf(Date);
        expect(file.startsAt.toISOString()).toBe('2026-05-27T08:11:12.332Z');
        expect(file.endsAt).toBeInstanceOf(Date);
        expect(file.endsAt?.toISOString()).toBe('2026-05-27T08:19:29.305Z');
    });

    it('keeps the end of the latest version open', () => {
        const file: VersionFile = parseObject('{"value":"1.0.1","startsAt":"2026-05-27T08:19:29.305Z","routes":[]}', VersionFile) as VersionFile;

        expect(file.endsAt).toBeUndefined();
    });

    it('restores its routes as they were stored', () => {
        const file: VersionFile = parseObject(
            '{"value":"1.0.0","startsAt":"2026-05-27T08:11:12.332Z","routes":['
            + '{"key":"GET /items","versions":{"shape":"Matchers","value":["^1"]}},'
            + '{"key":"GET /all","versions":{"shape":"All","value":"all"}}]}',
            VersionFile
        ) as VersionFile;

        const routes: StoredRoute[] = file.routes;
        expect(routes).toEqual([
            { key: 'GET /items', versions: { shape: 'Matchers', value: ['^1'] } },
            { key: 'GET /all', versions: { shape: 'All', value: 'all' } }
        ]);
    });
});