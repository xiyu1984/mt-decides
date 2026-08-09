# Generic run prompt

`general.md` is the trusted policy for the generic business workflow runner.
`sites/<hostname>.md` optionally adds trusted site-specific policy selected by
the exact site slug; `sites/default.md` is the fallback.

Site-specific UI observations are injected separately from
`assistant/run/<site>.json` and remain untrusted hints.
