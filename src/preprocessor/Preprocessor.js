const fs = require('fs').promises;
const path = require('path');
const ParamResolver = require('../resolver/ParamResolver');

class Preprocessor {
    constructor(configPath = null) {
        this.paramResolver = new ParamResolver(configPath);
    }

    async processDirectory(specDir, outDir) {
        try {
            // Initialize the parameter resolver
            await this.paramResolver.initialize();
            
            // Ensure output directory exists
            await this.ensureDirectoryExists(outDir);
            
            // Process all spec files in the directory
            await this.processDirectoryRecursive(specDir, outDir, specDir);
            
            console.log(`Successfully processed specs from ${specDir} to ${outDir}`);
            
        } catch (error) {
            throw new Error(`Preprocessing failed: ${error.message}`);
        } finally {
            // Cleanup
            await this.paramResolver.cleanup();
        }
    }

    async processDirectoryRecursive(currentDir, outDir, baseDir) {
        try {
            const items = await fs.readdir(currentDir, { withFileTypes: true });
            
            for (const item of items) {
                const sourcePath = path.join(currentDir, item.name);
                const relativePath = path.relative(baseDir, sourcePath);
                const targetPath = path.join(outDir, relativePath);
                
                if (item.isDirectory()) {
                    // Recursively process subdirectories
                    await this.ensureDirectoryExists(targetPath);
                    await this.processDirectoryRecursive(sourcePath, outDir, baseDir);
                } else if (item.isFile() && this.isSpecFile(item.name)) {
                    // Process spec file
                    await this.processSpecFile(sourcePath, targetPath);
                } else {
                    // Copy non-spec files as-is
                    await this.copyFile(sourcePath, targetPath);
                }
            }
        } catch (error) {
            throw new Error(`Failed to process directory ${currentDir}: ${error.message}`);
        }
    }

    async processSpecFile(sourcePath, targetPath) {
        try {
            console.log(`Processing spec file: ${sourcePath}`);
            
            // Read the original spec file
            const content = await fs.readFile(sourcePath, 'utf8');
            
            // Resolve placeholders in the content
            const resolvedContent = await this.paramResolver.resolveText(content);
            
            // Ensure target directory exists
            await this.ensureDirectoryExists(path.dirname(targetPath));
            
            // Write the resolved content to the target file
            await fs.writeFile(targetPath, resolvedContent, 'utf8');
            
            console.log(`Resolved placeholders in: ${sourcePath} -> ${targetPath}`);
            
        } catch (error) {
            console.error(`Failed to process spec file ${sourcePath}:`, error.message);
            
            // Copy original file if processing fails
            try {
                await this.copyFile(sourcePath, targetPath);
                console.warn(`Copied original file due to processing error: ${sourcePath}`);
            } catch (copyError) {
                throw new Error(`Failed to process or copy spec file ${sourcePath}: ${error.message}`);
            }
        }
    }

    async copyFile(sourcePath, targetPath) {
        try {
            // Ensure target directory exists
            await this.ensureDirectoryExists(path.dirname(targetPath));
            
            // Copy the file
            await fs.copyFile(sourcePath, targetPath);
            
        } catch (error) {
            throw new Error(`Failed to copy file from ${sourcePath} to ${targetPath}: ${error.message}`);
        }
    }

    async ensureDirectoryExists(dirPath) {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw new Error(`Failed to create directory ${dirPath}: ${error.message}`);
            }
        }
    }

    isSpecFile(filename) {
        // Gauge spec files typically have .spec extension
        const specExtensions = ['.spec', '.md'];
        const ext = path.extname(filename).toLowerCase();
        return specExtensions.includes(ext);
    }

    async processFile(filePath, outputPath = null) {
        try {
            // Initialize the parameter resolver
            await this.paramResolver.initialize();
            
            // Determine output path
            const targetPath = outputPath || this.getDefaultOutputPath(filePath);
            
            // Process the file
            await this.processSpecFile(filePath, targetPath);
            
            console.log(`Successfully processed file: ${filePath} -> ${targetPath}`);
            
        } catch (error) {
            throw new Error(`Failed to process file ${filePath}: ${error.message}`);
        } finally {
            // Cleanup
            await this.paramResolver.cleanup();
        }
    }

    getDefaultOutputPath(filePath) {
        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const name = path.basename(filePath, ext);
        
        return path.join(dir, `${name}_resolved${ext}`);
    }

    async validateSpecs(specDir) {
        try {
            // Initialize the parameter resolver
            await this.paramResolver.initialize();
            
            const validationResults = {
                totalFiles: 0,
                processedFiles: 0,
                errors: [],
                warnings: []
            };
            
            // Validate all spec files in the directory
            await this.validateDirectoryRecursive(specDir, validationResults);
            
            return validationResults;
            
        } catch (error) {
            throw new Error(`Validation failed: ${error.message}`);
        } finally {
            // Cleanup
            await this.paramResolver.cleanup();
        }
    }

    async validateDirectoryRecursive(currentDir, results) {
        try {
            const items = await fs.readdir(currentDir, { withFileTypes: true });
            
            for (const item of items) {
                const itemPath = path.join(currentDir, item.name);
                
                if (item.isDirectory()) {
                    // Recursively validate subdirectories
                    await this.validateDirectoryRecursive(itemPath, results);
                } else if (item.isFile() && this.isSpecFile(item.name)) {
                    // Validate spec file
                    results.totalFiles++;
                    await this.validateSpecFile(itemPath, results);
                }
            }
        } catch (error) {
            results.errors.push({
                file: currentDir,
                error: `Failed to read directory: ${error.message}`
            });
        }
    }

    async validateSpecFile(filePath, results) {
        try {
            console.log(`Validating spec file: ${filePath}`);
            
            // Read the spec file
            const content = await fs.readFile(filePath, 'utf8');
            
            // Try to resolve placeholders
            await this.paramResolver.resolveText(content);
            
            results.processedFiles++;
            console.log(`✓ Validation passed: ${filePath}`);
            
        } catch (error) {
            results.errors.push({
                file: filePath,
                error: error.message
            });
            console.error(`✗ Validation failed: ${filePath} - ${error.message}`);
        }
    }

    // Utility method to find all placeholders in a file
    async findPlaceholders(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const placeholderRegex = /<([^:]+):([^#]+)#([^|>]+)(?:\|([^>]+))?>/g;
            const placeholders = [];
            
            let match;
            while ((match = placeholderRegex.exec(content)) !== null) {
                placeholders.push({
                    fullMatch: match[0],
                    name: match[1],
                    source: match[2],
                    key: match[3],
                    defaultValue: match[4] || null,
                    position: {
                        start: match.index,
                        end: match.index + match[0].length
                    }
                });
            }
            
            return placeholders;
        } catch (error) {
            throw new Error(`Failed to analyze file ${filePath}: ${error.message}`);
        }
    }

    // Utility method to get statistics about placeholder usage
    async getPlaceholderStatistics(specDir) {
        const stats = {
            totalFiles: 0,
            filesWithPlaceholders: 0,
            totalPlaceholders: 0,
            sourceTypes: {},
            mostUsedSources: [],
            placeholderDetails: []
        };
        
        await this.gatherStatsRecursive(specDir, stats);
        
        // Calculate most used sources
        stats.mostUsedSources = Object.entries(stats.sourceTypes)
            .sort(([,a], [,b]) => b - a)
            .map(([source, count]) => ({ source, count }));
        
        return stats;
    }

    async gatherStatsRecursive(currentDir, stats) {
        try {
            const items = await fs.readdir(currentDir, { withFileTypes: true });
            
            for (const item of items) {
                const itemPath = path.join(currentDir, item.name);
                
                if (item.isDirectory()) {
                    await this.gatherStatsRecursive(itemPath, stats);
                } else if (item.isFile() && this.isSpecFile(item.name)) {
                    stats.totalFiles++;
                    
                    try {
                        const placeholders = await this.findPlaceholders(itemPath);
                        
                        if (placeholders.length > 0) {
                            stats.filesWithPlaceholders++;
                            stats.totalPlaceholders += placeholders.length;
                            
                            for (const placeholder of placeholders) {
                                // Count source types
                                if (!stats.sourceTypes[placeholder.source]) {
                                    stats.sourceTypes[placeholder.source] = 0;
                                }
                                stats.sourceTypes[placeholder.source]++;
                                
                                // Add to details
                                stats.placeholderDetails.push({
                                    file: itemPath,
                                    ...placeholder
                                });
                            }
                        }
                    } catch (error) {
                        console.warn(`Failed to analyze placeholders in ${itemPath}:`, error.message);
                    }
                }
            }
        } catch (error) {
            console.warn(`Failed to read directory ${currentDir}:`, error.message);
        }
    }
}

module.exports = Preprocessor;