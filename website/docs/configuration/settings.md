---
title: Settings
description: What you can change from RivianMate's Settings page.
---

# Settings

Most preferences live in the web interface under **Settings**, and are saved in the database, so
they survive updates and restores.

| Section           | What's there                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| **General**       | Units (metric or imperial, °C or °F) and currency, outside services (addresses and weather), Rivian account, vehicles |
| **Locations**     | Saved places such as home and work, with an electricity rate for each, used for charging costs and drive labels       |
| **Notifications** | Destinations (Discord, Apprise) and which alerts to send. See [Notifications](./notifications.md)                     |
| **Import Data**   | Bring in history from other apps. See [Importing data](../import/overview.md)                                         |
| **API & Feeds**   | How RivianMate is talking to Rivian: the live stream, fallback polling and request history                            |
| **Security**      | Change the RivianMate password                                                                                        |
| **Logs**          | Recent server logs, with a download for bug reports                                                                   |
| **About**         | Version, commit and links                                                                                             |

## Saved locations and charging cost

Charging cost comes from the rate of the saved location a session happened at. Add your home (and
any other place you charge regularly) under **Settings → Locations**, with its rate per kWh. Charges
away from saved places use what Rivian reports, where it reports a cost.

## Outside services

Address and weather lookups are optional and can be changed at any time under **Settings → General →
Outside services**. Turning one back on fills in drives made while it was off. See
[Privacy & security](../privacy-security.md) for exactly what each one sends.
