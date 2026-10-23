# מדריך פקח/ית טיסה — ATC newcomer guide

**Live site:** https://killerk-19.github.io/atc-guide/

Unofficial static web app for new air traffic controllers at the Israel Airports
Authority: entitlement stages, milestones, benefits by stage, yearly payments,
funds, shift/overtime rules, glossary, a newcomer checklist, a personal
"what to check on my payslip" list and an interactive payslip / attendance-report guide. Hebrew RTL,
phone-first, installable (PWA).

## Privacy

- Static files only. No server, no accounts, no analytics, no third-party
  requests (enforced by the CSP in `index.html`).
- Personal inputs (start date, grade…) stay in the visitor's browser
  (`localStorage`: `atcg.profile.v1`; checklist ticks `atcg.checklist.v1`;
  payslip ticks `atcg.slipcheck.v1`) and can be cleared from the page.
- Nothing personal about the author is in this repo. Keep it that way: the data
  file holds generic rules and tariffs only.

## Layout

| Path | What |
|---|---|
| `index.html` | Shell, tabs, CSP |
| `css/style.css` | Light/dark tokens, RTL, phone-first layout |
| `js/app.js` | Hash router + pages; `VERSION` constant |
| `data/guide.json` | **All content** — stages, benefits, tariffs, shifts, glossary, checklist |
| `data/paycheck.json` | Payslip + attendance-report (דוח פיצול) guide: zones, slip lines with stage rules, PZL columns/counters and their slip codes |
| `sw.js` | Offline cache (network first) |
| `manifest.webmanifest`, `icons/` | Install to home screen |

## Updating the content

Edit `data/guide.json` by hand (UTF-8, no BOM), bump `meta.data_updated`, and
bump `VERSION` in `js/app.js` plus `CACHE` in `sw.js` when app files change.
Facts still in dispute go under `disputed` and are shown with an "unconfirmed"
badge — never present one reading as settled.

## Run locally

`fetch` does not work from `file://`, so serve the folder:

```
python -m http.server 8000
```

then open http://localhost:8000.

## Deploy (GitHub Pages)

1. Create the GitHub account and an empty **public** repository (e.g. `atc-guide`),
   without a README or licence, so the first push is clean.
2. From this folder:
   ```
   git remote add origin https://github.com/<account>/atc-guide.git
   git push -u origin main
   ```
3. Repository → Settings → Pages → *Deploy from a branch* → `main` / `/ (root)` → Save.
4. After a minute the site is live at `https://<account>.github.io/atc-guide/`.
   Share that link; colleagues can "Add to home screen" from the phone browser.

Updates: edit, commit, push — Pages redeploys on its own. `.nojekyll` makes Pages
serve the files as they are.
