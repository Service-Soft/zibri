import { Dirent } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';

import express from 'express';
import handlebars from 'handlebars';

import { AssetServiceInterface } from './asset-service.interface';
import { ZibriApplication } from '../application';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { GlobalRegistry } from '../global';
import { renderPageTemplate } from '../handlebars';
import { HttpMethod } from '../http';
import { LoggerInterface } from '../logging';
import { FileResponse, HtmlResponse } from '../parsing';
import { Route } from '../routing';

// eslint-disable-next-line jsdoc/require-jsdoc
type FileNode = { type: 'file', name: string, route: string };

// eslint-disable-next-line jsdoc/require-jsdoc
type DirectoryNode = { type: 'directory', name: string, children: TreeNode[] };

// eslint-disable-next-line jsdoc/require-jsdoc
type TreeNode = FileNode | DirectoryNode;

// eslint-disable-next-line jsdoc/require-jsdoc
type NodeMap = Record<string, { directory?: NodeMap, fileRoute?: string } | undefined>;

// eslint-disable-next-line jsdoc/require-jsdoc
type WalkedPath = { relPath: string, isFile: boolean };

/**
 * Default asset service implementation of Zibri.
 */
export class AssetService implements AssetServiceInterface {
    private readonly logger: LoggerInterface;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly assetsPath: string = path.join(__dirname, 'assets');
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly publicAssetsPath: string = path.join(this.assetsPath, 'public');
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly pageTemplatePath: string = path.join(this.assetsPath, 'templates', 'pages');
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly emailTemplatePath: string = path.join(this.assetsPath, 'templates', 'emails');
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly assetsRoute: Route = '/assets';

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    attachTo(app: ZibriApplication): void {
        this.logger.info(`registers public static assets from folder "${this.publicAssetsPath}" at ${this.assetsRoute}`);
        app.use(this.assetsRoute, express.static(this.publicAssetsPath));
        app.router.register({
            httpMethod: HttpMethod.GET,
            route: '/',
            handler: async () => {
                const html: string = await renderPageTemplate(
                    'index.hbs',
                    {
                        name: GlobalRegistry.getAppData('name'),
                        base: {
                            title: GlobalRegistry.getAppData('name') ?? ''
                        }
                    }
                );
                return HtmlResponse.fromString(html);
            }
        });
        app.router.register({
            httpMethod: HttpMethod.GET,
            route: this.assetsRoute,
            handler: async () => {
                const tree: TreeNode[] = await this.buildFileTree();
                const html: string = await renderPageTemplate(
                    'assets.hbs',
                    {
                        name: GlobalRegistry.getAppData('name'),
                        base: {
                            title: GlobalRegistry.getAppData('name') ?? ''
                        },
                        tree
                    }
                );
                return HtmlResponse.fromString(html);
            }
        });
        app.router.register({
            httpMethod: HttpMethod.GET,
            route: '/favicon.ico',
            handler: () => FileResponse.fromPath(path.join(this.publicAssetsPath, 'favicon.png'))
        });

    }

    private async buildFileTree(): Promise<TreeNode[]> {
        // 1) Gather every path relative to assetsPath
        const items: WalkedPath[] = await this.walk(this.publicAssetsPath);

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
    ): Promise<WalkedPath[]> {
        const entries: Dirent[] = await readdir(dir, { withFileTypes: true });
        const results: WalkedPath[] = [];
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
handlebars.registerHelper(
    'renderTree',
    function(
        this: handlebars.HelperOptions, // ← explicitly type `this`
        nodes: TreeNode[]
    ): handlebars.SafeString {
        let out: string = '';
        for (const node of nodes) {
            if (node.type === 'directory') {
                out += `<details><summary>${handlebars.escapeExpression(node.name)
                }</summary>`;
                // 2) Call the helper recursively using `apply` so `this` stays typed
                out += (handlebars.helpers.renderTree as Function).apply(this, [node.children]);
                out += '</details>';
            }
            else {
                out += `<a class="file-link" href="${handlebars.escapeExpression(node.route)
                }">${handlebars.escapeExpression(node.name)}</a>`;
            }
        }
        return new handlebars.SafeString(out);
    }
);