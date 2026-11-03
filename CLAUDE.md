PROJECT: Living Group Pages on tergargroups.org

SOURCE OF TRUTH
- Page design and behaviour: docs\living-group-pages-handoff.md (the handoff
  brief). Treat it as a spec, not code to copy.
- Design reference: docs\living-group-pages-v6.html, a working prototype with
  sample data. Use it to see layout, dialogs, approvals and the public page.
  Its code and data model are a reference, not something to copy or reuse
  as the production store.
- Where the handoff and the prototype disagree, flag the conflict to George
  rather than choosing.
- Where this file and the handoff disagree, this file wins for the points
  listed under "DECISIONS SINCE THE HANDOFF" below; otherwise follow the
  handoff. Ask if unclear.

SCOPE
The MVP / proof of concept is the public web site only, starting now with
milestone 1 (static pages for Venice and Stuart). Newsletters are reference
material only; newsletter output may come in a later phase (MVP+), not now.
Milestones and open decisions are in the handoff brief.

DECISIONS SINCE THE HANDOFF (these take precedence)
- Branding: no Tergar logo or branding for now. If that changes later,
  logos only as provided and approved by Tergar.
- Pills replace requirement text (decided 2026-11-03; replaces the earlier
  "show the FULL prerequisite text" rule). Event cards, program
  announcements and meeting series show no prerequisite or requirement
  text, only a compact row of pills, each shown only when it applies:
  "Has prerequisites" (amber tint; links to the event link), "JOL" / "VOL"
  (subscription; plain label), and a language pill. Flags come from
  curated data only, never inferred from text: shared events use the
  collector's Restricted = yes; subscription is set by hand in the
  Shared Library; local events and meetings use the editor's checkbox and
  subscription choice. Open events show nothing ("Open to everyone" is no
  longer shown). Unknown access (Restricted not yes/no) shows nothing.
  A restricted event is never shown as open.
- Languages: each group has a language (group file "language:", else
  default_language in data/shared/library.yaml). An event with no
  language listed is assumed to be in default_language. No pill when the
  event is in the group's language; one other language shows its name;
  several languages or interpretation show "Multiple languages" (links to
  the event link). Titles in other languages are shown as published; the
  site's own text stays English.
- Descriptions: never publish the collector's Description column (text
  copied from Tergar, Eventbrite and local center pages). Publish our
  summary plus the event link instead.
- Event link (replaces "Attribution link"): one link per event, used by the
  title, the pills and "More information and registration": a hand-set
  event_url, else the registration page, else the Tergar detail page,
  else the page it was found on. Never the whole Tergar calendar
  (events.tergar.org/) and never a prerequisites PDF. Per-event "from
  Tergar" attribution is removed.
- Look: top banner tools/static/mountains-giantmoon-dusk-banner.jpg; all
  section headers use the light lavender band. One body text size
  (14.5px). One "Featured" heading before the first featured block (no
  per-block "Featured" label or Edit button). The intro text has no
  background. "Times are shown in the group's local time, then UTC"
  appears once, in the footer.
- Dates: never abbreviate the day of the week or the month ("Monday,
  November 9", not "Mon, Nov 9"), on the site and in the dashboard.
- Links to other sites open in a new tab.
- Dashboard: group editors never see technical items (GitHub links, raw
  data). The change-record link is shown to the coordinator only.
- Review gate: George reviews summaries before they publish (approval flow,
  milestone 2). Until then, nothing is deployed without his review. Rows
  with Needs review = Yes are not published until someone has cleared them.
- Summaries: generated in the build step with the key from the
  ANTHROPIC_API_KEY environment variable; publish only the summary text.
- Page titles: "Tergar Venice" / "Tergar Stuart" style naming is fine
  (it is not logo branding). The footer disclaimer still applies.
- Featured placement (replaces the handoff's strict alternation): after the
  page renders, each featured block, in date order, goes into whichever
  column is shorter at that moment (measured, not estimated). Featured
  blocks move left or right as needed to balance; the filler covers only
  the small remaining gap. Applies to all groups.
- Phone order: featured items appear in date order on phones.
- Meeting schedule = the group's own meetings only. Other Tergar series
  (e.g. Nectar of the Path, other groups' study groups) go under Program
  announcements, "Recurring". Any series can also be featured (e.g. Nectar
  of the Path as a featured block), placed by date like events.
- Non-Tergar community events (Venice / Blue Lotus): allowed but expected
  to be rare. Listed separately under Program announcements as "Community
  events (non-Tergar)", clearly labelled, with no personal contacts.
  Open question for George whether groups should do this at all.
- Zoom access settings: "on request" (default) or "shown" (the Zoom link is
  published). No "logged-in members only" option; the site has no logins.
- Next meeting: Reading and Contemplation are optional fields.
- Local notes: featured event blocks show the full local note; program
  announcements show the short marker.
- Paths confirmed: tergargroups.org/us/venice-fl and /us/stuart-fl.
- Nice to have, not milestone 1: usage-history log, "last synced with
  Tergar listings" date.
- Pilot groups: Venice and Stuart only (the prototype's "Pilot group 3" is
  sample data).
- Dashboard (handoff open decision 2): HOSTED, so other test users can edit
  their own group pages. Approval still gates everything that publishes.
  Sign-in through Cloudflare Access (no login system of our own).
  Address: admin.tergargroups.org.
  Views: Group Dashboard (the page in edit mode; edits become pending
  changes) and Approvals (pending changes with previews; approve/reject),
  per group. Shared Library view for George only (coordinator). The public
  Group Page is the live site.
  Roles: one person per group, who is both editor and approver for that
  group in the pilot. George (coordinator) sees all groups, can approve for
  any group, and maintains the shared library and summary review.
  Approved changes are committed to GitHub (audit trail); a GitHub Action
  rebuilds and deploys the pages (also daily). Pending changes, the editor
  list and contact addresses are stored privately, never in the public repo.


============================================================================
SHARED EVENT COLLECTOR (feeds the shared events library)
============================================================================

GOAL
A Python script that reads the Tergar events calendar and three
"Interested in Buddhism" pages, extracts every upcoming event, and writes
review outputs (Excel workbook, CSV) plus a change report since the last
run.

Target (handoff, milestone 3): the collector lives in tools\ and writes
data\shared-events.yaml for the site build. Each event carries a source
URL, date, time, time zone, format, place, prerequisite text, and
attribution to Tergar. The workbook and CSV stay as review outputs.
Don't move or restructure the existing code until milestone 3.

Current state (built 2026-11-02): tergar_events.py in the project folder.
Known gaps against the target:
- Times and time zones are only kept as text in "Date (as listed)"; they
  need to become separate fields (the site shows "10:00 am ET / 15:00 UTC").
- Recurring sessions are free-text rows. The target is the handoff's
  meeting-series model: cadence (weekly, every other week, or certain weeks
  of the month), start time, time zone, format (in person, Zoom, or both),
  place, Zoom access setting (on request by default, login only, or shown),
  optional start and end dates.
- Output is xlsx/CSV/JSON, not data\shared-events.yaml.

WORKING FOLDER
C:\Users\georg\Documents\Projects\tergar-site
(Launch Claude Code from here.)
- Collector script and config: this folder (moves to tools\ at milestone 3)
- Review outputs (workbook, CSV): docs\
- Run snapshot (JSON, for change tracking): data\
- Site data (handoff): data\shared\, data\groups\
Create data\ if it doesn't exist.

ENVIRONMENT
- Windows, command line. Python 3.9.13 is installed. Do NOT install a new
  Python. Choose libraries that work with Python 3.9. If a library needs a
  newer Python, tell me and suggest an alternative.
- Choose the fetching method that works best on this PC. Options include a
  browser automation tool, or calling the site's listing data directly if
  the calendar loads it from a data endpoint. Explain your choice before
  building it.
- If a browser is used, open a fresh window that isn't logged in, not the
  user's own Chrome profile.
- The Anthropic API key is in the environment variable ANTHROPIC_API_KEY.
  Never print it and never write it into code or files.

STARTING POINTS
1. https://events.tergar.org/  (calendar; uses "Load More" until no more results)
2. https://vajrayana.tergar.org/path-of-liberation-how-to-begin
3. https://vajrayana.tergar.org/
4. https://vajrayana.tergar.org/dorje-drolo-dzogchen
Follow event detail links from these pages, including external
registration and information sites (Eventbrite, HelloAsso, local Tergar
sites, etc.), to get the description and any other needed details
(respecting each site's robots.txt). Record the registration link as the
"More information" value. Exclude events whose listing or registration
page says registration is closed.

RULES
- Exclude past events. Include upcoming events however far ahead.
  Compare dates to today's date at runtime.
- Don't invent data. If a field is missing, write "Not listed". Never guess
  dates, times, or years. Flag ambiguous years.
- Every row includes its source URL and the date fetched.
- Tag each event with Type, Format(s), and Language(s).
- Mark restricted events (the page says restricted, or prerequisites apply)
  in a Restricted column. Never list a restricted event as "Open to everyone".
- Recurring sessions go on their own tab, not the Events tab.
- Check robots.txt and respect it. Pause 2 to 3 seconds between page loads.
- Don't log in to any site and don't access member-only content.

EXTRACTION (per event)
Event title, Teacher(s), Type, Format(s), Language(s), Start date, End date,
Host, Location, Prerequisites, Restricted (yes/no), More information (URL),
Description (only if visible without logging in), Source URL, Date fetched,
Summary, Needs review (yes/no and reason).

SUMMARIES
Use Claude Sonnet 5.5 (model string: claude-sonnet-5-5) through the Anthropic
API. Write a 2 to 3 sentence plain-English summary using only the extracted
fields and page text. If the API call fails, leave Summary blank and continue.

CHECKS (flag as Needs review, never drop the row)
- End date before start date
- Missing dates
- Same title and date appearing more than once
- Year that differs from neighboring events
- Summary mentions a teacher or date not found in the extracted fields

OUTPUTS
1. docs\Tergar_Events_Library_YYYY-MM-DD.xlsx (today's date). Tabs:
   - Events: all upcoming events, sorted by start date, source link on every row
   - Recurring Sessions
   - Changes: new, changed, and removed events versus the previous run,
     with the field that changed
   - Notes: run date, sources, counts, rows needing review, errors
2. docs\Events_YYYY-MM-DD.csv: same columns as the Events tab, UTF-8
3. data\last_run.json: snapshot used for comparison on the next run
Never overwrite docs\Tergar_Events_Library_firstcut.xlsx.

BASELINE
docs\Tergar_Events_Library_firstcut.xlsx is the manual first build. Use it
only for comparison. In Notes, list where the script's output differs. Known
points to check:
- Year-End Retreat end date should be 2027-01-03 (site text says "2026").
- Singapore Path of Liberation retreat (Oct 15-18) appears past; exclude it.
- Malaysia retreat (Nov 10-13) year is assumed 2026; flag it.
- The "2027 Path of Liberation Level 1 Online Retreat" link points to a
  July 2026 event page; flag it.
- Dorje Drolö Immersion and Bardos program have no exact dates; keep as text
  and flag.

SETUP AND PAUSE POINTS (completed 2026-11-02)
1. Confirm Python works and list the libraries you plan to use.
2. Explain the fetching method you chose and why.
3. Confirm the API key variable is set, without printing it.
4. Run on events.tergar.org only. Report the number of upcoming events found
   and stop for my review before running the other sources.

DELIVERABLES (collector)
Working script, a README with plain-language setup and run steps, and a
list of anything that couldn't be verified.
