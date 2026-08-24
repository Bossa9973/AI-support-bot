# Web Terminal, tmate SSH & Console Troubleshooting

## 1. Web Terminal Architecture
Vertex Panel provides browser-based SSH access to private and NATed VPS instances using **tmate**. This enables instant terminal sessions without needing public IPv4 addresses, open router ports, or external VPN clients.

---

## 2. Accessing the Web Terminal

1. Go to your server in the **Dashboard**.
2. Click **"Fetch tmate SSH Session"** or open the **Terminal** tab.
3. The panel coordinates with the guest agent to launch a secure, encrypted tmate session and opens the interactive terminal window.

---

## 3. Common Web Terminal Issues & Fixes

### ⚠️ Issue: Terminal hangs on "Waiting for session..." or times out
- **Cause 1: Guest Agent Initializing**: If the VM just booted up, `qemu-ga` (QEMU Guest Agent) takes approximately 30–60 seconds to start.
- **Cause 2: DNS Resolution over Proxy (Redsocks)**: If your VM is routed through a transparent proxy, DNS queries over UDP port 53 may be blocked.
- **How to Fix**:
  1. Click the **"1-Click Repair"** button in the dashboard terminal toolbar. This automatically configures serial sockets, verifies agent connectivity, and injects required host mappings.
  2. If the 1-Click Repair completes and the session is still unresponsive, use the **Native Hypervisor Console (noVNC)**.

---

### 🖥️ Native Hypervisor Console (noVNC Fallback)
If the guest OS has network issues or the tmate service cannot connect:
1. Navigate to **Server Overview → Console** tab.
2. The noVNC console connects directly to the hypervisor's virtual video buffer.
3. It works with **zero network dependencies** and allows you to log in as `root` to diagnose or repair your VM manually.

---

## 4. Useful Diagnostic Commands Inside the VM
If you are logged into the VM and need to test connectivity:
```bash
# Check if QEMU Guest Agent is running
ps aux | grep qemu-ga

# Test outbound network and DNS resolution
curl -sI --connect-timeout 4 https://tmate.io

# Inspect tmate connection logs
cat /tmp/tmate.log
cat /tmp/tmate_err.log
```
