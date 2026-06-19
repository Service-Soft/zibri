import { Dirent } from 'node:fs';

import express from 'express';

import { AssetServiceInterface } from './asset-service.interface';
import { ZibriApplication } from '../application';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { OnAppInit } from '../global/on-app-init.interface';
import { HttpMethod } from '../http/http-method.enum';
import { type LoggerInterface } from '../logging/logger.interface';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { Route } from '../routing/controller-route-configuration.model';
import { FsUtilities, FsPath } from '../utilities/fs.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
type FileNode = { type: 'file', name: string, route: string };

// eslint-disable-next-line jsdoc/require-jsdoc
type DirectoryNode = { type: 'directory', name: string, children: TreeNode[] };

// eslint-disable-next-line jsdoc/require-jsdoc
export type TreeNode = FileNode | DirectoryNode;

// eslint-disable-next-line jsdoc/require-jsdoc
type NodeMap = Record<string, { directory?: NodeMap, fileRoute?: string }>;

// eslint-disable-next-line jsdoc/require-jsdoc
type WalkedPath = { relPath: string, isFile: boolean };

/**
 * Default asset service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class AssetService implements AssetServiceInterface, OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly assetsPath: FsPath = FsUtilities.getPath(__dirname, 'assets');
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly publicAssetsPath: FsPath = FsUtilities.getPath(this.assetsPath, 'public');
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly componentTemplatePath: FsPath = FsUtilities.getPath(this.assetsPath, 'templates', 'components');
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly assetsRoute: Route = '/assets';

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        await this.logger.info(`registers public static assets from folder "${this.publicAssetsPath}" at ${this.assetsRoute}`);
        app.use(this.assetsRoute, express.static(this.publicAssetsPath));

        await inject(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/favicon.ico',
            handler: () => FileResponse.fromPath(FsUtilities.getPath(this.publicAssetsPath, 'favicon.png')),
            versions: 'all',
            openApi: { useInOpenApi: false }
        });

    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async buildFileTree(): Promise<TreeNode[]> {
        // 1) Gather every path relative to assetsPath
        const items: WalkedPath[] = await this.walk(this.publicAssetsPath);

        // Intermediate map structure for building
        const root: NodeMap = {};

        for (const item of items) {
            const segments: string[] = item.relPath.split(FsUtilities.separator);
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
        return ObjectUtilities.entries(nodes).map(([name, info]) => {
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