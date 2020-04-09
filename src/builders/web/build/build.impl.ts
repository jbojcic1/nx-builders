import { BuilderContext, createBuilder } from '@angular-devkit/architect';
import { from, of } from 'rxjs';
import { bufferCount, map, mergeScan, switchMap } from 'rxjs/operators';
import {
  join as devkitJoin,
  JsonObject,
  normalize
} from '@angular-devkit/core';
import { execSync } from 'child_process';
import { basename, resolve } from 'path';
import { BuildBuilderOptions } from '@nrwl/web/src/utils/types';
import { getWebConfig } from '@nrwl/web/src/utils/web.config';
import { normalizeWebBuildOptions } from '@nrwl/web/src/utils/normalize';
import { getSourceRoot } from '@nrwl/web/src/utils/source-root';
import { NodeJsSyncHost } from '@angular-devkit/core/node';
import { Range, satisfies } from 'semver';
import { createProjectGraph } from '@nrwl/workspace/src/core/project-graph';
import {
  calculateProjectDependencies,
  createTmpTsConfig
} from '@nrwl/workspace/src/utils/buildable-libs-utils';
import { BuildResult, runWebpack } from '@angular-devkit/build-webpack';
import { writeIndexHtml } from '@nrwl/web/src/utils/third-party/cli-files/utilities/index-file/write-index-html';
import { BuildBrowserFeatures } from '@nrwl/web/src/utils/third-party/utils';
import { readTsConfig } from '@nrwl/workspace';

export interface WebBuildBuilderOptions extends BuildBuilderOptions {
  index: string;
  budgets: any[];
  baseHref: string;
  deployUrl: string;

  polyfills?: string;
  es2015Polyfills?: string;

  scripts: string[];
  styles: string[];

  vendorChunk?: boolean;
  commonChunk?: boolean;

  stylePreprocessingOptions?: any;
  subresourceIntegrity?: boolean;

  verbose?: boolean;
  buildLibsFromSource?: boolean;
}

export default createBuilder<WebBuildBuilderOptions & JsonObject>(run);

export function run(options: WebBuildBuilderOptions, context: BuilderContext) {
  const host = new NodeJsSyncHost();
  const isScriptOptimizeOn =
    typeof options.optimization === 'boolean'
      ? options.optimization
      : options.optimization && options.optimization.scripts
      ? options.optimization.scripts
      : false;

  // Node versions 12.2-12.8 has a bug where prod builds will hang for 2-3 minutes
  // after the program exits.
  const nodeVersion = execSync(`node --version`)
    .toString('utf-8')
    .trim();
  const supportedRange = new Range('10 || >=12.9');
  if (!satisfies(nodeVersion, supportedRange)) {
    throw new Error(
      `Node version ${nodeVersion} is not supported. Supported range is "${supportedRange.raw}".`
    );
  }

  if (!options.buildLibsFromSource) {
    const projGraph = createProjectGraph();
    const { target, dependencies } = calculateProjectDependencies(
      projGraph,
      context
    );
    options.tsConfig = createTmpTsConfig(
      options.tsConfig,
      context.workspaceRoot,
      target.data.root,
      dependencies
    );
  }

  let isDifferentialLoadingNeeded = isScriptOptimizeOn;

  return from(getSourceRoot(context, host))
    .pipe(
      map(sourceRoot => {
        if (isScriptOptimizeOn) {
          const projectRoot = resolve(context.workspaceRoot, sourceRoot);
          const tsConfig = readTsConfig(options.tsConfig);
          const buildBrowserFeatures = new BuildBrowserFeatures(
            projectRoot,
            tsConfig.options.target
          );
          isDifferentialLoadingNeeded = buildBrowserFeatures.isDifferentialLoadingNeeded();
        }

        options = normalizeWebBuildOptions(
          options,
          context.workspaceRoot,
          sourceRoot
        );

        return [
          // ESM build for modern browsers.
          getWebConfig(
            context.workspaceRoot,
            sourceRoot,
            options,
            context.logger,
            true,
            isScriptOptimizeOn
          ),
          // ES5 build for legacy browsers.
          isDifferentialLoadingNeeded
            ? getWebConfig(
                context.workspaceRoot,
                sourceRoot,
                options,
                context.logger,
                false,
                isScriptOptimizeOn
              )
            : undefined
        ]
          .filter(Boolean)
          .map(config => {
            return options.webpackConfig
              ? require(options.webpackConfig)(config, {
                  options,
                  configuration: context.target.configuration
                })
              : config;
          });
      })
    )
    .pipe(
      switchMap(configs => {
        return from(configs).pipe(
          // Run build sequentially and bail when first one fails.
          mergeScan(
            (acc, config) => {
              if (acc.success) {
                return runWebpack(config, context, {
                  logging: stats => {
                    context.logger.info(stats.toString(config.stats));
                  },
                  webpackFactory: require('webpack')
                });
              } else {
                return of();
              }
            },
            { success: true } as BuildResult,
            1
          ),
          // Collect build results as an array.
          bufferCount(configs.length)
        );
      }),
      switchMap(([result1, result2 = { success: true, emittedFiles: [] }]) => {
        const success = [result1, result2].every(result => result.success);
        return (isScriptOptimizeOn
          ? writeIndexHtml({
              host,
              outputPath: devkitJoin(
                normalize(options.outputPath),
                basename(options.index)
              ),
              indexPath: devkitJoin(
                normalize(context.workspaceRoot),
                options.index
              ),
              files: isDifferentialLoadingNeeded
                ? result1.emittedFiles.filter(x => x.extension === '.css')
                : result1.emittedFiles,
              moduleFiles: isDifferentialLoadingNeeded
                ? result1.emittedFiles.filter(x => x.extension !== '.css')
                : [],
              noModuleFiles: result2.emittedFiles,
              baseHref: options.baseHref,
              deployUrl: options.deployUrl,
              scripts: options.scripts,
              styles: options.styles
            })
          : of(null)
        ).pipe(
          map(
            () =>
              ({
                success,
                emittedFiles: [...result1.emittedFiles, ...result2.emittedFiles]
              } as BuildResult)
          )
        );
      })
    );
}
