# User Authentication Tests

## Admin Login
* Login with user <admin_user:env#ADMIN_USER|admin@example.com> and password <admin_pass:env#ADMIN_PASS|defaultpass>
* Verify login is successful
* Navigate to admin dashboard

## API Authentication
* Get API token from <api_token:file#secrets.json#api_token>
* Make authenticated request to <api_url:env#API_URL|https://api.example.com>/users
* Verify response status is 200

## Database Connection
* Connect to database with host <db_host:file#config.yaml#database.host> and password <db_pass:vault#secret/myapp:db_password>
* Verify connection is established
* Run health check query

## External Service Integration
* Call external service at <service_url:http#https://config-service.example.com/endpoints#user_service>
* Use service credentials <service_user:aws#prod/external-services:username> and <service_pass:aws#prod/external-services:password>
* Verify service responds correctly

## Kubernetes Configuration
* Get application config from <app_config:k8s#configmap:app-config:application.properties>
* Use database secret from <db_secret:k8s#secret:db-credentials:password>
* Verify application starts with correct configuration