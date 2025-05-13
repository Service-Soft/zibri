import { Dirent } from 'fs';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

import express from 'express';
import Handlebars from 'handlebars';

import { AssetServiceInterface } from './asset-service.interface';
import { ZibriApplication } from '../application';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { GlobalRegistry } from '../global';
import { HttpMethod } from '../http';
import { LoggerInterface } from '../logging';
import { Route } from '../routing';

type FileNode = {
    type: 'file',
    name: string,
    route: string
};

type DirectoryNode = {
    type: 'directory',
    name: string,
    children: TreeNode[]
};

type TreeNode = FileNode | DirectoryNode;

type NodeMap = Record<string, { directory?: NodeMap, fileRoute?: string } | undefined>;

export class AssetService implements AssetServiceInterface {
    private readonly logger: LoggerInterface;
    readonly assetsPath: string = path.join(__dirname, 'assets');
    readonly assetsRoute: Route = '/assets';

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    attachTo(app: ZibriApplication): void {
        this.logger.info(`registers static assets from folder "${this.assetsPath}" at ${this.assetsRoute}`);
        app.express.use('/assets', express.static(this.assetsPath));
        app.router.register({
            httpMethod: HttpMethod.GET,
            route: '/',
            handler: async (req, res) => {
                const source: string = await readFile(path.join(this.assetsPath, 'template', 'index.hbs'), { encoding: 'utf8' });
                const template: HandlebarsTemplateDelegate = Handlebars.compile(source);
                const html: string = template({ name: GlobalRegistry.getAppData('name') });
                res.setHeader('Content-Type', 'text/html');
                res.send(html);
            }
        });
        app.router.register({
            httpMethod: HttpMethod.GET,
            route: '/assets',
            handler: async (req, res) => {
                const source: string = await readFile(path.join(this.assetsPath, 'template', 'assets.hbs'), { encoding: 'utf8' });
                const template: HandlebarsTemplateDelegate = Handlebars.compile(source);
                const tree: TreeNode[] = await this.buildFileTree();
                const html: string = template({ name: GlobalRegistry.getAppData('name'), tree });
                res.setHeader('Content-Type', 'text/html');
                res.send(html);
            }
        });
        app.router.register({
            httpMethod: HttpMethod.GET,
            route: '/favicon.ico',
            handler: (req, res) => res.sendFile(path.join(this.assetsPath, 'favicon.png'))
        });
    }

    private async buildFileTree(): Promise<TreeNode[]> {
        // 1) Gather every path relative to assetsPath
        const items: { relPath: string, isFile: boolean }[] = await this.walk(this.assetsPath);

        // Intermediate map structure for building
        const root: NodeMap = {};

        for (const item of items) {
            const segments: string[] = item.relPath.split(path.sep);
            let current: NodeMap = root;

            for (let i: number = 0; i < segments.length; i++) {
                const seg: string = segments[i];
                const isLeaf: boolean = i === segments.length - 1;
                current[seg] ??= {};
                if (isLeaf) {
                    if (item.isFile) {
                        current[seg].fileRoute = `${this.assetsRoute}/${item.relPath.replaceAll('\\', '/')}`;
                    }
                    else {
                        current[seg].directory ??= {};

                    }
                }
                else {
                    current[seg].directory ??= {};
                    current = current[seg].directory;
                }
            }
        }

        return this.mapToTree(root);
    }

    private mapToTree(nodes: NodeMap): TreeNode[] {
        return Object.entries(nodes).map(([name, info]) => {
            if (!info) {
                throw new Error('Error building the assets tree');
            }
            return info.directory
                ? {
                    type: 'directory' as const,
                    name,
                    children: this.mapToTree(info.directory)
                }
                : {
                    type: 'file' as const,
                    name,
                    route: info.fileRoute ?? ''
                };
        });
    }

    private async walk(
        dir: string,
        base: string = dir
    ): Promise<{ relPath: string, isFile: boolean }[]> {
        const entries: Dirent[] = await readdir(dir, { withFileTypes: true });
        const results: { relPath: string, isFile: boolean }[] = [];
        for (const entry of entries) {
            const abs: string = path.join(dir, entry.name);
            const rel: string = path.relative(base, abs);
            if (entry.isDirectory()) {
                results.push({ relPath: rel, isFile: false });
                results.push(...await this.walk(abs, base));
            }
            else {
                results.push({ relPath: rel, isFile: true });
            }
        }
        return results;
    }
}

// 1) Define the helper with a `this` parameter
Handlebars.registerHelper(
    'renderTree',
    function(
        this: Handlebars.HelperOptions, // ← explicitly type `this`
        nodes: TreeNode[]
    ): Handlebars.SafeString {
        let out: string = '';
        for (const node of nodes) {
            if (node.type === 'directory') {
                out += `<details><summary>${Handlebars.escapeExpression(node.name)
                }</summary>`;
                // 2) Call the helper recursively using `apply` so `this` stays typed
                out += (Handlebars.helpers.renderTree as Function).apply(this, [node.children]);
                out += '</details>';
            }
            else {
                out += `<a class="file-link" href="${Handlebars.escapeExpression(node.route)
                }">${Handlebars.escapeExpression(node.name)}</a>`;
            }
        }
        return new Handlebars.SafeString(out);
    }
);