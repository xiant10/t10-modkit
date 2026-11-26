---
title: "Publication review, 2026-11-26"
audience: contributor
kind: record
status: record
summary: "The secret scan and content review of t10-modkit's full history before it's made public (merge-module-kits task 2.1): no secrets, no tenant data, no private hosts."
---

# Publication review, 2026-11-26

Before `xiant10/t10-modkit` is made public (the workspace's OpenSpec change `merge-module-kits`, task 2.1), its whole history was scanned and read, at `430e8cf`.

## Secret scan

`gitleaks v8.21.2 detect --log-opts=--all` over every commit on every branch: 29 commits with changes scanned (the rest are merges), no leaks found.

## Content review

Every line of `git log --all -p` (22,760 lines) was searched for what mustn't be public:

| Looked for | Found |
|---|---|
| IP addresses | Only `127.0.0.1`, in tests and docs. One match, `7.148.924.383`, is SVG path data in `frame.html` |
| Private hosts: the demo and edge machines, the LAN, the public edge's address | None |
| Email addresses | The commit author's `xian@tacten.ai` (on every commit), which the public repos `auth-server`, `workbench` and `t10-collab` already carry; `noreply@anthropic.com` in co-author lines |
| Customer, company and people's names | None. `felix` appears only in the dependency `github.com/felixge/httpsnoop` |
| Tenant IDs | Only test ones: `ten_acme`, `ten_a`, `ten_b`, `ten_other`, `ten_alone` |
| Phone numbers | Only `13800000000`, a test number, in `ontology`'s test module and fixture |
| Model or service keys, signing keys | None |
| Real packs or tenant configuration | None: `ontology/testdata/ledgermod` is a made-up module with made-up packs |

## Sign-off

Nothing found needs removing, so the history can be published as it is, with no rewrite. The repository stays private until its owner says to publish it (task 2.2).
