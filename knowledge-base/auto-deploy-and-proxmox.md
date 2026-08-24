# Auto-Deployment & Zero-IPv4 Pterodactyl Provisioning

## 1. Zero-IPv4 Auto-Deploy Engine Overview
Vertex Panel features an automated provisioning pipeline designed to deploy full-stack game server environments (Pterodactyl Panel + Wings Daemon + Database + Nginx) on private VPS instances without requiring costly public IPv4 addresses.

---

## 2. How the Provisioning Workflow Works

1. **Order Ingestion**: User selects a game template and server plan, then submits the order.
2. **Cloud-Init Orchestration**:
   - The hypervisor creates a virtual machine and attaches an unattended cloud-init manifest.
   - Installs MariaDB database, Redis, PHP-FPM, Nginx, and Pterodactyl Panel.
   - Configures systemd services and permissions.
3. **Cloudflare Zero Trust Tunnel**:
   - Securely tunnels web traffic from the private VM out to your custom domain without exposing public ports.
4. **Automated Completion & Handshake**:
   - Once cloud-init finishes, an install-complete webhook sends credentials to the database and dispatches a welcome email.
   - The dashboard updates from **"Provisioning"** to **"Active / Ready"**.

---

## 3. Server Provisioning Troubleshooting

### ⏱️ Provisioning Time
- Standard automated deployments take between **2 to 5 minutes** depending on disk speed and package updates.
- If status stays on "Provisioning" for over 10 minutes:
  1. Check the **Console** tab to view cloud-init output logs (`/var/log/cloud-init-output.log`).
  2. Verify that hypervisor nodes have sufficient CPU/RAM allocation.
  3. Reach out to support staff in your ticket for manual inspection.
