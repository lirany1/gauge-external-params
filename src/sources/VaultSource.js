const vault = require('node-vault');
const get = require('lodash.get');

class VaultSource {
    constructor(config = {}) {
        this.config = {
            url: config.url || 'http://localhost:8200',
            token: config.token || process.env.VAULT_TOKEN,
            namespace: config.namespace || process.env.VAULT_NAMESPACE,
            mount: config.mount || 'secret',
            version: config.version || 'v2', // 'v1' or 'v2'
            timeout: config.timeout || 5000,
            retries: config.retries || 2,
            ...config
        };
        this.vaultClient = null;
        this.secretCache = new Map();
    }

    async initialize() {
        if (!this.config.token) {
            throw new Error('Vault token is required. Set VAULT_TOKEN environment variable or provide in config.');
        }

        try {
            // Initialize Vault client
            const clientOptions = {
                apiVersion: 'v1',
                endpoint: this.config.url,
                token: this.config.token,
                timeout: this.config.timeout
            };

            if (this.config.namespace) {
                clientOptions.namespace = this.config.namespace;
            }

            this.vaultClient = vault(clientOptions);

            // Test connection
            await this.testConnection();
            
        } catch (error) {
            throw new Error(`Failed to initialize Vault client: ${error.message}`);
        }
    }

    async testConnection() {
        try {
            // Test with a simple health check
            await this.vaultClient.health();
        } catch (error) {
            // If health check fails, try token lookup as backup
            try {
                await this.vaultClient.tokenLookupSelf();
            } catch (tokenError) {
                throw new Error(`Vault connection failed: ${error.message}`);
            }
        }
    }

    async resolve(key) {
        try {
            // Parse the key - format: "path/to/secret:field" or "path/to/secret"
            const { secretPath, field } = this.parseKey(key);
            
            // Check cache first
            const cacheKey = secretPath;
            const cachedSecret = this.getCachedSecret(cacheKey);
            if (cachedSecret !== null) {
                return this.extractField(cachedSecret, field);
            }
            
            // Fetch secret from Vault
            const secret = await this.fetchSecret(secretPath);
            
            // Cache the secret
            this.setCachedSecret(cacheKey, secret);
            
            // Extract and return the requested field
            return this.extractField(secret, field);
            
        } catch (error) {
            throw new Error(`VaultSource failed to resolve key '${key}': ${error.message}`);
        }
    }

    parseKey(key) {
        // Key format: "path/to/secret:field" or "path/to/secret"
        const parts = key.split(':');
        const secretPath = parts[0];
        const field = parts[1] || null;
        
        return { secretPath, field };
    }

    async fetchSecret(secretPath) {
        try {
            let response;
            
            if (this.config.version === 'v2') {
                // KV v2 API
                const fullPath = `${this.config.mount}/data/${secretPath}`;
                response = await this.vaultClient.read(fullPath);
                
                if (!response || !response.data || !response.data.data) {
                    throw new Error(`Secret not found at path '${secretPath}'`);
                }
                
                return response.data.data;
            } else {
                // KV v1 API
                const fullPath = `${this.config.mount}/${secretPath}`;
                response = await this.vaultClient.read(fullPath);
                
                if (!response || !response.data) {
                    throw new Error(`Secret not found at path '${secretPath}'`);
                }
                
                return response.data;
            }
            
        } catch (error) {
            if (error.response && error.response.statusCode === 403) {
                throw new Error(`Access denied to secret '${secretPath}'. Check token permissions.`);
            } else if (error.response && error.response.statusCode === 404) {
                throw new Error(`Secret not found at path '${secretPath}'`);
            } else {
                throw new Error(`Failed to fetch secret: ${error.message}`);
            }
        }
    }

    extractField(secretData, field) {
        if (!field) {
            // Return the entire secret as JSON string
            return JSON.stringify(secretData);
        }
        
        // Extract specific field using lodash.get for nested paths
        const value = get(secretData, field);
        
        if (value === undefined) {
            throw new Error(`Field '${field}' not found in secret`);
        }
        
        // Convert to string if it's not already
        return typeof value === 'string' ? value : JSON.stringify(value);
    }

    getCachedSecret(path) {
        const cached = this.secretCache.get(path);
        if (!cached) {
            return null;
        }
        
        // Cache secrets for 5 minutes by default
        const cacheTimeout = this.config.cacheTimeout || 300000; // 5 minutes
        if (Date.now() - cached.timestamp > cacheTimeout) {
            this.secretCache.delete(path);
            return null;
        }
        
        return cached.data;
    }

    setCachedSecret(path, data) {
        this.secretCache.set(path, {
            data: data,
            timestamp: Date.now()
        });
    }

    async refreshCache() {
        // Clear all cached secrets to force refresh
        this.secretCache.clear();
    }

    async cleanup() {
        this.secretCache.clear();
        this.vaultClient = null;
    }

    // Utility method to list secrets at a path (for KV v2)
    async listSecrets(path = '') {
        try {
            if (this.config.version === 'v2') {
                const fullPath = `${this.config.mount}/metadata/${path}`;
                const response = await this.vaultClient.list(fullPath);
                return response.data.keys || [];
            } else {
                const fullPath = `${this.config.mount}/${path}`;
                const response = await this.vaultClient.list(fullPath);
                return response.data.keys || [];
            }
        } catch (error) {
            if (error.response && error.response.statusCode === 404) {
                return []; // No secrets found
            }
            throw new Error(`Failed to list secrets: ${error.message}`);
        }
    }

    // Utility method to check if a secret exists
    async secretExists(secretPath) {
        try {
            await this.fetchSecret(secretPath);
            return true;
        } catch (error) {
            return false;
        }
    }

    // Utility method to get secret metadata (for KV v2)
    async getSecretMetadata(secretPath) {
        if (this.config.version !== 'v2') {
            throw new Error('Secret metadata is only available in KV v2');
        }
        
        try {
            const fullPath = `${this.config.mount}/metadata/${secretPath}`;
            const response = await this.vaultClient.read(fullPath);
            return response.data;
        } catch (error) {
            throw new Error(`Failed to get secret metadata: ${error.message}`);
        }
    }
}

module.exports = VaultSource;