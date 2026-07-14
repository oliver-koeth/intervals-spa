# Installation Guide

## Linux VPS (systemd Service)

Use this guide to run the `intervals-spa` backend as a persistent background service
behind an Nginx reverse proxy.

### 1. Install system dependencies

Debian/Ubuntu example:

```bash
sudo apt update
sudo apt install -y python3 python3-venv git nodejs npm
npm install -g pnpm
```

### 2. Create a dedicated service user and directories

```bash
sudo useradd --system --create-home --home /opt/intervals --shell /usr/sbin/nologin intervals || true
sudo mkdir -p /opt/intervals/app
sudo chown -R intervals:intervals /opt/intervals
```

### 3. Clone and install the application

```bash
sudo -u intervals git clone <YOUR_REPOSITORY_URL> /opt/intervals/app
cd /opt/intervals/app

# Backend
sudo -u intervals python3 -m venv /opt/intervals/venv
sudo -u intervals /opt/intervals/venv/bin/pip install --upgrade pip
sudo -u intervals /opt/intervals/venv/bin/pip install /opt/intervals/app

# Frontend (build static assets)
sudo -u intervals bash -c "cd /opt/intervals/app/frontend && pnpm install && pnpm build"
```

### 4. Configure runtime environment variables

Create `/etc/intervals.env`:

```bash
sudo tee /etc/intervals.env >/dev/null <<'EOF'
INTERVALS_DATA_DIR=/var/lib/intervals
INTERVALS_HOST=127.0.0.1
INTERVALS_PORT=8000
INTERVALS_LOG_LEVEL=info
EOF

sudo mkdir -p /var/lib/intervals
sudo chown -R intervals:intervals /var/lib/intervals
sudo chmod 640 /etc/intervals.env
```

### 5. Create the systemd unit

Create `/etc/systemd/system/intervals.service`:

```ini
[Unit]
Description=intervals-spa backend service
After=network.target

[Service]
Type=simple
User=intervals
Group=intervals
WorkingDirectory=/opt/intervals/app
EnvironmentFile=/etc/intervals.env
ExecStart=/opt/intervals/venv/bin/uvicorn intervals.api.main:app \
  --host ${INTERVALS_HOST} \
  --port ${INTERVALS_PORT} \
  --log-level ${INTERVALS_LOG_LEVEL}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 6. Enable and start the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now intervals
sudo systemctl status intervals
```

Follow logs:

```bash
sudo journalctl -u intervals -f
```

### 7. Verify health endpoint

```bash
curl http://127.0.0.1:8000/api/v1/health
```

### 8. Configure Nginx as reverse proxy with TLS

Install Nginx and Certbot:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/intervals`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name intervals.example.com;

    # Serve built frontend static assets
    root /opt/intervals/app/frontend/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to Python backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and reload:

```bash
sudo ln -sf /etc/nginx/sites-available/intervals /etc/nginx/sites-enabled/intervals
sudo nginx -t
sudo systemctl reload nginx
```

Issue TLS certificate:

```bash
sudo certbot --nginx -d intervals.example.com \
  --redirect --agree-tos -m admin@example.com --no-eff-email
```

Validate:

```bash
curl https://intervals.example.com/api/v1/health
```

### 9. Update an existing installation

```bash
sudo -u intervals git -C /opt/intervals/app pull --ff-only
sudo -u intervals /opt/intervals/venv/bin/pip install --upgrade /opt/intervals/app
sudo -u intervals bash -c "cd /opt/intervals/app/frontend && pnpm install && pnpm build"
sudo systemctl restart intervals
sudo systemctl status intervals --no-pager
curl http://127.0.0.1:8000/api/v1/health
```
