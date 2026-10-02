# Documentation

Start here, then read what you need.

| Document | Read it when |
| --- | --- |
| [../README.md](../README.md) | You want to install and run the app. Start here. |
| [getting-started.md](getting-started.md) | You are setting up from scratch, including dev setup. |
| [using-the-app.md](using-the-app.md) | You want to know what each control and colour means. |
| [cli.md](cli.md) | You script quota checks or manage accounts headlessly. |
| [building.md](building.md) | You want to produce an AppImage or understand the packaging. |
| [architecture.md](architecture.md) | You are changing the code. |
| [security.md](security.md) | You want to know what touches disk and what is encrypted. |
| [troubleshooting.md](troubleshooting.md) | Something is broken or showing unexpected data. |
| [api-findings.md](api-findings.md) | You need to know why quota data looks the way it does. |

## Two things worth knowing up front

**There is no public Antigravity quota API.** This app talks to an internal
Google endpoint (`cloudcode-pa.googleapis.com`) that can change or vanish without
notice. Nothing here is guaranteed to keep working. See
[troubleshooting.md](troubleshooting.md) when a release stops reporting quota.

**Quota is metered per pool, not per model, and many accounts report no
percentage at all.** Google provisions meters per account, and some accounts
only get a reset time with no `remainingFraction`. Those are shown as
*unmetered*, not as 0%. The reasoning and evidence is in
[api-findings.md](api-findings.md).