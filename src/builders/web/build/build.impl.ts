import { BuilderOutput, createBuilder } from '@angular-devkit/architect';
import * as childProcess from 'child_process';
import { JsonObject } from '@angular-devkit/core';

interface Options extends JsonObject {
    command: string;
    args: string[];
}

export default createBuilder<Options>((options, context) => {
    console.log('hey you');

    return new Promise<BuilderOutput>((resolve, reject) => {
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
