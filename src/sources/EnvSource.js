class EnvSource {
    constructor(config = {}) {
        this.config = {
            prefix: config.prefix || '',
            transformCase: config.transformCase || 'none', // 'upper', 'lower', 'none'
            ...config
        };
    }

    async initialize() {
        // Environment source requires no initialization
        return Promise.resolve();
    }

    async resolve(key) {
        try {
            // Apply prefix if configured
            let envKey = this.config.prefix ? `${this.config.prefix}${key}` : key;
            
            // Apply case transformation
            switch (this.config.transformCase) {
                case 'upper':
                    envKey = envKey.toUpperCase();
                    break;
                case 'lower':
                    envKey = envKey.toLowerCase();
                    break;
                default:
                    // Keep original case
                    break;
            }
            
            const value = process.env[envKey];
            
            if (value === undefined) {
                throw new Error(`Environment variable '${envKey}' not found`);
            }
            
            return value;
        } catch (error) {
            throw new Error(`EnvSource failed to resolve key '${key}': ${error.message}`);
        }
    }

    async cleanup() {
        // Environment source requires no cleanup
        return Promise.resolve();
    }

    // Optional: Method to refresh cache (not needed for env variables)
    async refreshCache() {
        // Environment variables don't need cache refresh
        return Promise.resolve();
    }

    // Utility method to check if an environment variable exists
    exists(key) {
        let envKey = this.config.prefix ? `${this.config.prefix}${key}` : key;
        
        switch (this.config.transformCase) {
            case 'upper':
                envKey = envKey.toUpperCase();
                break;
            case 'lower':
                envKey = envKey.toLowerCase();
                break;
        }
        
        return process.env[envKey] !== undefined;
    }

    // Utility method to list all available environment variables with optional prefix
    listAvailable() {
        const prefix = this.config.prefix || '';
        const available = [];
        
        for (const [key, value] of Object.entries(process.env)) {
            if (!prefix || key.startsWith(prefix)) {
                available.push({
                    key: prefix ? key.substring(prefix.length) : key,
                    originalKey: key,
                    hasValue: value !== undefined && value !== ''
                });
            }
        }
        
        return available;
    }
}

module.exports = EnvSource;