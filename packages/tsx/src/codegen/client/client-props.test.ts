import { describe, expect, it } from 'vitest';

import { ClientPropSite, collectClientPropSites } from './client-props.ts';
import { parseTemplateOk } from '../../__testing__/parse.helper.ts';
import { ComponentFunction, findComponents } from '../../semantics/component.ts';

function componentOf(source: string): ComponentFunction {
    return findComponents(parseTemplateOk(source))[0].fn;
}

function sitesOf(source: string): ClientPropSite[] {
    return collectClientPropSites(componentOf(source)).sites;
}

describe('collectClientPropSites', () => {
    it('collects a local function passed to a nested component', () => {
        const sites: ClientPropSite[] = sitesOf(
            'const A = () => { function update(c) { draw(c); } return <Chart update={update}/>; };'
        );
        expect(sites).toHaveLength(1);
        expect(sites[0]).toMatchObject({ id: 'p0', name: 'update' });
        expect(sites[0].captureVars).toEqual([]);
    });

    it('collects a local arrow constant passed to a nested component', () => {
        const sites: ClientPropSite[] = sitesOf(
            'const A = () => { const update = (c) => draw(c); return <Chart update={update}/>; };'
        );
        expect(sites.map(s => s.name)).toEqual(['update']);
    });

    it('collects an inline function prop', () => {
        const sites: ClientPropSite[] = sitesOf('const A = () => <Chart update={(c) => draw(c)}/>;');
        expect(sites.map(s => s.name)).toEqual(['update']);
    });

    it('captures enclosing map variables the function references', () => {
        const sites: ClientPropSite[] = sitesOf(
            'const A = ({ rows }) => <ul>{rows.map(row => <Row render={() => draw(row)}/>)}</ul>;'
        );
        expect(sites).toHaveLength(1);
        expect(sites[0].captureVars).toEqual(['row']);
    });

    it('ignores event handlers, which the handler sites already cover', () => {
        expect(sitesOf('const A = () => <Chart onClick={() => go()}/>;')).toEqual([]);
    });

    it('ignores a function forwarded from the component\'s own props', () => {
        // The ancestor that declared it already created the reference; forwarding it must not
        // re-declare it here, or the function would be built in the wrong scope.
        expect(sitesOf('const A = ({ update }) => <Chart update={update}/>;')).toEqual([]);
    });

    it('ignores non-function props', () => {
        expect(sitesOf('const A = ({ cfg }) => <Chart config={cfg} title="x" count={3}/>;')).toEqual([]);
    });

    it('collects an object prop that contains a function', () => {
        // Serializing the object would silently drop the callback, so the whole value has to be
        // built on the client instead.
        const sites: ClientPropSite[] = sitesOf(
            'const A = () => <Chart config={{ scales: { y: { ticks: { callback: v => `${v} KB` } } } }}/>;'
        );
        expect(sites.map(s => s.name)).toEqual(['config']);
    });

    it('collects an array prop that contains a function', () => {
        const sites: ClientPropSite[] = sitesOf('const A = () => <Table columns={[{ render: r => r.id }]}/>;');
        expect(sites.map(s => s.name)).toEqual(['columns']);
    });

    it('captures enclosing map variables a nested function references', () => {
        const sites: ClientPropSite[] = sitesOf(
            'const A = ({ rows }) => <ul>{rows.map(row => <Row config={{ format: () => draw(row) }}/>)}</ul>;'
        );
        expect(sites).toHaveLength(1);
        expect(sites[0].captureVars).toEqual(['row']);
    });

    it('ignores an object prop with no function in it', () => {
        expect(sitesOf('const A = ({ color }) => <Chart config={{ type: \'bar\', data: { color } }}/>;')).toEqual([]);
    });

    it('ignores functions on host elements, which cannot receive them', () => {
        expect(sitesOf('const A = () => { function f() {} return <div update={f}/>; };')).toEqual([]);
    });

    it('numbers several sites across nested components', () => {
        const sites: ClientPropSite[] = sitesOf(
            'const A = () => { function a() {} function b() {} return <div><X f={a}/><Y g={b}/></div>; };'
        );
        expect(sites.map(s => [s.id, s.name])).toEqual([['p0', 'f'], ['p1', 'g']]);
    });
});