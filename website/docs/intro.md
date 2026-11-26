---
title: Introduction
slug: /intro
sidebar_label: Introduction
description: What RivianMate is, what it records, and how it fits together.
---

# Introduction

RivianMate is a self-hosted data logger and dashboard for Rivian vehicles. It records drives,
charging sessions, battery health and live vehicle state into a PostgreSQL database you run, and
shows them on a web dashboard you can open from any browser.

![The RivianMate dashboard on a desktop](/img/dashboard-desktop.png)

## Why RivianMate

- **Self-hosted and private.** It runs on your own hardware with Docker Compose. Your vehicle data
  stays in your database, and RivianMate has no cloud service or telemetry of its own.
- **Read-only.** RivianMate watches the vehicle and never sends it commands. Requests are spaced out
  so it doesn't interfere with the official Rivian app.
- **R1 and R2.** R1T, R1S and R2 are supported, and several vehicles on one account.

## How it fits together

| Piece                  | What it does                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `rivianmate` container | Signs in to Rivian, listens for vehicle updates, serves the dashboard on port 4000 |
| `postgres` container   | Stores everything: drives, charges, state history, settings                        |
| Your browser           | Shows the dashboard, with live updates pushed from the server                      |

Optional extras read from the same database or sit beside it:
[Grafana dashboards](./integrations/grafana.md).

## Where to start

1. [Install with Docker Compose](./installation/docker.md).
2. Put it behind [HTTPS or a private network](./installation/reverse-proxy.md) if you'll open it
   away from home.
3. [Import your history](./import/overview.md) from Rivian Roamer or ElectraFi.
4. Set up [notifications](./configuration/notifications.md).

Questions, or want to show off your setup? Join the [RivianMate Discord](pathname:///discord).

:::note

RivianMate is an independent open-source project. It is not affiliated with, endorsed by or
supported by Rivian Automotive.

:::
