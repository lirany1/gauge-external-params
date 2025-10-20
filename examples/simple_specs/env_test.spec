# Environment Variables Test

## Basic Login Test
* Login with user <admin_user:env#ADMIN_USER|admin@example.com>
* Use password <admin_pass:env#ADMIN_PASS|defaultpass>
* Connect to API at <api_url:env#API_URL|https://api.example.com>
* Verify connection is successful

## Fallback Test  
* Use non-existent variable <missing:env#MISSING_VAR|fallback_value>
* Test with another fallback <test:env#TEST_VAR|default_test>