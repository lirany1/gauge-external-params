# GitHub Actions Setup Guide

This repository includes two GitHub Actions workflows:

## 1. CI - Build and Test (`ci.yml`)

Automatically builds and tests the Node.js project on every push and pull request.

### Features:
- ✅ Tests on multiple Node.js versions (14.x, 16.x, 18.x, 20.x)
- ✅ Runs npm tests with coverage
- ✅ Security audit checks
- ✅ Tests preprocessor functionality
- ✅ Uploads code coverage to Codecov

### No additional setup required - works out of the box!

---

## 2. Datadog Synthetic Tests (`datadog-synthetic.yml`)

Runs Datadog Synthetic monitoring tests as part of your CI/CD pipeline.

### Setup Required:

#### Step 1: Create Datadog Account
1. Sign up at [Datadog](https://www.datadoghq.com/)
2. Go to Organization Settings → API Keys
3. Create a new API Key
4. Go to Organization Settings → Application Keys
5. Create a new Application Key

#### Step 2: Create Synthetic Tests in Datadog
1. Log into your Datadog account
2. Go to **UX Monitoring → Synthetic Tests**
3. Click **New Test**
4. Choose test type:
   - **API Test**: For testing REST APIs, GraphQL, WebSocket, etc.
   - **Browser Test**: For testing user journeys in a browser
   - **SSL Test**: For monitoring SSL certificate expiration
   - **DNS Test**: For monitoring DNS resolution

5. Configure your test:
   ```
   Name: Gauge External Params - API Health Check
   URL: https://your-api-endpoint.com/health
   Locations: Select testing locations (e.g., AWS US East, Europe)
   Frequency: How often to run (e.g., every 5 minutes)
   Assertions: Define what success looks like
   ```

6. After creating tests, note down the **Public IDs** (e.g., `abc-def-ghi`)

#### Step 3: Add GitHub Secrets
1. Go to your GitHub repository
2. Navigate to **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Add the following secrets:

   | Secret Name | Description | Example |
   |------------|-------------|---------|
   | `DATADOG_API_KEY` | Your Datadog API Key | `1234567890abcdef...` |
   | `DATADOG_APP_KEY` | Your Datadog Application Key | `abcdef1234567890...` |
   | `DATADOG_PUBLIC_IDS` | Comma-separated test IDs | `abc-def-ghi,xyz-123-456` |
   | `DATADOG_API_TEST_IDS` | (Optional) API test IDs only | `api-test-123` |
   | `DATADOG_BROWSER_TEST_IDS` | (Optional) Browser test IDs | `browser-test-456` |
   | `TEST_BASE_URL` | (Optional) Base URL for tests | `https://api.example.com` |
   | `TEST_API_TOKEN` | (Optional) API token for auth | `your-token-here` |

#### Step 4: Configure Test Variables (Optional)
Edit `datadog-ci.json` to customize global settings:
```json
{
  "global": {
    "locations": ["aws:us-east-1", "aws:eu-central-1"],
    "deviceIds": ["laptop_large", "tablet", "mobile_small"],
    "variables": {
      "BASE_URL": "https://your-app.com",
      "API_KEY": "your-default-key"
    }
  }
}
```

#### Step 5: Example Synthetic Tests

**API Test Example (`tests/health-check.synthetics.json`):**
```json
{
  "name": "API Health Check",
  "type": "api",
  "subtype": "http",
  "config": {
    "request": {
      "method": "GET",
      "url": "{{BASE_URL}}/health",
      "headers": {
        "Authorization": "Bearer {{API_TOKEN}}"
      }
    },
    "assertions": [
      {
        "type": "statusCode",
        "operator": "is",
        "target": 200
      },
      {
        "type": "responseTime",
        "operator": "lessThan",
        "target": 2000
      }
    ]
  },
  "locations": ["aws:us-east-1"],
  "options": {
    "tick_every": 300
  }
}
```

**Browser Test Example:**
```json
{
  "name": "Login Flow Test",
  "type": "browser",
  "config": {
    "request": {
      "url": "{{BASE_URL}}/login"
    },
    "assertions": [],
    "variables": []
  },
  "steps": [
    {
      "type": "assertElementContent",
      "selector": "h1",
      "value": "Login"
    },
    {
      "type": "typeText",
      "selector": "#username",
      "value": "{{TEST_USERNAME}}"
    },
    {
      "type": "typeText",
      "selector": "#password",
      "value": "{{TEST_PASSWORD}}"
    },
    {
      "type": "click",
      "selector": "#submit-btn"
    },
    {
      "type": "assertCurrentUrl",
      "value": "{{BASE_URL}}/dashboard"
    }
  ]
}
```

### Workflow Triggers

The Datadog workflow runs on:
- ✅ **Push to master**: Runs after successful merge
- ✅ **Pull requests**: Tests changes before merging
- ✅ **Scheduled**: Every 6 hours (configurable)
- ✅ **Manual**: Via workflow_dispatch with environment selection

### Running Manually

You can trigger the Datadog tests manually:
1. Go to **Actions** tab in GitHub
2. Select **Datadog Synthetic Tests** workflow
3. Click **Run workflow**
4. Select environment (production/staging/development)
5. Click **Run workflow**

### Understanding Results

After workflow runs:
- Check the **Actions** tab for results
- Synthetic test results are uploaded as artifacts
- PR comments show test summary
- Datadog dashboard shows detailed metrics

### Troubleshooting

**Tests not running?**
- Verify secrets are correctly set
- Check that Public IDs are comma-separated without spaces
- Ensure Datadog API/App keys have correct permissions

**Tests failing?**
- Review Datadog dashboard for detailed error messages
- Check if test URLs are accessible from Datadog locations
- Verify authentication tokens are valid

**Need different Datadog site?**
Uncomment and modify in workflow:
```yaml
site: 'datadoghq.eu'  # For EU
# or
site: 'us3.datadoghq.com'  # For US3
```

### Local Testing

Test Datadog Synthetic locally:
```bash
# Install Datadog CLI
npm install -g @datadog/datadog-ci

# Set credentials
export DATADOG_API_KEY=your_api_key
export DATADOG_APP_KEY=your_app_key

# Run tests
datadog-ci synthetics run-tests \
  --public-id abc-def-ghi \
  --config datadog-ci.json
```

### Cost Considerations

- Datadog Synthetic Monitoring is a paid feature
- Free tier: 10,000 API test runs/month
- Browser tests are billed separately
- Monitor usage in Datadog Usage & Cost settings

### Resources

- [Datadog Synthetics Documentation](https://docs.datadoghq.com/synthetics/)
- [GitHub Action Documentation](https://github.com/DataDog/synthetics-ci-github-action)
- [Datadog CI CLI](https://github.com/DataDog/datadog-ci)
- [Create API Tests](https://docs.datadoghq.com/synthetics/api_tests/)
- [Create Browser Tests](https://docs.datadoghq.com/synthetics/browser_tests/)

---

## Quick Start Checklist

- [ ] Datadog account created
- [ ] API Key and App Key generated
- [ ] Synthetic tests created in Datadog
- [ ] Public IDs noted
- [ ] GitHub secrets configured
- [ ] First workflow run triggered
- [ ] Results reviewed in GitHub Actions
- [ ] Monitoring dashboard set up

## Support

For issues with:
- **GitHub Actions**: Open an issue in this repository
- **Datadog Synthetic**: Contact [Datadog Support](https://www.datadoghq.com/support/)
- **Integration**: Check [Datadog GitHub Action docs](https://github.com/DataDog/synthetics-ci-github-action)
