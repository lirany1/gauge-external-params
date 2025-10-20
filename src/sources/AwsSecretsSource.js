const AWS = require('aws-sdk');
const get = require('lodash.get');

class AwsSecretsSource {
    constructor(config = {}) {
        this.config = {
            region: config.region || process.env.AWS_DEFAULT_REGION || 'us-east-1',
            accessKeyId: config.accessKeyId || process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: config.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: config.sessionToken || process.env.AWS_SESSION_TOKEN,
            profile: config.profile || process.env.AWS_PROFILE,
            roleArn: config.roleArn,
            timeout: config.timeout || 5000,
            retries: config.retries || 2,
            ...config
        };
        this.secretsManager = null;
        this.secretCache = new Map();
    }

    async initialize() {
        try {
            // Configure AWS SDK
            const awsConfig = {
                region: this.config.region,
                maxRetries: this.config.retries,
                httpOptions: {
                    timeout: this.config.timeout
                }
            };

            // Use explicit credentials if provided
            if (this.config.accessKeyId && this.config.secretAccessKey) {
                awsConfig.accessKeyId = this.config.accessKeyId;
                awsConfig.secretAccessKey = this.config.secretAccessKey;
                
                if (this.config.sessionToken) {
                    awsConfig.sessionToken = this.config.sessionToken;
                }
            } else if (this.config.profile) {
                // Use AWS profile
                AWS.config.credentials = new AWS.SharedIniFileCredentials({
                    profile: this.config.profile
                });
            }

            // Assume role if specified
            if (this.config.roleArn) {
                const sts = new AWS.STS(awsConfig);
                const assumeRoleParams = {
                    RoleArn: this.config.roleArn,
                    RoleSessionName: 'gauge-external-params-' + Date.now()
                };
                
                const roleResult = await sts.assumeRole(assumeRoleParams).promise();
                
                awsConfig.accessKeyId = roleResult.Credentials.AccessKeyId;
                awsConfig.secretAccessKey = roleResult.Credentials.SecretAccessKey;
                awsConfig.sessionToken = roleResult.Credentials.SessionToken;
            }

            this.secretsManager = new AWS.SecretsManager(awsConfig);
            
            // Test connection
            await this.testConnection();
            
        } catch (error) {
            throw new Error(`Failed to initialize AWS Secrets Manager: ${error.message}`);
        }
    }

    async testConnection() {
        try {
            // Test with a simple list operation (limited to 1 result)
            await this.secretsManager.listSecrets({ MaxResults: 1 }).promise();
        } catch (error) {
            if (error.code === 'UnauthorizedOperation' || error.code === 'AccessDenied') {
                throw new Error(`AWS credentials are invalid or insufficient permissions: ${error.message}`);
            } else if (error.code === 'SignatureDoesNotMatch') {
                throw new Error(`AWS signature validation failed. Check credentials and region.`);
            } else {
                throw new Error(`AWS connection test failed: ${error.message}`);
            }
        }
    }

    async resolve(key) {
        try {
            // Parse the key - format: "secretName:field" or "secretName"
            const { secretName, field, versionId, versionStage } = this.parseKey(key);
            
            // Check cache first
            const cacheKey = `${secretName}:${versionId || versionStage || 'AWSCURRENT'}`;
            const cachedSecret = this.getCachedSecret(cacheKey);
            if (cachedSecret !== null) {
                return this.extractField(cachedSecret, field);
            }
            
            // Fetch secret from AWS Secrets Manager
            const secret = await this.fetchSecret(secretName, versionId, versionStage);
            
            // Cache the secret
            this.setCachedSecret(cacheKey, secret);
            
            // Extract and return the requested field
            return this.extractField(secret, field);
            
        } catch (error) {
            throw new Error(`AwsSecretsSource failed to resolve key '${key}': ${error.message}`);
        }
    }

    parseKey(key) {
        // Key formats:
        // "secretName" - get entire secret
        // "secretName:field" - get specific field
        // "secretName@versionId:field" - get specific version
        // "secretName@AWSPENDING:field" - get specific version stage
        
        let secretName = key;
        let field = null;
        let versionId = null;
        let versionStage = null;
        
        // Check for version specifier (@)
        const versionParts = key.split('@');
        if (versionParts.length > 1) {
            secretName = versionParts[0];
            const versionPart = versionParts[1];
            
            // Check if this is a version ID (UUID format) or version stage
            if (versionPart.match(/^[a-f0-9-]{36}$/i)) {
                versionId = versionPart.split(':')[0];
                if (versionPart.includes(':')) {
                    field = versionPart.split(':')[1];
                }
            } else {
                versionStage = versionPart.split(':')[0];
                if (versionPart.includes(':')) {
                    field = versionPart.split(':')[1];
                }
            }
        } else {
            // No version specifier, check for field
            const parts = key.split(':');
            if (parts.length > 1) {
                secretName = parts[0];
                field = parts.slice(1).join(':'); // Join in case field contains colons
            }
        }
        
        return { secretName, field, versionId, versionStage };
    }

    async fetchSecret(secretName, versionId = null, versionStage = null) {
        try {
            const params = {
                SecretId: secretName
            };
            
            if (versionId) {
                params.VersionId = versionId;
            } else if (versionStage) {
                params.VersionStage = versionStage;
            }
            
            const result = await this.secretsManager.getSecretValue(params).promise();
            
            let secretData;
            if (result.SecretString) {
                try {
                    // Try to parse as JSON
                    secretData = JSON.parse(result.SecretString);
                } catch (jsonError) {
                    // If not JSON, return as string
                    secretData = result.SecretString;
                }
            } else if (result.SecretBinary) {
                // Handle binary secrets
                secretData = result.SecretBinary.toString('base64');
            } else {
                throw new Error('Secret contains no data');
            }
            
            return secretData;
            
        } catch (error) {
            if (error.code === 'ResourceNotFoundException') {
                throw new Error(`Secret '${secretName}' not found`);
            } else if (error.code === 'AccessDeniedException') {
                throw new Error(`Access denied to secret '${secretName}'. Check IAM permissions.`);
            } else if (error.code === 'InvalidParameterException') {
                throw new Error(`Invalid parameter for secret '${secretName}': ${error.message}`);
            } else if (error.code === 'DecryptionFailureException') {
                throw new Error(`Failed to decrypt secret '${secretName}'. Check KMS permissions.`);
            } else {
                throw new Error(`AWS Secrets Manager error: ${error.message}`);
            }
        }
    }

    extractField(secretData, field) {
        if (!field) {
            // Return the entire secret
            return typeof secretData === 'string' ? secretData : JSON.stringify(secretData);
        }
        
        if (typeof secretData === 'string') {
            throw new Error(`Cannot extract field '${field}' from string secret. Secret must be JSON.`);
        }
        
        // Extract specific field using lodash.get for nested paths
        const value = get(secretData, field);
        
        if (value === undefined) {
            throw new Error(`Field '${field}' not found in secret`);
        }
        
        // Convert to string if it's not already
        return typeof value === 'string' ? value : JSON.stringify(value);
    }

    getCachedSecret(key) {
        const cached = this.secretCache.get(key);
        if (!cached) {
            return null;
        }
        
        // Cache secrets for 5 minutes by default
        const cacheTimeout = this.config.cacheTimeout || 300000; // 5 minutes
        if (Date.now() - cached.timestamp > cacheTimeout) {
            this.secretCache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    setCachedSecret(key, data) {
        this.secretCache.set(key, {
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
        this.secretsManager = null;
    }

    // Utility method to list available secrets
    async listSecrets(maxResults = 100) {
        try {
            const params = {
                MaxResults: maxResults
            };
            
            const result = await this.secretsManager.listSecrets(params).promise();
            
            return result.SecretList.map(secret => ({
                name: secret.Name,
                arn: secret.ARN,
                description: secret.Description,
                lastChanged: secret.LastChangedDate,
                lastAccessed: secret.LastAccessedDate
            }));
            
        } catch (error) {
            throw new Error(`Failed to list secrets: ${error.message}`);
        }
    }

    // Utility method to check if a secret exists
    async secretExists(secretName) {
        try {
            await this.secretsManager.describeSecret({ SecretId: secretName }).promise();
            return true;
        } catch (error) {
            if (error.code === 'ResourceNotFoundException') {
                return false;
            }
            throw error;
        }
    }

    // Utility method to get secret metadata
    async getSecretMetadata(secretName) {
        try {
            const result = await this.secretsManager.describeSecret({ SecretId: secretName }).promise();
            return {
                name: result.Name,
                arn: result.ARN,
                description: result.Description,
                kmsKeyId: result.KmsKeyId,
                rotationEnabled: result.RotationEnabled,
                rotationLambdaARN: result.RotationLambdaARN,
                rotationRules: result.RotationRules,
                lastRotatedDate: result.LastRotatedDate,
                lastChangedDate: result.LastChangedDate,
                lastAccessedDate: result.LastAccessedDate,
                tags: result.Tags,
                versionIdsToStages: result.VersionIdsToStages
            };
        } catch (error) {
            throw new Error(`Failed to get secret metadata: ${error.message}`);
        }
    }
}

module.exports = AwsSecretsSource;