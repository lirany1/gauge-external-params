# E-commerce Platform Tests

## Product Management
* Login as admin with credentials <admin_creds:vault#secret/ecommerce:admin_credentials>
* Navigate to product management
* Create new product with name <product_name:env#TEST_PRODUCT_NAME|Test Product>
* Set product price to <product_price:file#test-data.json#product.price|99.99>

## Payment Processing
* Use test payment gateway with key <payment_key:aws#prod/payment-gateway:api_key>
* Process payment for amount <payment_amount:http#https://pricing-api.example.com/calculate#total_amount>
* Verify payment confirmation

## Inventory Management
* Check inventory levels from <inventory_api:k8s#configmap:inventory-config:api_endpoint>
* Update stock with credentials <inventory_creds:k8s#secret:inventory-service:api_credentials>
* Verify stock levels are updated

## Email Notifications
* Configure SMTP with settings from <smtp_config:file#email-config.yaml>
* Send notification email to <test_email:env#TEST_EMAIL|test@example.com>
* Verify email is sent successfully

## Multi-tenant Configuration
* Switch to tenant <tenant_id:http#POST:https://tenant-api.example.com/current:{"user":"admin"}#tenant_id>
* Load tenant-specific config from <tenant_config:vault#secret/tenants/${tenant_id}:config>
* Verify tenant isolation