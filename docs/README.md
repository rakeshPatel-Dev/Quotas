# Documentation

Start here, then read what you need.

| Document | Read it when |
| --- | --- |
| [../README.md](../README.md) | You want to install and run the app. Start here. |
| [getting-started.md](getting-started.md) | You are setting up from scratch, including dev setup. |
| [using-the-app.md](using-the-app.md) | You want to add, remove, pause or fix an account. Start here. |
| [troubleshooting.md](troubleshooting.md) | Something is broken or showing unexpected data. |
| [cli.md](cli.md) | You are a contributor scripting quota checks. Not used by the app. |
| [building.md](building.md) | You want to produce a release or understand the packaging. |
| [architecture.md](architecture.md) | You are changing the code. |
| [security.md](security.md) | You want to know what touches disk and what is encrypted. |
| [api-findings.md](api-findings.md) | You need to know why quota data looks the way it does. |

## Everyday use needs two documents

1. **[getting-started.md](getting-started.md)** to install the app on your
   platform and sign in for the first time.
2. **[using-the-app.md](using-the-app.md)** for everything after that — adding
   and removing accounts, pausing, fixing an expired sign-in, reading the bars,
   and where your data lives.

Everything is done from the single app window. There is no configuration file to
edit and no command to memorise.

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