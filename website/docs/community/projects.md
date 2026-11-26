---
title: Community projects
description: Things people have built with RivianMate, and how to add yours.
---

# Community projects

RivianMate's data is yours, in plain PostgreSQL, so people wire it into all sorts of things. This
page collects them. Come say hi and show yours on the [RivianMate Discord](pathname:///discord).

:::tip Add yours

Built a dashboard, a widget, an e-ink display in the garage or a script that does something fun?
[Edit this page](https://github.com/blike/rivianmate/edit/main/website/docs/community/projects.md)
and open a pull request with a short entry: a name, a sentence on what it does, a link, and a
screenshot if you have one (taken in [demo mode](../contributing/development.md#demo-mode), or with
locations cropped out).

:::

## Dashboards

| Project                                          | What it does                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| [Grafana dashboards](../integrations/grafana.md) | Fifteen dashboards in the repository, for people who already run Grafana |

## Ideas waiting for someone

Nobody has built these yet, as far as we know. Take one on and add it here:

- **An e-ink garage display** showing battery, range and tomorrow's weather, from a direct database
  query.
- **A monthly summary** emailed through Apprise: distance, energy, cost and efficiency, from a
  scheduled SQL query.
- **A charging-cost export** for reimbursement, as a CSV of sessions at a saved location.
- **A road-trip postcard**: a trip's day-by-day map rendered to an image you can share.

## Guidelines for entries

- Read-only, like RivianMate: nothing that sends commands to the vehicle.
- No tokens, VINs, addresses or precise locations in screenshots or example code.
- Link to your own repository or write-up; this page doesn't host code.
