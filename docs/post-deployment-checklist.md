# Post-deployment checklist

Run through this checklist after every major deployment or configuration change.

## Services

- [ ] All containers running: `docker compose -f infra/docker-compose.yml ps`
- [ ] Postgres healthy: `docker inspect --format='{{.State.Health.Status}}' aeronet-postgres`
- [ ] Preflight passes: `bash tests/smoke/preflight.sh`

## UI

- [ ] Login page loads at https://aeronet.local
- [ ] Can log in as superadmin
- [ ] Dashboard page loads without errors
- [ ] Devices page loads (empty state acceptable on first deploy)
- [ ] Topology page loads
- [ ] Alerts page loads
- [ ] Logout works and redirects to /login

## Grafana

- [ ] https://grafana.aeronet.local is reachable via browser
- [ ] Device Inventory dashboard loads
- [ ] Alert History dashboard loads
- [ ] Network Topology dashboard loads
- [ ] Both datasources show green health indicator

## Alerts

- [ ] Send a test Telegram message:

```bash
curl -X POST http://localhost:8001/alert \
  -H "Content-Type: application/json" \
  -d '{"serial":"test","severity":"INFO","message":"Post-deploy test"}'
```

Confirm message arrives in Telegram.

- [ ] Confirm SMS NOT sent for INFO severity (check notifier logs)

## Security

- [ ] http://aeronet.local redirects to https://
- [ ] `curl -I https://api.aeronet.local/health` shows Strict-Transport-Security header
- [ ] Unauthenticated request returns 401:

```bash
curl https://api.aeronet.local/devices   # must return 401
```

## Scheduled jobs

- [ ] Enroller scheduler started (check logs):

```bash
docker logs aeronet-enroller | grep "Scheduled scanner started"
```

- [ ] Collector poll loop running:

```bash
docker logs aeronet-collector | grep "MistWorker"
```

## Backups (manual until automated)

- [ ] Take a manual postgres dump before first scan:

```bash
docker exec aeronet-postgres pg_dump -U aeronet aeronet \
  > backups/aeronet-$(date +%Y%m%d).sql
```
