---
title: Importing data
sidebar_label: Overview
description: Bring your drive and charging history across from another app.
---

# Importing data

Already logging your Rivian somewhere else? Bring the history with you. RivianMate imports:

| Source                              | Brings                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- |
| [Rivian Roamer](./rivian-roamer.md) | Drives, charging sessions with curves and energy breakdown, vehicle history |
| [ElectraFi](./electrafi.md)         | Drives, charging sessions, vehicle history                                  |

Your charging history from your Rivian account is also brought in on its own once you sign in.

## How an import works

1. Go to **Settings → Import Data** and choose **New import**.
2. Pick the source and add its export files.
3. Check the preview. It shows, for each item, whether it will be imported, adds detail to something
   already recorded, or is skipped (and why).
4. Import.

## What happens to existing data

- Anything already recorded stays as it is.
- An existing charge only gets what it's missing, such as a curve.
- Exports are matched to your vehicle; a Rivian Roamer copy by VIN.

## Undo

Every import can be undone from **Settings → Import Data**. **Undo** removes what that import added,
apart from drivers and saved places, which stay.

:::tip

Imports are large writes. [Take a backup](../installation/backup-restore.md) first if you'd like an
easy way back beyond **Undo**.

:::
