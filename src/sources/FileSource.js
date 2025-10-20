const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const get = require('lodash.get');

class FileSource {
    constructor(config = {}) {
        this.config = {
            basePath: config.basePath || process.cwd(),
            allowedExtensions: config.allowedExtensions || ['.json', '.yaml', '.yml'],
            cacheFiles: config.cacheFiles !== false, // Default to true
            maxFileSize: config.maxFileSize || 1024 * 1024, // 1MB default
            ...config
        };
        this.fileCache = new Map();
        this.fileMTimes = new Map();
    }

    async initialize() {
        // File source requires no special initialization
        return Promise.resolve();
    }

    async resolve(key) {
        try {
            // Parse the key - format could be "filename.json#path.to.value" or just "filename.json"
            const { filename, jsonPath } = this.parseKey(key);
            
            // Load the file
            const fileData = await this.loadFile(filename);
            
            // Extract value using path if provided
            let value;
            if (jsonPath) {
                value = get(fileData, jsonPath);
            } else {
                value = fileData;
            }
            
            if (value === undefined) {
                throw new Error(`Path '${jsonPath || 'root'}' not found in file '${filename}'`);
            }
            
            // Convert to string if it's not already
            return typeof value === 'string' ? value : JSON.stringify(value);
            
        } catch (error) {
            throw new Error(`FileSource failed to resolve key '${key}': ${error.message}`);
        }
    }

    parseKey(key) {
        // Key format: "filename#path.to.value" or just "filename"
        const parts = key.split('#');
        const filename = parts[0];
        const jsonPath = parts[1] || null;
        
        return { filename, jsonPath };
    }

    async loadFile(filename) {
        try {
            const filePath = path.resolve(this.config.basePath, filename);
            
            // Security check: ensure file is within basePath
            if (!filePath.startsWith(path.resolve(this.config.basePath))) {
                throw new Error(`File '${filename}' is outside allowed base path`);
            }
            
            // Check if file extension is allowed
            const ext = path.extname(filename).toLowerCase();
            if (!this.config.allowedExtensions.includes(ext)) {
                throw new Error(`File extension '${ext}' is not allowed. Allowed: ${this.config.allowedExtensions.join(', ')}`);
            }
            
            // Check cache if enabled
            if (this.config.cacheFiles) {
                const cachedData = await this.getCachedFile(filePath);
                if (cachedData !== null) {
                    return cachedData;
                }
            }
            
            // Check file size
            const stats = await fs.stat(filePath);
            if (stats.size > this.config.maxFileSize) {
                throw new Error(`File '${filename}' is too large (${stats.size} bytes, max: ${this.config.maxFileSize})`);
            }
            
            // Read and parse file
            const content = await fs.readFile(filePath, 'utf8');
            let data;
            
            switch (ext) {
                case '.json':
                    data = JSON.parse(content);
                    break;
                case '.yaml':
                case '.yml':
                    data = yaml.load(content);
                    break;
                default:
                    throw new Error(`Unsupported file extension: ${ext}`);
            }
            
            // Cache the parsed data
            if (this.config.cacheFiles) {
                this.fileCache.set(filePath, data);
                this.fileMTimes.set(filePath, stats.mtime.getTime());
            }
            
            return data;
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`File '${filename}' not found`);
            } else if (error.code === 'EACCES') {
                throw new Error(`Permission denied reading file '${filename}'`);
            } else if (error instanceof SyntaxError) {
                throw new Error(`Invalid JSON/YAML syntax in file '${filename}': ${error.message}`);
            }
            throw error;
        }
    }

    async getCachedFile(filePath) {
        if (!this.fileCache.has(filePath)) {
            return null;
        }
        
        try {
            // Check if file has been modified
            const stats = await fs.stat(filePath);
            const cachedMTime = this.fileMTimes.get(filePath);
            
            if (stats.mtime.getTime() !== cachedMTime) {
                // File has been modified, invalidate cache
                this.fileCache.delete(filePath);
                this.fileMTimes.delete(filePath);
                return null;
            }
            
            return this.fileCache.get(filePath);
        } catch (error) {
            // If we can't stat the file, invalidate cache
            this.fileCache.delete(filePath);
            this.fileMTimes.delete(filePath);
            return null;
        }
    }

    async refreshCache() {
        // Clear all cached files to force reload
        this.fileCache.clear();
        this.fileMTimes.clear();
    }

    async cleanup() {
        this.fileCache.clear();
        this.fileMTimes.clear();
    }

    // Utility method to validate a file before resolution
    async validateFile(filename) {
        try {
            const filePath = path.resolve(this.config.basePath, filename);
            
            // Security check
            if (!filePath.startsWith(path.resolve(this.config.basePath))) {
                throw new Error(`File '${filename}' is outside allowed base path`);
            }
            
            // Extension check
            const ext = path.extname(filename).toLowerCase();
            if (!this.config.allowedExtensions.includes(ext)) {
                throw new Error(`File extension '${ext}' is not allowed`);
            }
            
            // Existence and size check
            const stats = await fs.stat(filePath);
            if (stats.size > this.config.maxFileSize) {
                throw new Error(`File '${filename}' is too large`);
            }
            
            return true;
        } catch (error) {
            throw new Error(`File validation failed: ${error.message}`);
        }
    }

    // Utility method to list available files
    async listAvailableFiles() {
        try {
            const files = await fs.readdir(this.config.basePath);
            const availableFiles = [];
            
            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (this.config.allowedExtensions.includes(ext)) {
                    try {
                        const filePath = path.join(this.config.basePath, file);
                        const stats = await fs.stat(filePath);
                        
                        if (stats.isFile() && stats.size <= this.config.maxFileSize) {
                            availableFiles.push({
                                filename: file,
                                size: stats.size,
                                modified: stats.mtime
                            });
                        }
                    } catch (error) {
                        // Skip files we can't access
                        continue;
                    }
                }
            }
            
            return availableFiles;
        } catch (error) {
            throw new Error(`Failed to list available files: ${error.message}`);
        }
    }
}

module.exports = FileSource;