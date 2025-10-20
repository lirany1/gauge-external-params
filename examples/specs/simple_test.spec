# Simple Authentication Test

## Basic Login
* Login with user <admin_user:env#ADMIN_USER|admin@example.com> and password <admin_pass:env#ADMIN_PASS|defaultpass>
* Verify login is successful

## API Configuration  
* Use API endpoint <api_url:env#API_URL|https://api.example.com>
* Get database host from <db_host:file#secrets.json#database.host>
* Connect with credentials

## File-based Configuration
* Load product price <price:file#secrets.json#product.price>
* Use API token <token:file#secrets.json#api_token>