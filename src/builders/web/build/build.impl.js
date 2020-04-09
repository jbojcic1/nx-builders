"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const architect_1 = require("@angular-devkit/architect");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const core_1 = require("@angular-devkit/core");
const child_process_1 = require("child_process");
const path_1 = require("path");
const web_config_1 = require("@nrwl/web/src/utils/web.config");
const normalize_1 = require("@nrwl/web/src/utils/normalize");
const source_root_1 = require("@nrwl/web/src/utils/source-root");
const node_1 = require("@angular-devkit/core/node");
const semver_1 = require("semver");
const project_graph_1 = require("@nrwl/workspace/src/core/project-graph");
const buildable_libs_utils_1 = require("@nrwl/workspace/src/utils/buildable-libs-utils");
const build_webpack_1 = require("@angular-devkit/build-webpack");
const write_index_html_1 = require("@nrwl/web/src/utils/third-party/cli-files/utilities/index-file/write-index-html");
const utils_1 = require("@nrwl/web/src/utils/third-party/utils");
const workspace_1 = require("@nrwl/workspace");
exports.default = architect_1.createBuilder(run);
function run(options, context) {
    const host = new node_1.NodeJsSyncHost();
    const isScriptOptimizeOn = typeof options.optimization === 'boolean'
        ? options.optimization
        : options.optimization && options.optimization.scripts
            ? options.optimization.scripts
            : false;
    // Node versions 12.2-12.8 has a bug where prod builds will hang for 2-3 minutes
    // after the program exits.
    const nodeVersion = child_process_1.execSync(`node --version`)
        .toString('utf-8')
        .trim();
    const supportedRange = new semver_1.Range('10 || >=12.9');
    if (!semver_1.satisfies(nodeVersion, supportedRange)) {
        throw new Error(`Node version ${nodeVersion} is not supported. Supported range is "${supportedRange.raw}".`);
    }
    if (!options.buildLibsFromSource) {
        const projGraph = project_graph_1.createProjectGraph();
        const { target, dependencies } = buildable_libs_utils_1.calculateProjectDependencies(projGraph, context);
        options.tsConfig = buildable_libs_utils_1.createTmpTsConfig(options.tsConfig, context.workspaceRoot, target.data.root, dependencies);
    }
    let isDifferentialLoadingNeeded = isScriptOptimizeOn;
    return rxjs_1.from(source_root_1.getSourceRoot(context, host))
        .pipe(operators_1.map(sourceRoot => {
        if (isScriptOptimizeOn) {
            const projectRoot = path_1.resolve(context.workspaceRoot, sourceRoot);
            const tsConfig = workspace_1.readTsConfig(options.tsConfig);
            const buildBrowserFeatures = new utils_1.BuildBrowserFeatures(projectRoot, tsConfig.options.target);
            isDifferentialLoadingNeeded = buildBrowserFeatures.isDifferentialLoadingNeeded();
        }
        options = normalize_1.normalizeWebBuildOptions(options, context.workspaceRoot, sourceRoot);
        return [
            // ESM build for modern browsers.
            web_config_1.getWebConfig(context.workspaceRoot, sourceRoot, options, context.logger, true, isScriptOptimizeOn),
            // ES5 build for legacy browsers.
            isDifferentialLoadingNeeded
                ? web_config_1.getWebConfig(context.workspaceRoot, sourceRoot, options, context.logger, false, isScriptOptimizeOn)
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
    }))
        .pipe(operators_1.switchMap(configs => {
        return rxjs_1.from(configs).pipe(
        // Run build sequentially and bail when first one fails.
        operators_1.mergeScan((acc, config) => {
            if (acc.success) {
                return build_webpack_1.runWebpack(config, context, {
                    logging: stats => {
                        context.logger.info(stats.toString(config.stats));
                    },
                    webpackFactory: require('webpack')
                });
            }
            else {
                return rxjs_1.of();
            }
        }, { success: true }, 1), 
        // Collect build results as an array.
        operators_1.bufferCount(configs.length));
    }), operators_1.switchMap(([result1, result2 = { success: true, emittedFiles: [] }]) => {
        const success = [result1, result2].every(result => result.success);
        return (isScriptOptimizeOn
            ? write_index_html_1.writeIndexHtml({
                host,
                outputPath: core_1.join(core_1.normalize(options.outputPath), path_1.basename(options.index)),
                indexPath: core_1.join(core_1.normalize(context.workspaceRoot), options.index),
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
            : rxjs_1.of(null)).pipe(operators_1.map(() => ({
            success,
            emittedFiles: [...result1.emittedFiles, ...result2.emittedFiles]
        })));
    }));
}
exports.run = run;
