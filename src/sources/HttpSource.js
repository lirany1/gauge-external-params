const axios = require('axios');
const get = require('lodash.get');

class HttpSource {
    constructor(config = {}) {
        this.config = {
            timeout: config.timeout || 3000,
            retries: config.retries || 2,
            baseURL: config.baseURL || '',
            headers: config.headers || {},
            auth: config.auth || null, // { username, password } or { token }
            cacheResponses: config.cacheResponses !== false, // Default to true
            ...config
        };
        this.responseCache = new Map();
        this.httpClient = null;
    }

    async initialize() {
        // Setup axios instance with default configuration
        this.httpClient = axios.create({
            timeout: this.config.timeout,
            baseURL: this.config.baseURL,
            headers: this.config.headers
        });

        // Setup authentication if provided
        if (this.config.auth) {
            if (this.config.auth.token) {
                this.httpClient.defaults.headers.common['Authorization'] = `Bearer ${this.config.auth.token}`;
            } else if (this.config.auth.username && this.config.auth.password) {
                this.httpClient.defaults.auth = {
                    username: this.config.auth.username,
                    password: this.config.auth.password
                };
            }
        }

        // Setup request interceptor for retries
        this.setupRetryInterceptor();
    }

    setupRetryInterceptor() {
        this.httpClient.interceptors.response.use(
            (response) => response,
            async (error) => {
                const config = error.config;
                
                if (!config) {
                    return Promise.reject(error);
                }
                
                if (!config.retry) {
                    config.retry = 0;
                }
                
                if (config.retry < this.config.retries) {
                    config.retry++;
                    
                    // Wait before retry (exponential backoff)
                    const delay = Math.pow(2, config.retry) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    return this.httpClient(config);
                }
                
                return Promise.reject(error);
            }
        );
    }

    async resolve(key) {
        try {
            // Parse the key - format could be "url#path.to.value" or just "url"
            const { url, jsonPath, method, body } = this.parseKey(key);
            
            // Check cache first
            if (this.config.cacheResponses) {
                const cachedResponse = this.getCachedResponse(key);
                if (cachedResponse !== null) {
                    return this.extractValue(cachedResponse, jsonPath);
                }
            }
            
            // Make HTTP request
            const response = await this.makeRequest(url, method, body);
            
            // Cache response if enabled
            if (this.config.cacheResponses) {
                this.setCachedResponse(key, response.data);
            }
            
            // Extract and return value
            return this.extractValue(response.data, jsonPath);
            
        } catch (error) {
            throw new Error(`HttpSource failed to resolve key '${key}': ${error.message}`);
        }
    }

    parseKey(key) {
        // Key formats:
        // "url" - simple GET request
        // "url#path.to.value" - GET request with JSON path extraction
        // "POST:url:body#path.to.value" - POST request with body and JSON path
        
        let method = 'GET';
        let url = key;
        let body = null;
        let jsonPath = null;
        
        // Check for method prefix
        const methodMatch = key.match(/^(GET|POST|PUT|PATCH|DELETE):/);
        if (methodMatch) {
            method = methodMatch[1];
            key = key.substring(methodMatch[0].length);
        }
        
        // Split by # for JSON path
        const parts = key.split('#');
        if (parts.length > 1) {
            jsonPath = parts[1];
            key = parts[0];
        }
        
        // For POST/PUT/PATCH, check for body separator
        if (method !== 'GET' && method !== 'DELETE') {
            const bodyParts = key.split(':');
            if (bodyParts.length > 1) {
                url = bodyParts[0];
                body = bodyParts.slice(1).join(':');
                
                // Try to parse body as JSON
                try {
                    body = JSON.parse(body);
                } catch (error) {
                    // Keep as string if not valid JSON
                }
            } else {
                url = key;
            }
        } else {
            url = key;
        }
        
        return { url, jsonPath, method, body };
    }

    async makeRequest(url, method = 'GET', body = null) {
        const requestConfig = {
            method: method.toLowerCase(),
            url: url
        };
        
        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            requestConfig.data = body;
            
            // Set content type if not already set
            if (!this.httpClient.defaults.headers['Content-Type']) {
                requestConfig.headers = {
                    'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json'
                };
            }
        }
        
        try {
            const response = await this.httpClient(requestConfig);
            
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return response;
        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                throw new Error(`Request timeout after ${this.config.timeout}ms`);
            } else if (error.response) {
                throw new Error(`HTTP ${error.response.status}: ${error.response.statusText}`);
            } else if (error.request) {
                throw new Error(`Network error: ${error.message}`);
            } else {
                throw new Error(`Request setup error: ${error.message}`);
            }
        }
    }

    extractValue(data, jsonPath) {
        if (!jsonPath) {
            // Return the entire response, converting to string if needed
            return typeof data === 'string' ? data : JSON.stringify(data);
        }
        
        // Extract value using JSON path
        const value = get(data, jsonPath);
        
        if (value === undefined) {
            throw new Error(`Path '${jsonPath}' not found in response`);
        }
        
        // Convert to string if it's not already
        return typeof value === 'string' ? value : JSON.stringify(value);
    }

    getCachedResponse(key) {
        const cached = this.responseCache.get(key);
        if (!cached) {
            return null;
        }
        
        // Simple time-based cache expiry (5 minutes default)
        const cacheTimeout = this.config.cacheTimeout || 300000; // 5 minutes
        if (Date.now() - cached.timestamp > cacheTimeout) {
            this.responseCache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    setCachedResponse(key, data) {
        this.responseCache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    async refreshCache() {
        // Clear all cached responses to force refresh
        this.responseCache.clear();
    }

    async cleanup() {
        this.responseCache.clear();
        
        // No special cleanup needed for axios
        this.httpClient = null;
    }

    // Utility method to test a URL
    async testConnection(url) {
        try {
            const response = await this.httpClient.get(url);
            return {
                success: true,
                status: response.status,
                responseTime: response.config.metadata?.endTime - response.config.metadata?.startTime
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                status: error.response?.status
            };
        }
    }

    // Utility method to validate URL format
    static isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (error) {
            return false;
        }
    }
}

module.exports = HttpSource;