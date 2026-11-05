import { Dirent } from 'node:fs';

import express from 'express';

import { AssetServiceInterface } from './asset-service.interface';
import { ZibriApplication } from '../application/application';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { OnAppInit } from '../global/on-app-init.interface';
import { HttpMethod } from '../http/http-method.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MiddlewarePhase } from '../http/middleware-phase.enum';
import { $ts } from '../localization/translate.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { Route } from '../routing/controller-route-configuration.model';
import { FsUtilities, type FsPath } from '../utilities/fs.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
export type FileNode = { type: 'file', name: string, route: string };

// eslint-disable-next-line jsdoc/require-jsdoc
export type DirectoryNode = { type: 'directory', name: string, children: TreeNode[] };

// eslint-disable-next-line jsdoc/require-jsdoc
export type TreeNode = FileNode | DirectoryNode;

// a map rather than an object, so a file named like a member of every object, such as `constructor`
// or `__proto__`, is an entry of its own rather than a lookup that finds something else
// eslint-disable-next-line jsdoc/require-jsdoc
type NodeMap = Map<string, MapNode>;

/**
 * A path segment while the tree is built.
 */
type MapNode = {
    /**
     * What lies below the segment, when it is a directory.
     */
    directory?: NodeMap,
    /**
     * The route the file is served at, when it is a file.
     */
    fileRoute?: string
};

// eslint-disable-next-line jsdoc/require-jsdoc
type WalkedPath = { relPath: string, isFile: boolean };

/**
 * Default asset service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class AssetService implements AssetServiceInterface, OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly assetsPath: FsPath;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly publicAssetsPath: FsPath;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly componentTemplatePath: FsPath;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly assetsRoute: Route = '/assets';

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.ASSETS_PATH)
        assetsPath: FsPath,
        @Inject(ZIBRI_DI_TOKENS.PUBLIC_ASSETS_MAX_AGE_IN_MS)
        private readonly publicAssetsMaxAgeInMs: number
    ) {
        this.assetsPath = assetsPath;
        this.publicAssetsPath = FsUtilities.getPath(assetsPath, 'public');
        this.componentTemplatePath = FsUtilities.getPath(assetsPath, 'templates', 'components');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        this.logger.info(`registers public static assets from folder "${this.publicAssetsPath}" at ${this.assetsRoute}`);
        // routing rather than anything earlier: serving a file is answering the request, so it
        // belongs beside the router and behind everything that is about the request itself
        app.use(this.assetsRoute, express.static(this.publicAssetsPath, { maxAge: this.publicAssetsMaxAgeInMs }), MiddlewarePhase.ROUTING);

        inject(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/favicon.ico',
            handler: async (req, res) => {
                const faviconPath: FsPath = FsUtilities.getPath(this.publicAssetsPath, 'favicon.png');
                if (!await FsUtilities.exists(faviconPath)) {
                    throw new NotFoundError($ts`No favicon.png was found in the public assets folder.`);
                }
                // what the static middleware answers the other public assets with: anyone may keep it,
                // for as long as they may. A file the router sends is called public by nobody but its
                // route
                res.setHeader(KnownHeader.CACHE_CONTROL, `public, max-age=${Math.floor(this.publicAssetsMaxAgeInMs / 1000)}`);
                return FileResponse.fromPath(faviconPath);
            },
            versions: 'all',
            openApi: { useInOpenApi: false },
            // the one framework route that states it is public rather than letting `defaultAuth`
            // decide: a browser asks for a favicon on its own, before and regardless of any login,
            // and a 401 for it is a broken tab icon on the login page of an application that did
            // everything right
            auth: { skip: true }
        });

    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async buildFileTree(): Promise<TreeNode[]> {
        // 1) Gather every path relative to assetsPath
        const items: WalkedPath[] = await this.walk(this.publicAssetsPath);

        // Intermediate map structure for building
        const root: NodeMap = new Map();

        for (const item of items) {
            const segments: string[] = item.relPath.split(FsUtilities.separator);
            let current: NodeMap = root;

            for (const [i, seg] of segments.entries()) {
                const isLeaf: boolean = i === segments.length - 1;
                const node: MapNode = current.get(seg) ?? {};
                current.set(seg, node);
                if (isLeaf) {
                    if (item.isFile) {
                        // each segment encoded, so a name holding a space, `#` or `%` is the file it names
                        node.fileRoute = `${this.assetsRoute}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
                    }
                    else {
                        node.directory ??= new Map();
                    }
                }
                else {
                    node.directory ??= new Map();
                    current = node.directory;
                }
            }
        }

        return this.mapToTree(root);
    }

    private mapToTree(nodes: NodeMap): TreeNode[] {
        return [...nodes.entries()].map(([name, info]) => {
            return info.directory
                ? {
                    type: 'directory',
                    name,
                    children: this.mapToTree(info.directory)
                }
                : {
                    type: 'file',
                    name,
                    route: info.fileRoute ?? ''
                };
        });
    }

    private async walk(
        dir: FsPath,
        base: FsPath = dir
    ): Promise<WalkedPath[]> {
        const entries: Dirent[] = await FsUtilities.readdir(dir);
        const results: WalkedPath[] = [];
        for (const entry of entries) {
            const abs: FsPath = FsUtilities.getPath(dir, entry.name);
            const rel: FsPath = FsUtilities.relative(base, abs);
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