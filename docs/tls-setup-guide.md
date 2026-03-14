# TLS certificate setup

AeroNet OS uses Nginx as the TLS-terminating reverse proxy.
Certificates live in `infra/nginx/certs/`.

## Option A — Self-signed (staging / local testing)

Run the included generator:

```bash
bash infra/nginx/generate-certs.sh
```

This produces:

- `infra/nginx/certs/aeronet.crt`
- `infra/nginx/certs/aeronet.key`

Add to your local `/etc/hosts` (on the machine accessing the UI):

```
<server-ip>  aeronet.local api.aeronet.local grafana.aeronet.local
```

Your browser will warn about the self-signed cert. Accept the exception.

## Option B — Let's Encrypt (production)

Prerequisites:

- Domain names pointing to your server (A records)
- Port 80 open to the internet (for ACME challenge)
- certbot installed: `sudo apt install certbot`

Steps:

1. Stop Nginx temporarily:

```bash
docker compose -f infra/docker-compose.yml stop nginx
```

2. Obtain certificates:

```bash
sudo certbot certonly --standalone \
  -d aeronet.yourdomain.com \
  -d api.aeronet.yourdomain.com \
  -d grafana.aeronet.yourdomain.com
```

3. Copy to the certs directory:

```bash
sudo cp /etc/letsencrypt/live/aeronet.yourdomain.com/fullchain.pem \
        infra/nginx/certs/aeronet.crt
sudo cp /etc/letsencrypt/live/aeronet.yourdomain.com/privkey.pem \
        infra/nginx/certs/aeronet.key
sudo chown $USER:$USER infra/nginx/certs/*
```

4. Update `infra/nginx/nginx.conf` — replace all occurrences of:

| From | To |
|---|---|
| `aeronet.local` | `aeronet.yourdomain.com` |
| `api.aeronet.local` | `api.aeronet.yourdomain.com` |
| `grafana.aeronet.local` | `grafana.aeronet.yourdomain.com` |

5. Restart:

```bash
docker compose -f infra/docker-compose.yml start nginx
```

## Auto-renewal (Let's Encrypt)

Add to the server's crontab (`sudo crontab -e`):

```cron
0 3 * * * certbot renew --quiet && \
  cp /etc/letsencrypt/live/aeronet.yourdomain.com/fullchain.pem \
     /opt/aeronet-os/infra/nginx/certs/aeronet.crt && \
  cp /etc/letsencrypt/live/aeronet.yourdomain.com/privkey.pem \
     /opt/aeronet-os/infra/nginx/certs/aeronet.key && \
  docker compose -f /opt/aeronet-os/infra/docker-compose.yml \
     exec nginx nginx -s reload
```
