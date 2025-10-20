const fs = require('fs').promises;
const path = require('path');

// Import source resolvers
const EnvSource = require('../sources/EnvSource');
const FileSource = require('../sources/FileSource');
const HttpSource = require('../sources/HttpSource');
const VaultSource = require('../sources/VaultSource');
const AwsSecretsSource = require('../sources/AwsSecretsSource');
const K8sSource = require('../sources/K8sSource');

class ParamResolver {
    constructor(configPath = null) {
        this.config = null;
        this.configPath = configPath || path.join(process.cwd(), 'gauge-external-params.json');
        this.sources = new Map();
        this.cache = new Map();
        this.cacheTimeout = 60000; // 1 minute default TTL
        
        // Placeholder regex: <name:source#key|default>
        // Groups: name(1), source(2), key(3), default(4)
        this.placeholderRegex = /<([^:]+):([^#]+)#([^|>]+)(?:\|([^>]+))?>/g;
        
        // Source precedence: env > file > vault/aws/k8s > http > default
        this.sourcePrecedence = ['env', 'file', 'vault', 'aws', 'k8s', 'http'];
    }

    async initialize() {
        try {
            // Load configuration
            await this.loadConfig();
            
            // Initialize sources
            await this.initializeSources();
            
            console.log('ParamResolver initialized successfully');
        } catch (error) {
            console.error('Failed to initialize ParamResolver:', error.message);
            throw error;
        }
    }

    async loadConfig() {
        try {
            const configContent = await fs.readFile(this.configPath, 'utf8');
            this.config = JSON.parse(configContent);
            
            // Set cache timeout from config
            if (this.config.cacheTimeout) {
                this.cacheTimeout = this.config.cacheTimeout * 1000; // Convert to milliseconds
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`Config file not found at ${this.configPath}, using defaults`);
                this.config = this.getDefaultConfig();
            } else {
                throw new Error(`Failed to load config: ${error.message}`);
            }
        }
    }

    getDefaultConfig() {
        return {
            cacheTimeout: 60,
            sources: {
                env: { enabled: true },
                file: { 
                    enabled: true,
                    basePath: process.cwd()
                },
                http: { 
                    enabled: true,
                    timeout: 3000
                },
                vault: { 
                    enabled: false,
                    url: 'http://localhost:8200',
                    token: null
                },
                aws: { 
                    enabled: false,
                    region: 'us-east-1'
                },
                k8s: { 
                    enabled: false,
                    namespace: 'default'
                }
            }
        };
    }

    async initializeSources() {
        const sourceConfig = this.config.sources || {};
        
        // Initialize environment source
        if (sourceConfig.env?.enabled !== false) {
            this.sources.set('env', new EnvSource(sourceConfig.env));
        }
        
        // Initialize file source
        if (sourceConfig.file?.enabled !== false) {
            this.sources.set('file', new FileSource(sourceConfig.file));
        }
        
        // Initialize HTTP source
        if (sourceConfig.http?.enabled !== false) {
            this.sources.set('http', new HttpSource(sourceConfig.http));
        }
        
        // Initialize Vault source
        if (sourceConfig.vault?.enabled === true) {
            this.sources.set('vault', new VaultSource(sourceConfig.vault));
        }
        
        // Initialize AWS Secrets source
        if (sourceConfig.aws?.enabled === true) {
            this.sources.set('aws', new AwsSecretsSource(sourceConfig.aws));
        }
        
        // Initialize Kubernetes source
        if (sourceConfig.k8s?.enabled === true) {
            this.sources.set('k8s', new K8sSource(sourceConfig.k8s));
        }
        
        // Initialize all sources
        for (const [name, source] of this.sources) {
            try {
                await source.initialize();
                console.log(`Initialized ${name} source`);
            } catch (error) {
                console.warn(`Failed to initialize ${name} source:`, error.message);
                // Don't fail initialization if a source fails, just disable it
                this.sources.delete(name);
            }
        }
    }

    async resolveText(text) {
        if (!text || typeof text !== 'string') {
            return text;
        }

        let resolvedText = text;
        const matches = [...text.matchAll(this.placeholderRegex)];
        
        for (const match of matches) {
            const [fullMatch, name, source, key, defaultValue] = match;
            
            try {
                const resolvedValue = await this.resolvePlaceholder(name, source, key, defaultValue);
                resolvedText = resolvedText.replace(fullMatch, resolvedValue);
            } catch (error) {
                console.error(`Failed to resolve placeholder ${fullMatch}:`, error.message);
                
                if (defaultValue !== undefined) {
                    resolvedText = resolvedText.replace(fullMatch, defaultValue);
                } else {
                    throw new Error(`Failed to resolve required placeholder ${fullMatch}: ${error.message}`);
                }
            }
        }
        
        return resolvedText;
    }

    async resolvePlaceholder(name, sourceType, key, defaultValue) {
        const cacheKey = `${name}:${sourceType}:${key}`;
        
        // Check cache first
        const cachedValue = this.getCachedValue(cacheKey);
        if (cachedValue !== null) {
            return cachedValue;
        }
        
        let resolvedValue = null;
        let lastError = null;
        
        // Try sources in order of precedence
        const orderedSources = this.getOrderedSources(sourceType);
        
        for (const source of orderedSources) {
            try {
                resolvedValue = await source.resolve(key);
                if (resolvedValue !== null && resolvedValue !== undefined) {
                    // Cache the resolved value
                    this.setCachedValue(cacheKey, resolvedValue);
                    return resolvedValue;
                }
            } catch (error) {
                lastError = error;
                console.warn(`Source ${source.constructor.name} failed for key ${key}:`, error.message);
            }
        }
        
        // If no source could resolve the value, try the default
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        
        // No value found and no default provided
        throw new Error(`Could not resolve placeholder for key '${key}' from source '${sourceType}'. Last error: ${lastError?.message || 'No sources available'}`);
    }

    getOrderedSources(preferredSourceType) {
        const sources = [];
        
        // First, try the preferred source type
        if (this.sources.has(preferredSourceType)) {
            sources.push(this.sources.get(preferredSourceType));
        }
        
        // Then try other sources in precedence order
        for (const sourceType of this.sourcePrecedence) {
            if (sourceType !== preferredSourceType && this.sources.has(sourceType)) {
                sources.push(this.sources.get(sourceType));
            }
        }
        
        return sources;
    }

    getCachedValue(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            return null;
        }
        
        // Check if cache entry has expired
        if (Date.now() - cached.timestamp > this.cacheTimeout) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.value;
    }

    setCachedValue(key, value) {
        this.cache.set(key, {
            value: value,
            timestamp: Date.now()
        });
    }

    async refreshCaches() {
        // Clear all cached values to force refresh
        this.cache.clear();
        
        // Optionally, refresh source-specific caches
        for (const [name, source] of this.sources) {
            if (typeof source.refreshCache === 'function') {
                try {
                    await source.refreshCache();
                } catch (error) {
                    console.warn(`Failed to refresh cache for ${name} source:`, error.message);
                }
            }
        }
    }

    async cleanup() {
        // Clear caches
        this.cache.clear();
        
        // Cleanup sources
        for (const [name, source] of this.sources) {
            if (typeof source.cleanup === 'function') {
                try {
                    await source.cleanup();
                } catch (error) {
                    console.warn(`Failed to cleanup ${name} source:`, error.message);
                }
            }
        }
        
        this.sources.clear();
    }

    // Utility method to parse placeholder syntax
    static parsePlaceholder(placeholderText) {
        const regex = /<([^:]+):([^#]+)#([^|>]+)(?:\|([^>]+))?>/;
        const match = placeholderText.match(regex);
        
        if (!match) {
            throw new Error(`Invalid placeholder syntax: ${placeholderText}`);
        }
        
        return {
            name: match[1],
            source: match[2],
            key: match[3],
            defaultValue: match[4]
        };
    }

    // Utility method to create placeholder text
    static createPlaceholder(name, source, key, defaultValue = null) {
        let placeholder = `<${name}:${source}#${key}`;
        if (defaultValue !== null) {
            placeholder += `|${defaultValue}`;
        }
        placeholder += '>';
        return placeholder;
    }
}

module.exports = ParamResolver;