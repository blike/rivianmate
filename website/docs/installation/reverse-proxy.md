---
title: Remote access
sidebar_label: Remote access & HTTPS
description: Open RivianMate away from home with a reverse proxy or Tailscale.
---

# Remote access

RivianMate listens on plain HTTP on port 4000. That's fine on your home network, but anything that
leaves it should be encrypted. Pick one of the options below, and don't forward port 4000 on your
router.

:::info Live updates

The dashboard keeps a long-lived streaming connection open for live updates. The proxies below pass
it through as-is; if you use a different one, make sure it doesn't buffer responses or close idle
connections after a short timeout.

:::

## Tailscale (no open ports)

The simplest option: install [Tailscale](https://tailscale.com/) on the server and your devices,
then open `http://<server-tailscale-name>:4000`. Nothing is exposed to the internet. Add
[Tailscale Serve](https://tailscale.com/kb/1312/serve) for an HTTPS URL inside your tailnet:

```bash
tailscale serve --bg 4000
```

## Caddy

Caddy gets and renews certificates on its own.

```text title="Caddyfile"
rivianmate.example.com {
	reverse_proxy localhost:4000
}
```

If Caddy runs in Docker on the same network as RivianMate, use `reverse_proxy rivianmate:4000`.

## Traefik

Add labels to the `rivianmate` service, on the network Traefik watches:

```yaml title="docker-compose.override.yml"
services:
  rivianmate:
    labels:
      - traefik.enable=true
      - traefik.http.routers.rivianmate.rule=Host(`rivianmate.example.com`)
      - traefik.http.routers.rivianmate.entrypoints=websecure
      - traefik.http.routers.rivianmate.tls.certresolver=letsencrypt
      - traefik.http.services.rivianmate.loadbalancer.server.port=4000
```

## nginx

```nginx title="/etc/nginx/conf.d/rivianmate.conf"
server {
    listen 443 ssl;
    http2 on;
    server_name rivianmate.example.com;

    ssl_certificate     /etc/letsencrypt/live/rivianmate.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rivianmate.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Live updates stream; don't buffer them or cut them off.
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

## Only listen on localhost

When a proxy on the same host is the only way in, stop Docker publishing the port on every
interface:

```yaml title="docker-compose.override.yml"
services:
  rivianmate:
    ports: !override
      - '127.0.0.1:4000:4000'
```
