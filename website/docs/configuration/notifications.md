---
title: Notifications
description: Send RivianMate alerts to Discord, or through Apprise to almost anything.
---

# Notifications

RivianMate can tell you when something needs attention:

- a door or window left open
- the vehicle left unlocked
- charging complete
- low battery
- tire pressure
- a software update

Choose destinations and alerts under **Settings → Notifications**.

## Discord

1. In Discord, open the channel's settings, then **Integrations → Webhooks → New Webhook**.
2. Copy the webhook URL.
3. In RivianMate, add a Discord destination and paste it.

## Apprise

[Apprise API](https://github.com/caronc/apprise-api) is a small server that forwards a message to
[more than 100 services](https://github.com/caronc/apprise/wiki): Pushover, ntfy, Telegram, Slack,
email, Matrix, Gotify and so on. Run it beside RivianMate, with a volume so its configuration
survives restarts:

```yaml title="docker-compose.override.yml"
services:
  apprise:
    image: caronc/apprise:latest
    restart: always
    volumes:
      - apprise_config:/config

volumes:
  apprise_config:
```

Then:

1. Store your notification URLs, such as `ntfys://ntfy.sh/my-rivian` or `pover://user@token`, under
   a config key in Apprise, for example `rivianmate`. Apprise's own web page at
   `http://<apprise-host>:8000/cfg/rivianmate` does this.
2. In RivianMate, add an Apprise destination with the notify URL, including the key:
   `http://apprise:8000/notify/rivianmate`.

## Links in alerts

Set **RivianMate address** under **Settings → Notifications** to the URL you open RivianMate at,
such as `https://rivianmate.example.com`, so alerts can link straight to the drive or charge.
