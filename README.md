# Gauge External Parameters Plugin

A powerful Gauge plugin that enables dynamic resolution of placeholders in spec files from external sources like environment variables, JSON/YAML files, HTTP APIs, HashiCorp Vault, AWS Secrets Manager, and Kubernetes ConfigMaps/Secrets.

## Features

- 🔐 **Multiple Data Sources**: Environment variables, files, HTTP APIs, Vault, AWS Secrets Manager, Kubernetes
- 🎯 **Flexible Syntax**: `<name:source#key|default>` format with fallback support
- ⚡ **Smart Caching**: Configurable TTL and automatic cache invalidation
- 🔄 **Source Precedence**: env > file > vault/aws/k8s > http > default
- 🛡️ **Security**: Automatic secret masking in logs and error messages
- 🔧 **Preprocessor Mode**: CLI tool for spec transformation in CI pipelines
- 📊 **Comprehensive Logging**: Detailed error reporting and debugging support

## Installation

### Using Gauge Package Manager

```bash
gauge install gauge-external-params
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/your-org/gauge-external-params.git
cd gauge-external-params

# Install dependencies
npm install

# Build and package
npm pack

# Install the plugin
gauge install gauge-external-params --file gauge-external-params-1.0.0.tgz
```

## Quick Start

1. **Create Configuration File**

Create `gauge-external-params.json` in your project root:

```json
{
  "cacheTimeout": 60,
  "sources": {
    "env": { "enabled": true },
    "file": { "enabled": true, "basePath": "." },
    "http": { "enabled": true, "timeout": 3000 }
  }
}
```

2. **Use Placeholders in Specs**

```markdown
# Login Feature
## Admin Login
* Login with user <admin_user:env#ADMIN_USER|admin@example.com> and password <admin_pass:file#secrets.json#admin_password>
```

3. **Set Environment Variables**

```bash
export ADMIN_USER="admin@mycompany.com"
```

4. **Create Secrets File**

```json
{
  "admin_password": "secure_password_123"
}
```

5. **Run Tests**

```bash
gauge run specs/
```

## Placeholder Syntax

### Basic Format
```
<name:source#key|default>
```

- **name**: Descriptive identifier for the placeholder
- **source**: Data source type (env, file, http, vault, aws, k8s)
- **key**: Source-specific key or path
- **default**: Optional fallback value

### Examples by Source

#### Environment Variables
```markdown
<user:env#USERNAME>
<token:env#API_TOKEN|default-token>
<url:env#SERVICE_URL>
```

#### JSON/YAML Files
```markdown
<user:file#secrets.json#admin_user>
<host:file#config.yaml#database.host>
<config:file#app-settings.json#api.endpoints.users>
```

#### HTTP APIs
```markdown
<token:http#https://auth-service.com/token>
<config:http#https://config-api.com/settings#database.url>
<data:http#POST:https://api.com/auth:{"user":"admin"}#access_token>
```

#### HashiCorp Vault
```markdown
<secret:vault#secret/myapp:password>
<token:vault#secret/tokens:api_key>
<config:vault#secret/config>
```

#### AWS Secrets Manager
```markdown
<secret:aws#prod/myapp/db:password>
<token:aws#prod/api-keys:github_token>
<config:aws#prod/config@AWSPENDING:database_url>
```

#### Kubernetes
```markdown
<secret:k8s#secret:my-secret:password>
<config:k8s#configmap:app-config:database.url>
<token:k8s#secret:prod-namespace/api-tokens:github>
```

## Configuration

### Complete Configuration Example

```json
{
  "cacheTimeout": 60,
  "sources": {
    "env": {
      "enabled": true,
      "prefix": "APP_",
      "transformCase": "upper"
    },
    "file": {
      "enabled": true,
      "basePath": "./config",
      "allowedExtensions": [".json", ".yaml", ".yml"],
      "cacheFiles": true,
      "maxFileSize": 1048576
    },
    "http": {
      "enabled": true,
      "timeout": 3000,
      "retries": 2,
      "baseURL": "https://api.example.com",
      "headers": {
        "User-Agent": "gauge-external-params/1.0.0"
      },
      "auth": {
        "token": "bearer-token-here"
      },
      "cacheResponses": true,
      "cacheTimeout": 300000
    },
    "vault": {
      "enabled": true,
      "url": "https://vault.example.com",
      "token": "vault-token-here",
      "namespace": "myapp",
      "mount": "secret",
      "version": "v2",
      "timeout": 5000,
      "retries": 2,
      "cacheTimeout": 300000
    },
    "aws": {
      "enabled": true,
      "region": "us-west-2",
      "profile": "production",
      "roleArn": "arn:aws:iam::123456789012:role/gauge-secrets-role",
      "timeout": 5000,
      "retries": 2,
      "cacheTimeout": 300000
    },
    "k8s": {
      "enabled": true,
      "kubeconfig": "~/.kube/config",
      "namespace": "production",
      "context": "prod-cluster",
      "timeout": 5000,
      "retries": 2,
      "cacheTimeout": 120000
    }
  },
  "logging": {
    "level": "info",
    "maskSecrets": true
  }
}
```

### Source Configuration Details

#### Environment Variables (`env`)
- `prefix`: Add prefix to all environment variable names
- `transformCase`: Transform case (`upper`, `lower`, `none`)

#### File Source (`file`)
- `basePath`: Base directory for relative file paths
- `allowedExtensions`: Allowed file extensions for security
- `cacheFiles`: Enable file content caching
- `maxFileSize`: Maximum file size in bytes

#### HTTP Source (`http`)
- `baseURL`: Base URL for relative requests
- `timeout`: Request timeout in milliseconds
- `retries`: Number of retry attempts
- `headers`: Default headers for all requests
- `auth`: Authentication configuration

#### Vault Source (`vault`)
- `url`: Vault server URL
- `token`: Vault authentication token
- `namespace`: Vault namespace (Vault Enterprise)
- `mount`: KV secret engine mount path
- `version`: KV engine version (`v1` or `v2`)

#### AWS Secrets Source (`aws`)
- `region`: AWS region
- `profile`: AWS CLI profile name
- `roleArn`: IAM role to assume
- `accessKeyId`, `secretAccessKey`: Direct credentials

#### Kubernetes Source (`k8s`)
- `kubeconfig`: Path to kubeconfig file
- `namespace`: Default namespace
- `context`: Kubernetes context to use

## Usage Modes

### Plugin Mode (Recommended)

The plugin automatically resolves placeholders during test execution:

```bash
gauge run specs/
```

### Preprocessor Mode

For CI/CD pipelines or when plugin mode isn't available:

```bash
# Process specs and output resolved versions
npx gauge-external-params preprocess --spec-dir specs/ --out-dir specs_resolved/

# Run tests with resolved specs
gauge run specs_resolved/
```

### CLI Options

```bash
# Start plugin server
npx gauge-external-params start

# Preprocess specs
npx gauge-external-params preprocess --spec-dir specs/ --out-dir resolved/

# Validate placeholders
npx gauge-external-params validate --spec-dir specs/

# Show usage statistics
npx gauge-external-params stats --spec-dir specs/
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Gauge Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '16'
          
      - name: Install Gauge
        run: |
          curl -SsL https://downloads.gauge.org/stable | sh
          gauge install java
          
      - name: Install dependencies
        run: npm install
        
      - name: Install Gauge External Params
        run: gauge install gauge-external-params
        
      - name: Set environment variables
        env:
          ADMIN_USER: ${{ secrets.ADMIN_USER }}
          API_TOKEN: ${{ secrets.API_TOKEN }}
        run: |
          echo "ADMIN_USER=$ADMIN_USER" >> $GITHUB_ENV
          echo "API_TOKEN=$API_TOKEN" >> $GITHUB_ENV
          
      - name: Run tests
        run: gauge run specs/
```

### Jenkins Pipeline

```groovy
pipeline {
    agent any
    
    environment {
        ADMIN_USER = credentials('admin-user')
        API_TOKEN = credentials('api-token')
    }
    
    stages {
        stage('Setup') {
            steps {
                sh 'npm install'
                sh 'gauge install gauge-external-params'
            }
        }
        
        stage('Test') {
            steps {
                sh 'gauge run specs/'
            }
        }
    }
    
    post {
        always {
            publishHTML([
                allowMissing: false,
                alwaysLinkToLastBuild: true,
                keepAll: true,
                reportDir: 'reports/html-report',
                reportFiles: 'index.html',
                reportName: 'Gauge Test Report'
            ])
        }
    }
}
```

### GitLab CI

```yaml
stages:
  - test

test:
  stage: test
  image: node:16
  before_script:
    - curl -SsL https://downloads.gauge.org/stable | sh
    - gauge install java
    - npm install
    - gauge install gauge-external-params
  script:
    - gauge run specs/
  variables:
    ADMIN_USER: $ADMIN_USER
    API_TOKEN: $API_TOKEN
  artifacts:
    reports:
      junit: reports/xml-report/result.xml
    paths:
      - reports/
```

## Security Best Practices

### 1. Environment Variables
```bash
# Use secure variable storage in CI/CD
export VAULT_TOKEN="hvs.secret_token_here"
export AWS_SECRET_ACCESS_KEY="secret_key_here"
```

### 2. File Permissions
```bash
# Restrict access to sensitive files
chmod 600 secrets.json
chmod 600 ~/.kube/config
```

### 3. Vault Authentication
```bash
# Use short-lived tokens
vault write -field=token auth/aws/login role=gauge-runner
```

### 4. AWS IAM Policies
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-west-2:123456789012:secret:prod/myapp/*"
    }
  ]
}
```

### 5. Kubernetes RBAC
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: gauge-external-params
rules:
- apiGroups: [""]
  resources: ["secrets", "configmaps"]
  verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: gauge-external-params
subjects:
- kind: ServiceAccount
  name: gauge-runner
roleRef:
  kind: Role
  name: gauge-external-params
  apiGroup: rbac.authorization.k8s.io
```

## Troubleshooting

### Common Issues

#### 1. Plugin Not Starting
```bash
# Check Gauge plugin directory
gauge --version
ls ~/.gauge/plugins/

# Reinstall plugin
gauge uninstall gauge-external-params
gauge install gauge-external-params
```

#### 2. Configuration Not Found
```bash
# Verify config file location
ls -la gauge-external-params.json

# Use absolute path
export GAUGE_EXTERNAL_PARAMS_CONFIG=/absolute/path/to/config.json
```

#### 3. Source Authentication Failures
```bash
# Check environment variables
env | grep -E "(VAULT_|AWS_|KUBE)"

# Test source connectivity
npx gauge-external-params test-sources
```

#### 4. Placeholder Resolution Errors
```bash
# Enable verbose logging
export GAUGE_EXTERNAL_PARAMS_VERBOSE=true

# Validate placeholders
npx gauge-external-params validate --spec-dir specs/
```

### Debug Mode

Enable debug logging:

```json
{
  "logging": {
    "level": "debug",
    "maskSecrets": false
  }
}
```

### Logs Location

- **Plugin logs**: `~/.gauge/logs/`
- **Application logs**: `./logs/gauge-external-params.log`

## Development

### Setup Development Environment

```bash
git clone https://github.com/your-org/gauge-external-params.git
cd gauge-external-params
npm install
```

### Run Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Test with coverage
npm run test:coverage
```

### Build and Package

```bash
# Build the plugin
npm run build

# Create package
npm pack

# Install locally for testing
gauge install gauge-external-params --file gauge-external-params-1.0.0.tgz
```

## API Reference

### ParamResolver Class

```javascript
const ParamResolver = require('gauge-external-params/src/resolver/ParamResolver');

const resolver = new ParamResolver('./config.json');
await resolver.initialize();

// Resolve text with placeholders
const resolved = await resolver.resolveText('Hello <user:env#USERNAME>!');

// Parse placeholder syntax
const parsed = ParamResolver.parsePlaceholder('<user:env#USERNAME|admin>');

await resolver.cleanup();
```

### Source Interfaces

All sources implement the same interface:

```javascript
class SourceInterface {
  async initialize() { /* Setup source */ }
  async resolve(key) { /* Resolve value for key */ }
  async cleanup() { /* Cleanup resources */ }
  async refreshCache() { /* Clear cached data */ }
}
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Code Style

- Use ESLint configuration
- Follow conventional commit messages
- Add tests for new features
- Update documentation

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- 📝 [Documentation](https://github.com/your-org/gauge-external-params/wiki)
- 🐛 [Issue Tracker](https://github.com/your-org/gauge-external-params/issues)
- 💬 [Discussions](https://github.com/your-org/gauge-external-params/discussions)
- 📧 [Email Support](mailto:support@example.com)

## Changelog

### v1.0.0
- Initial release
- Support for 6 data sources
- Plugin and preprocessor modes
- Comprehensive configuration options
- Full test coverage