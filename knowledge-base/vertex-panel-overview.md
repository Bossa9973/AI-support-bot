# Vertex Panel: Dashboard & Server Management Guide

## 1. Overview of the Dashboard
Vertex Panel is a modern, high-performance VPS & server hosting management portal built with Laravel and React. It gives users complete control over their cloud servers, virtual machines, resource utilization, and web terminals.

---

## 2. Navigating the Client Dashboard

### 🖥️ Servers Overview (`/servers`)
- **Server List**: Displays all active, pending, and stopped VPS instances assigned to your account.
- **Status Indicators**:
  - 🟢 **Running / Active**: The VM is powered on and healthy.
  - 🟡 **Provisioning / Installing**: Cloud-init or automated OS installation is in progress (usually completes in 1–3 minutes).
  - 🔴 **Stopped / Offline**: VM is shut down.
  - ⚠️ **Error / Suspended**: Service term expired or hypervisor node unreachable.

---

## 3. Server Management Capabilities

### ⚡ Power Controls
Located at the top of each server's detail page:
- **Start**: Powers on the virtual machine hypervisor instance.
- **Stop**: Sends a graceful ACPI shutdown signal to the guest operating system.
- **Reboot / Restart**: Sends a graceful reboot signal.
- **Kill / Force Stop**: Immediately cuts virtual power to the VM (use only if the OS is unresponsive or hung).

---

### 💻 Web Terminal & Console Access
Vertex Panel offers two ways to access your server console directly in the browser:
1. **tmate Web SSH Terminal**:
   - Click **"Fetch tmate SSH Session"** or open the Web Terminal.
   - Provides an instant, interactive web terminal over private NATed networks without needing a public IP or local SSH client.
   - If the terminal does not launch immediately, click **"1-Click Repair"** to trigger automated guest-agent diagnostics.
2. **Native Hypervisor Console (noVNC / xterm.js)**:
   - Found under the **Console** tab.
   - Direct hardware-level video stream from the hypervisor. Works even if your server has no internet connection, broken network configs, or an offline guest agent.

---

### 📊 Real-Time Metrics & Resources
The dashboard monitors real-time resource telemetry:
- **CPU Utilization (%)**: Real-time vCPU core usage.
- **RAM Usage**: Current active memory vs total allocated capacity (MB/GB).
- **Disk Storage**: Disk partition space utilization.
- **Network Traffic**: Live inbound and outbound bandwidth transit.

---

### 🔑 Server Credentials & Network Details
- **Root Password**: Set during checkout or reset via the settings tab.
- **Assigned Hostname & IP**: Shows your public IPv4/IPv6 address or Cloudflare tunnel connection hostname.
- **OS Template**: Ubuntu, Debian, CentOS, AlmaLinux, or custom images.
- **Billing Expiration**: 30-day active countdown timer with one-click renewal.
