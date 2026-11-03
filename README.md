# Tergar Events Collector

Collects every upcoming event from the Tergar events calendar and three
Vajrayana Online pages, and writes an Excel workbook and a CSV. Each run also
reports what changed since the previous run.

## What it reads

| Source | How it is read |
|---|---|
| https://events.tergar.org/ | Event cards read directly from the page (all events are in the page; "Load More" only reveals them). The calendar's own data endpoint is fetched as a cross-check. |
| https://vajrayana.tergar.org/path-of-liberation-how-to-begin | Free-form page. Claude lists the events; the script then checks every title, date and name against the page text and works out dates itself. |
| https://vajrayana.tergar.org/ | Same as above. |
| https://vajrayana.tergar.org/dorje-drolo-dzogchen | Same as above. |

Links from each listing are followed for descriptions, prerequisites, times
and registration status: Tergar detail pages, Eventbrite, local Tergar sites
and others, when the site's robots.txt allows it. The script never logs in.

## One-time setup

1. Python 3.9 is already installed. Install the libraries (one line, in a
   Command Prompt or PowerShell window):

   ```
   py -3.9 -m pip install requests beautifulsoup4 lxml openpyxl python-dateutil anthropic
   ```

2. Get an Anthropic API key from https://platform.claude.com (Settings, then
   API Keys) and save it on this PC. In a PowerShell window:

   ```
   setx ANTHROPIC_API_KEY "sk-ant-...your key..."
   ```

   Close and reopen the window afterwards. The script reads the key from this
   setting; it is never printed or saved in any file.

## Running it

From this folder (`C:\Users\georg\Documents\Projects\tergar-site`):

```
py -3.9 tergar_events.py
```

A full run takes several minutes (it pauses 2 to 3 seconds between page loads).

Options:

- `--sources calendar` run one or more sources only (comma-separated:
  `calendar, pol, vajrayana, dorje`)
- `--no-summaries` skip the Claude summaries

Without an API key the calendar still works (Summary is left blank), but the
three Vajrayana pages are skipped, because they are read with Claude.

## What it writes

| File | Contents |
|---|---|
| `docs\Tergar_Events_Library_YYYY-MM-DD.xlsx` | Tabs: **Events** (sorted by start date), **Recurring Sessions**, **Changes** (new / changed / removed versus the last run, with the field that changed), **Notes** (run details, counts, rows needing review, excluded events, errors, comparison with the first-cut workbook) |
| `docs\Events_YYYY-MM-DD.csv` | Same columns as the Events tab, UTF-8 (with a byte-order mark, so Excel shows Chinese and accented text correctly) |
| `data\last_run.json` | Snapshot used to find changes on the next run |

`docs\Tergar_Events_Library_firstcut.xlsx` is read for comparison only and is
never changed. Running twice on the same day replaces that day's files.

## Rules the script follows

- **Past events are excluded**: anything whose last date is before today.
  Events already under way are kept and noted.
- **Closed events are excluded**: anything whose listing or registration page
  says registration is closed or ticket sales have ended. Each one is listed on
  the Notes tab with the reason.
- **Missing values** are written as "Not listed". Nothing is guessed.
- **Years**:
  - When the site gives one year for a December–January range, the end date is
    moved to the next year and flagged.
  - When a page gives no year, the year is taken from the page's own heading if
    it has one. Otherwise the current year is assumed (or the next year, if the
    current one would put the date more than six months in the past). The row is
    flagged.
- **Dates with no day** (e.g. "SEP 2026–JUL 2027") are kept as month text and
  flagged.
- **Restricted** is "Yes" when the page says restricted or prerequisites apply.
  A restricted event is never shown as "Open to everyone".
- **Same event on two pages**: the listings are merged into one row, and the row
  notes the other listing.
- **Needs review** (flagged, never dropped):
  - end date before start date, or missing dates
  - the same title and date appearing twice
  - a year that differs from neighbouring events
  - a link that opens a different event
  - dates that disagree between pages
  - a summary that mentions a teacher or date not found in the extracted fields

## Group pages (milestone 1)

The group pages for tergargroups.org are built from data files:

| File | What it holds |
|---|---|
| `data\shared-events.yaml` | Shared Tergar events, made from the collector's results |
| `data\shared\series.yaml` | Shared meeting series (Nectar of the Path, study groups) |
| `data\shared\library.yaml` | Quotes, From Tergar items and resource links that groups choose from |
| `data\groups\us-venice-fl.yaml`, `us-stuart-fl.yaml` | Each group's page: schedule, next meeting, chosen events, featured events, notes |

Steps, from this folder:

```
py -3.9 tergar_events.py                      (1. collect events)
py -3.9 tools\export_shared_events.py         (2. update the shared events file)
npm install                                   (once: installs the page builder's one library)
npm run preview                               (3. preview build -> site-preview\)
npm run build                                 (4. publish build -> site\)
```

The page builder is JavaScript (`lib\render.js`, `scripts\build.mjs`, needs
Node.js). The same renderer is used by the dashboard, so its previews match
what publishes. The events collector and the export step stay in Python.

Open `site-preview\us\venice-fl\index.html` in a browser to see a page.

- **Preview** shows everything, with badges on items that still need review. Never deploy `site-preview`.
- **Publish** leaves out:
  - events flagged Needs review, until you set `review_cleared: true`
  - summaries, until you set `summary_approved: true`
  - contact addresses, until the group's `consent: true`

  Set those flags in the dashboard (Shared Library, and each group's header block), or by hand in `data\shared-events.yaml` and the group file.
- **Pills** under each event or meeting replace requirement text: "Has prerequisites" (shared events: the collector's `restricted: yes`; local items: `has_prerequisites: true`), "JOL"/"VOL" (`subscription:`, set by hand), and a language pill when the event's language differs from the group's (`language:` in the group file, else `default_language` in `data\shared\library.yaml`).
- **Event link**: one link per event (title, pills, register link). It is `event_url` if set (Shared Library), else the registration page, else the Tergar detail page; never the whole Tergar calendar or a prerequisites PDF.
- Each build writes a report to `data\build-report-preview.txt` or `data\build-report-publish.txt`.

## Dashboard (milestone 2): admin.tergargroups.org

Editors sign in through Cloudflare Access (an emailed one-time code). Each
signs in to their own group; the coordinator sees every group.

1. **Groups:** open a group and click **Edit** on any block. Saving creates a
   *pending change*; the live page is unchanged.
2. **Approvals:** each pending change shows what changes and a preview of the
   page as it will publish. **Approve and publish** commits the change to this
   repository (the change record); **Reject** discards it. Saving a block again
   replaces its earlier pending change.
3. **Shared Library** (coordinator): clear flagged events, approve summaries,
   and edit the quotes, From Tergar items and resource links.

After an approval, the GitHub Action (`.github/workflows/deploy.yml`) builds
the publish version and deploys it to Cloudflare Pages; it also runs daily.

Private items stay out of this public repository: pending changes (Workers
KV), the editor list (`USERS` secret), contact addresses (`CONTACTS` secret,
and the `CONTACTS_YAML` GitHub secret for the build). Commit messages name
roles ("the group editor"), not email addresses.

Code: `dashboard\src\` (Worker), sharing `lib\render.js` with the site build.
Local run: `cd dashboard` then `npx wrangler dev` (port 8790; settings in
`dashboard\.dev.vars`). Deploy: `npx wrangler deploy`.

To add an editor, add their address to the `USERS` secret, e.g.
`{"george@...": {"role": "coordinator"}, "editor@...": {"groups": ["us/venice-fl"]}}`,
and add the address to the Cloudflare Access policy.

## Summaries

Written by Claude Sonnet 5.5 (`claude-sonnet-5-5`): 2 to 3 sentences, using only
the extracted fields and page text. If a call fails, Summary is left blank and
the run continues.
