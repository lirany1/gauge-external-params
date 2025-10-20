#!/usr/bin/env node

const yargs = require('yargs');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const ParamResolver = require('./src/resolver/ParamResolver');

// Load the proto definition
const PROTO_PATH = path.join(__dirname, 'proto', 'gauge.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});

const gaugeProto = grpc.loadPackageDefinition(packageDefinition).gauge.messages;

class GaugeExternalParamsPlugin {
    constructor() {
        this.paramResolver = new ParamResolver();
        this.server = new grpc.Server();
    }

    setupGrpcServer() {
        // Implement gRPC service methods
        const serviceImplementation = {
            NotifyExecutionStarting: this.handleExecutionStarting.bind(this),
            NotifyExecutionEnding: this.handleExecutionEnding.bind(this),
            NotifySpecExecutionStarting: this.handleSpecExecutionStarting.bind(this),
            NotifySpecExecutionEnding: this.handleSpecExecutionEnding.bind(this),
            NotifyScenarioExecutionStarting: this.handleScenarioExecutionStarting.bind(this),
            NotifyScenarioExecutionEnding: this.handleScenarioExecutionEnding.bind(this),
            NotifyStepExecutionStarting: this.handleStepExecutionStarting.bind(this),
            NotifyStepExecutionEnding: this.handleStepExecutionEnding.bind(this),
            NotifySuiteResult: this.handleSuiteResult.bind(this)
        };

        this.server.addService(gaugeProto.Reporter.service, serviceImplementation);
    }

    async handleExecutionStarting(call, callback) {
        try {
            await this.paramResolver.initialize();
            callback(null, { executionResult: { failed: false } });
        } catch (error) {
            callback(null, { 
                executionResult: { 
                    failed: true, 
                    errorMessage: `Failed to initialize param resolver: ${error.message}` 
                } 
            });
        }
    }

    async handleExecutionEnding(call, callback) {
        try {
            await this.paramResolver.cleanup();
            callback(null, { executionResult: { failed: false } });
        } catch (error) {
            callback(null, { executionResult: { failed: false } }); // Don't fail on cleanup errors
        }
    }

    async handleSpecExecutionStarting(call, callback) {
        try {
            // Refresh caches for new spec
            await this.paramResolver.refreshCaches();
            callback(null, { executionResult: { failed: false } });
        } catch (error) {
            callback(null, { 
                executionResult: { 
                    failed: true, 
                    errorMessage: `Failed to refresh caches: ${error.message}` 
                } 
            });
        }
    }

    async handleSpecExecutionEnding(call, callback) {
        callback(null, { executionResult: { failed: false } });
    }

    async handleScenarioExecutionStarting(call, callback) {
        callback(null, { executionResult: { failed: false } });
    }

    async handleScenarioExecutionEnding(call, callback) {
        callback(null, { executionResult: { failed: false } });
    }

    async handleStepExecutionStarting(call, callback) {
        try {
            const request = call.request;
            if (request.currentStep && request.currentStep.actualText) {
                const resolvedText = await this.paramResolver.resolveText(request.currentStep.actualText);
                
                // Update the step text with resolved parameters
                request.currentStep.actualText = resolvedText;
                request.currentStep.parsedText = resolvedText;
                
                // Update fragments if they exist
                if (request.currentStep.fragments) {
                    for (let fragment of request.currentStep.fragments) {
                        if (fragment.text) {
                            fragment.text = await this.paramResolver.resolveText(fragment.text);
                        }
                    }
                }
            }
            
            callback(null, { executionResult: { failed: false } });
        } catch (error) {
            console.error('Error resolving step parameters:', error.message);
            callback(null, { 
                executionResult: { 
                    failed: true, 
                    errorMessage: `Parameter resolution failed: ${this.maskSensitiveInfo(error.message)}` 
                } 
            });
        }
    }

    async handleStepExecutionEnding(call, callback) {
        callback(null, { executionResult: { failed: false } });
    }

    async handleSuiteResult(call, callback) {
        callback(null, { executionResult: { failed: false } });
    }

    maskSensitiveInfo(message) {
        // Mask potential secrets in error messages
        return message.replace(/([a-zA-Z0-9+/]{20,})/g, '****');
    }

    async start() {
        this.setupGrpcServer();
        
        return new Promise((resolve, reject) => {
            // Bind to port 0 to let OS choose an available port
            this.server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, port) => {
                if (error) {
                    reject(error);
                    return;
                }
                
                this.server.start();
                
                // Print only the port number to stdout as required by Gauge
                console.log(port);
                resolve(port);
            });
        });
    }

    async stop() {
        return new Promise((resolve) => {
            this.server.tryShutdown((error) => {
                if (error) {
                    console.error('Error shutting down server:', error);
                }
                resolve();
            });
        });
    }
}

// CLI setup
const argv = yargs
    .command('start', 'Start the gRPC server for Gauge plugin')
    .command('preprocess', 'Preprocess spec files to resolve placeholders', {
        'spec-dir': {
            describe: 'Directory containing spec files',
            default: 'specs',
            type: 'string'
        },
        'out-dir': {
            describe: 'Output directory for processed specs',
            default: 'specs_resolved',
            type: 'string'
        }
    })
    .option('verbose', {
        alias: 'v',
        describe: 'Enable verbose logging',
        type: 'boolean'
    })
    .help()
    .argv;

async function main() {
    const plugin = new GaugeExternalParamsPlugin();
    
    if (argv._[0] === 'start' || argv.start) {
        try {
            const port = await plugin.start();
            
            // Keep the process running
            process.on('SIGTERM', async () => {
                console.error('Received SIGTERM, shutting down gracefully');
                await plugin.stop();
                process.exit(0);
            });
            
            process.on('SIGINT', async () => {
                console.error('Received SIGINT, shutting down gracefully');
                await plugin.stop();
                process.exit(0);
            });
            
        } catch (error) {
            console.error('Failed to start plugin:', error.message);
            process.exit(1);
        }
    } else if (argv._[0] === 'preprocess') {
        // Import and run preprocessor
        const Preprocessor = require('./src/preprocessor/Preprocessor');
        const preprocessor = new Preprocessor();
        
        try {
            await preprocessor.processDirectory(argv['spec-dir'], argv['out-dir']);
            console.log(`Preprocessing completed. Output written to ${argv['out-dir']}`);
        } catch (error) {
            console.error('Preprocessing failed:', error.message);
            process.exit(1);
        }
    } else {
        yargs.showHelp();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = GaugeExternalParamsPlugin;