# Category: VPS & Billing
# Title: How to SSH Into Your VPS (External / CMD Access)
# Last Updated: 2026-08-26T22:37:12.976Z

## Getting SSH Access to Your VPS

By default, Vertex Nodes provides browser-based terminal access via **noVNC** or **xterm.js**. These ARE terminals connected to your VPS — but if you want to connect from your own PC using a terminal or PuTTY, here's how:

### Step 1: Get Your VPS IP Address
Log into your dashboard at https://dash.vertexnodes.top and open your VM. The IP address is shown in the network/overview section.

### Step 2: Connect from Your PC
Open CMD, PowerShell, or any terminal and run:
```
ssh root@YOUR_VPS_IP
```

### Step 3: If SSH Connection is Refused
The SSH service might not be running. Use the browser terminal (noVNC/xterm.js) to fix it:
```bash
apt install openssh-server -y
systemctl enable --now ssh
ufw allow 22
```

### What about tmate / SSH share links?
**tmate is NOT provided by Vertex Nodes.** It is a third-party tool you can install yourself inside your VM:
```bash
apt install tmate -y
tmate
```
This will generate a shareable SSH link. But for normal SSH access from your own PC, you don't need tmate — just use your VPS IP directly.

### Common Issues
- **Permission denied**: Check your password or use SSH key auth
- **Connection timed out**: Make sure port 22 is open (`ufw allow 22`)
- **No route to host**: Your VPS might be powered off — check the dashboard
