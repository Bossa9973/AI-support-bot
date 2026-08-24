# Troubleshooting & Error Resolution Guide

## 1. Dashboard & Panel Issues

### ❌ "500 Internal Server Error" or "CSRF Token Mismatch"
- **Cause**: Expired session cookie or cached frontend tokens.
- **Fix**:
  1. Clear browser cookies and cache for the panel domain, or open an Incognito/Private window.
  2. Refresh the page and log in again.

### 🔒 Password Reset / Lost Credentials
- On the panel login screen, click **"Forgot Password"**.
- Check your email inbox and spam folder for the password reset link.
- If you cannot access your email, open a support ticket and provide your username and linked server details for verification.

---

## 2. Server & VM Operational Issues

### 🔴 Server Stuck on "Stopped" or Cannot Power On
1. Click the **Start** button in the dashboard.
2. If it fails to start:
   - Check if your monthly billing cycle has expired.
   - Click the **Console** tab to check if the hypervisor returns any storage quota or node maintenance errors.
   - If the node is undergoing maintenance, staff will post an announcement in the server.

### 🌐 Server Cannot Connect to the Internet
1. Ensure your network settings or DNS inside `/etc/resolv.conf` are configured to `8.8.8.8` or `1.1.1.1`.
2. Check if a local firewall (`ufw` or `iptables`) is blocking outbound ports.
3. Test connectivity by running `ping 1.1.1.1` or `curl -I https://google.com`.

---

## 3. Reseller & Payment Issues

### ⏳ Payment Made but Server Not Provisioned
- **Crypto Confirmations**: Blockchain transactions require network confirmations (usually 1–3 confirmations depending on coin: USDT, SOL, BTC, LTC, ETH).
- **Payment Link Expired**: If you sent crypto after the invoice expiration window, contact support staff with your transaction hash (`tx_hash`) to claim credit.

### 💰 Reseller Withdrawal In "Pending" Status
- Reseller payouts are reviewed and approved by administrators within 24 hours.
- Once approved, the blockchain transaction hash (`tx_hash`) will be attached to your withdrawal history.
- If rejected, the locked balance is automatically refunded back into your Available Balance.

---

## 4. Admin CLI Quick Reference (For Server Administrators)
```bash
vertex status           # Check web server and background queue worker status
vertex backup           # Run full panel backup and upload to cloud storage
vertex restore <URL>    # Zero-config restore on a new VPS
vertex start|stop|restart # Manage all panel system services
vertex logs             # Live tail application error logs
vertex update           # Pull latest updates from repository
```
