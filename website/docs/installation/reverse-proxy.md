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

## Trusting your reverse proxy

By default, RivianMate ignores `X-Forwarded-For` and `X-Forwarded-Proto` headers so clients reaching
port 4000 directly cannot spoof them. When running behind a reverse proxy, set `TRUST_PROXY` in
`.env` to the proxy's IP address or CIDR subnet (comma-separated for multiple):

- Login rate limiting tracks each visitor's real IP instead of the proxy's IP.
- The `rivianmate_session` cookie automatically sets the `Secure` flag over HTTPS while remaining
  usable over plain HTTP on localhost/LAN.

Connections that bypass the proxy are still judged by their real IP. Only `false`/unset or explicit
IPs/CIDRs are accepted—`true` and hop counts fail at startup.

### Proxy in a Docker container (Traefik, Caddy, nginx)

Trust the proxy container's static IP or the dedicated Docker network subnet shared by the proxy and
RivianMate (check with `docker network inspect <network>`):

```ini title=".env"
TRUST_PROXY=172.18.0.0/16
```

### Proxy on the Docker host (Caddy, nginx, Tailscale Serve)

A proxy running directly on the host reaches the container through the Docker bridge gateway IP
(check with `docker network inspect <network>` for the `Gateway` address):

```ini title=".env"
TRUST_PROXY=172.18.0.1
```

If RivianMate runs directly on the host without Docker, use `TRUST_PROXY=127.0.0.1,::1`.

### Proxy on another machine

Trust only that machine's single LAN IP address:

```ini title=".env"
TRUST_PROXY=192.168.1.10
```

:::warning Don't trust your whole LAN subnet

Never set `TRUST_PROXY` to a whole LAN range like `192.168.1.0/24`. Any device on that network could
then send a fake `X-Forwarded-For` header directly to port 4000 and bypass login rate limiting.

:::
