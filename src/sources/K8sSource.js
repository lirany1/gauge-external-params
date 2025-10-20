const k8s = require('@kubernetes/client-node');
const get = require('lodash.get');

class K8sSource {
    constructor(config = {}) {
        this.config = {
            kubeconfig: config.kubeconfig || null, // Path to kubeconfig file
            namespace: config.namespace || 'default',
            context: config.context || null, // Specific context to use
            timeout: config.timeout || 5000,
            retries: config.retries || 2,
            ...config
        };
        this.k8sApi = null;
        this.k8sCoreV1Api = null;
        this.secretCache = new Map();
        this.configMapCache = new Map();
    }

    async initialize() {
        try {
            const kc = new k8s.KubeConfig();
            
            if (this.config.kubeconfig) {
                // Load from specified kubeconfig file
                kc.loadFromFile(this.config.kubeconfig);
            } else {
                // Try to load from default locations
                try {
                    kc.loadFromDefault();
                } catch (error) {
                    // If running in cluster, try in-cluster config
                    kc.loadFromCluster();
                }
            }
            
            // Set context if specified
            if (this.config.context) {
                kc.setCurrentContext(this.config.context);
            }
            
            // Create API clients
            this.k8sCoreV1Api = kc.makeApiClient(k8s.CoreV1Api);
            
            // Test connection
            await this.testConnection();
            
        } catch (error) {
            throw new Error(`Failed to initialize Kubernetes client: ${error.message}`);
        }
    }

    async testConnection() {
        try {
            // Test with a simple API call
            await this.k8sCoreV1Api.listNamespace();
        } catch (error) {
            if (error.response && error.response.statusCode === 401) {
                throw new Error('Kubernetes authentication failed. Check credentials.');
            } else if (error.response && error.response.statusCode === 403) {
                throw new Error('Kubernetes authorization failed. Check RBAC permissions.');
            } else {
                throw new Error(`Kubernetes connection test failed: ${error.message}`);
            }
        }
    }

    async resolve(key) {
        try {
            // Parse the key - format: "type:name:field" or "type:name"
            // Examples: "secret:my-secret:password", "configmap:my-config:database.url"
            const { type, name, field, namespace } = this.parseKey(key);
            
            // Use specified namespace or default
            const targetNamespace = namespace || this.config.namespace;
            
            let data;
            if (type === 'secret') {
                data = await this.getSecret(name, targetNamespace);
            } else if (type === 'configmap') {
                data = await this.getConfigMap(name, targetNamespace);
            } else {
                throw new Error(`Unsupported Kubernetes resource type: ${type}. Supported types: secret, configmap`);
            }
            
            // Extract and return the requested field
            return this.extractField(data, field);
            
        } catch (error) {
            throw new Error(`K8sSource failed to resolve key '${key}': ${error.message}`);
        }
    }

    parseKey(key) {
        // Key formats:
        // "secret:name" - get entire secret data
        // "secret:name:field" - get specific field from secret
        // "configmap:name:field" - get specific field from configmap
        // "secret:namespace/name:field" - specify namespace
        
        const parts = key.split(':');
        if (parts.length < 2) {
            throw new Error(`Invalid key format. Expected 'type:name' or 'type:name:field', got: ${key}`);
        }
        
        const type = parts[0];
        let name = parts[1];
        let field = parts.length > 2 ? parts.slice(2).join(':') : null;
        let namespace = null;
        
        // Check if namespace is specified in name
        if (name.includes('/')) {
            const nameParts = name.split('/');
            namespace = nameParts[0];
            name = nameParts[1];
        }
        
        return { type, name, field, namespace };
    }

    async getSecret(name, namespace) {
        try {
            const cacheKey = `secret:${namespace}:${name}`;
            
            // Check cache first
            const cachedSecret = this.getCachedData(cacheKey, this.secretCache);
            if (cachedSecret !== null) {
                return cachedSecret;
            }
            
            // Fetch secret from Kubernetes
            const response = await this.k8sCoreV1Api.readNamespacedSecret(name, namespace);
            const secret = response.body;
            
            if (!secret.data) {
                throw new Error(`Secret '${name}' in namespace '${namespace}' has no data`);
            }
            
            // Decode base64 values
            const decodedData = {};
            for (const [key, value] of Object.entries(secret.data)) {
                decodedData[key] = Buffer.from(value, 'base64').toString('utf8');
            }
            
            // Cache the decoded data
            this.setCachedData(cacheKey, decodedData, this.secretCache);
            
            return decodedData;
            
        } catch (error) {
            if (error.response && error.response.statusCode === 404) {
                throw new Error(`Secret '${name}' not found in namespace '${namespace}'`);
            } else if (error.response && error.response.statusCode === 403) {
                throw new Error(`Access denied to secret '${name}' in namespace '${namespace}'. Check RBAC permissions.`);
            } else {
                throw new Error(`Failed to fetch secret: ${error.message}`);
            }
        }
    }

    async getConfigMap(name, namespace) {
        try {
            const cacheKey = `configmap:${namespace}:${name}`;
            
            // Check cache first
            const cachedConfigMap = this.getCachedData(cacheKey, this.configMapCache);
            if (cachedConfigMap !== null) {
                return cachedConfigMap;
            }
            
            // Fetch configmap from Kubernetes
            const response = await this.k8sCoreV1Api.readNamespacedConfigMap(name, namespace);
            const configMap = response.body;
            
            if (!configMap.data) {
                throw new Error(`ConfigMap '${name}' in namespace '${namespace}' has no data`);
            }
            
            // Cache the data
            this.setCachedData(cacheKey, configMap.data, this.configMapCache);
            
            return configMap.data;
            
        } catch (error) {
            if (error.response && error.response.statusCode === 404) {
                throw new Error(`ConfigMap '${name}' not found in namespace '${namespace}'`);
            } else if (error.response && error.response.statusCode === 403) {
                throw new Error(`Access denied to ConfigMap '${name}' in namespace '${namespace}'. Check RBAC permissions.`);
            } else {
                throw new Error(`Failed to fetch ConfigMap: ${error.message}`);
            }
        }
    }

    extractField(data, field) {
        if (!field) {
            // Return the entire data as JSON string
            return JSON.stringify(data);
        }
        
        // Extract specific field using lodash.get for nested paths
        const value = get(data, field);
        
        if (value === undefined) {
            throw new Error(`Field '${field}' not found in resource data`);
        }
        
        return value;
    }

    getCachedData(key, cache) {
        const cached = cache.get(key);
        if (!cached) {
            return null;
        }
        
        // Cache data for 2 minutes by default (K8s resources can change frequently)
        const cacheTimeout = this.config.cacheTimeout || 120000; // 2 minutes
        if (Date.now() - cached.timestamp > cacheTimeout) {
            cache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    setCachedData(key, data, cache) {
        cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    async refreshCache() {
        // Clear all cached data to force refresh
        this.secretCache.clear();
        this.configMapCache.clear();
    }

    async cleanup() {
        this.secretCache.clear();
        this.configMapCache.clear();
        this.k8sCoreV1Api = null;
    }

    // Utility method to list secrets in a namespace
    async listSecrets(namespace = null) {
        try {
            const targetNamespace = namespace || this.config.namespace;
            const response = await this.k8sCoreV1Api.listNamespacedSecret(targetNamespace);
            
            return response.body.items.map(secret => ({
                name: secret.metadata.name,
                namespace: secret.metadata.namespace,
                type: secret.type,
                dataKeys: Object.keys(secret.data || {}),
                creationTime: secret.metadata.creationTimestamp
            }));
        } catch (error) {
            throw new Error(`Failed to list secrets: ${error.message}`);
        }
    }

    // Utility method to list configmaps in a namespace
    async listConfigMaps(namespace = null) {
        try {
            const targetNamespace = namespace || this.config.namespace;
            const response = await this.k8sCoreV1Api.listNamespacedConfigMap(targetNamespace);
            
            return response.body.items.map(configMap => ({
                name: configMap.metadata.name,
                namespace: configMap.metadata.namespace,
                dataKeys: Object.keys(configMap.data || {}),
                creationTime: configMap.metadata.creationTimestamp
            }));
        } catch (error) {
            throw new Error(`Failed to list ConfigMaps: ${error.message}`);
        }
    }

    // Utility method to check if a resource exists
    async resourceExists(type, name, namespace = null) {
        try {
            const targetNamespace = namespace || this.config.namespace;
            
            if (type === 'secret') {
                await this.k8sCoreV1Api.readNamespacedSecret(name, targetNamespace);
            } else if (type === 'configmap') {
                await this.k8sCoreV1Api.readNamespacedConfigMap(name, targetNamespace);
            } else {
                throw new Error(`Unsupported resource type: ${type}`);
            }
            
            return true;
        } catch (error) {
            if (error.response && error.response.statusCode === 404) {
                return false;
            }
            throw error;
        }
    }

    // Utility method to get available namespaces
    async listNamespaces() {
        try {
            const response = await this.k8sCoreV1Api.listNamespace();
            
            return response.body.items.map(namespace => ({
                name: namespace.metadata.name,
                status: namespace.status.phase,
                creationTime: namespace.metadata.creationTimestamp
            }));
        } catch (error) {
            throw new Error(`Failed to list namespaces: ${error.message}`);
        }
    }
}

module.exports = K8sSource;