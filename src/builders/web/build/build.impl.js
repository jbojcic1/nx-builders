"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const architect_1 = require("@angular-devkit/architect");
const childProcess = require("child_process");
exports.default = architect_1.createBuilder((options, context) => {
    console.log('hey you');
    return new Promise((resolve, reject) => {
        console.log('don\'t let them');
        context.reportStatus(`Hey.`);
        context.reportStatus(`Executing "${options.command}"...`);
        context.logger.info("bez tebe sam to je od svega gore");
        const child = childProcess.spawn(options.command, options.args, { stdio: 'pipe' });
        child.stdout.on('data', (data) => {
            context.logger.info(data.toString());
        });
        child.stderr.on('data', (data) => {
            context.logger.error(data.toString());
            reject();
        });
        context.reportStatus(`Done.`);
        child.on('close', code => {
            resolve({ success: code === 0 });
        });
    });
});
