# Technical Troubleshooting Guide

### Common Error Codes & Solutions

#### Error 401: Unauthorized / Invalid Credentials
- Ensure your API key or login credentials are typed without accidental whitespace.
- Verify that your token has not expired or been regenerated in the settings dashboard.

#### Error 429: Rate Limit Exceeded
- You have made too many requests in a short time frame.
- Wait 60 seconds before sending another request, or implement exponential backoff in your code.

#### Connection Timeout / Network Errors
1. Check your internet connection and DNS settings.
2. Verify if firewall rules or VPN connections are blocking traffic on port 443.
3. Check our status page to see if all services are operational.

### Steps to Reset Account Password
1. Visit the login page.
2. Click **Forgot Password**.
3. Enter your account email address and click **Send Reset Link**.
4. Check your spam folder if you do not receive the email within 5 minutes.
