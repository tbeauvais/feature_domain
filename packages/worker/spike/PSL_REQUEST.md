# Draft: Public Suffix List request for apprun.app

Not to submit yet. The list declines small or early projects ("projects not serving more then thousands of users are
quite likely to be declined"; CONTRIBUTING: "Smaller, private projects with <2000 stakeholders"), and only an
authorized representative of the domain may submit. Submit once published apps serve thousands of people.
Isolation never depends on it (host-only `__Host-` cookies, per-app auth tables and secrets).

Sources: [Guidelines](https://github.com/publicsuffix/list/wiki/Guidelines),
[CONTRIBUTING](https://github.com/publicsuffix/list/blob/main/CONTRIBUTING.md),
[PR template](https://github.com/publicsuffix/list/blob/main/.github/pull_request_template.md) (read 2026-10-31).

## Before submitting

- [ ] Registration: renew apprun.app so it has **more than 2 years** left (Cloudflare Registrar), and keep more than a
      year left from then on.
- [ ] A role-based address on apprun.app, e.g. `psl@apprun.app` (Cloudflare Email Routing to the owner), answered
      within 30 days.
- [ ] An organization page at `https://apprun.app/` (the apex serves nothing yet): what apprun.app is, and an abuse
      contact (e.g. `https://apprun.app/abuse`, or `abuse@apprun.app`).
- [ ] Fork github.com/publicsuffix/list, add the entry below, run `make test`, open the PR.
- [ ] Add the TXT record `_psl.apprun.app` = `https://github.com/publicsuffix/list/pull/<number>` (Terraform, beside
      the wildcard record), and **leave it in place** after merge.

## The entry

In `public_suffix_list.dat`, inside `===BEGIN PRIVATE DOMAINS===` … `===END PRIVATE DOMAINS===`, placed alphabetically
by organization name (not at the end of the file):

```
// apprun.app : https://apprun.app/
// Submitted by Thomas Beauvais <psl@apprun.app>
apprun.app
```

## The pull request description

**Organization Website:** https://apprun.app/

**Description of Organization:** apprun.app hosts web apps that people build with Feature Domain, a builder that
generates an app from a model of features (pages, forms, tables, data). Each published app is served at its own
subdomain, `<name>.apprun.app`, chosen by the person who published it. The apps' content, data and accounts belong to
their publishers and their users, not to apprun.app.

**Robust Reason for PSL Inclusion:** Every subdomain of apprun.app is a separate app with a separate owner and
separate users. Each app has its own sign-in: its visitors' accounts and sessions are kept per app, and session cookies
are host-only (`__Host-` prefix). Browsers today treat all `*.apprun.app` subdomains as one site: one app is
"same-site" with every other, so SameSite cookie protections don't separate them, and a subdomain could set cookies
scoped to `apprun.app` that other apps receive. Listing `apprun.app` makes each app its own site, as for other
platforms that host many people's content on subdomains (e.g. `github.io`, `workers.dev`, `pages.dev`). It also keeps
browser features keyed by site (storage partitioning, permission prompts, history and cache partitioning) from mixing
different owners' apps.

**Number of THOUSANDS of distinct users this request is being made to serve:** <fill in when submitting>

**DNS verification via dig:**

```
dig +short TXT _psl.apprun.app
"https://github.com/publicsuffix/list/pull/<number>"
```

**Checklist:**

- [ ] Each domain listed in the PRIVATE section has and shall maintain at least two years remaining on registration,
      and we shall keep the `_psl` TXT record in place in the respective zone(s).
- [ ] The Guidelines were carefully _read_ and _understood_, and this request conforms to them.
- [ ] The submission follows the Guidelines on formatting and sorting.
- [ ] A role-based email address has been used and this inbox is actively monitored with a response time of no more
      than 30 days.
- [ ] Abuse contact: <https://apprun.app/abuse or abuse@apprun.app>
- [ ] This request was _not_ submitted with the objective of working around other third-party limits.
- [ ] Changes take time to reach browsers and other consumers of the list: _Yes, I understand_.
