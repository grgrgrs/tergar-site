# Handoff: Living Group Pages on tergargroups.org

Status: decisions made in the design thread. This brief supersedes the section list and CLAUDE.md drafts from the events thread. Where this brief and `living-group-pages-v6.html` disagree, flag the conflict to George rather than choosing.

## Source of truth

- **Design:** `living-group-pages-v6.html`. A working prototype with sample data. Open it in a browser to see the layout, dialogs, approvals, and public page. Its data model is a reference, not a production store.
- **Decisions:** this file.

## What we are building

One system. The events collector feeds a shared library, groups select from it, and their pages are generated from the selections.

- **Collector** (`tools/`): fetches Tergar events and writes `data/shared-events.yaml`. Each event carries a source URL, date, time, time zone, format, place, prerequisite text, and attribution to Tergar.
- **Shared library** (`data/shared/`): Tergar events, meeting series, quotes, From Tergar items, and resource links. Groups can't change these records. In the pilot, George maintains them in the Tergar coordinator role.
- **Groups** (`data/groups/us-venice-fl.yaml`, `us-stuart-fl.yaml`): each selects shared events, marks featured events, adds local notes, local events, meeting series, a next-meeting block, a first announcement, a quote, and chosen From Tergar and resource items.
- **Summaries:** generated at build time using the key from an environment variable. The build publishes the summary text only, never the key and never Tergar's full descriptions. George reviews summaries before they publish.

## Page layout

Full width: header, quote, footer.

- **Left column, top to bottom:** first announcement, meeting schedule, program announcements, featured events (left), From Tergar.
- **Right column, top to bottom:** next meeting, featured events (right), resource links.
- **Phone order:** header, quote, first announcement, meeting schedule, next meeting, program announcements, featured (left), featured (right), From Tergar, resource links, footer.

Hidden when empty: everything except header and footer. The meeting schedule is rarely empty.

## Rules

**Featured events**
- A group can feature up to 10 events.
- Featured events are ordered by date, closest first. Strict alternation: the 1st, 3rd, 5th... go left; the 2nd, 4th... go right. Don't reorder for balance.
- Featuring an event selects it.

**Column balance**
- After layout, measure both columns' rendered heights. The shorter column gets a filler block so both end level. Measure, don't estimate.
- The filler is a faint Indra's net image at 35% opacity, sized to cover. George's own artwork, so no clearance is needed.

**Program announcements**
- Lists every selected upcoming event, closest first. Featured events are always included.
- Past events drop off automatically.
- A local note on an event shows as a short marker in this list.

**Times**
- Show the group's zone first, then UTC: `10:00 am ET / 15:00 UTC`.
- Don't infer the viewer's time zone.

**Requires label** (from George's review)
- Where an event has a prerequisite, show a visible line: `Requires: <prerequisite text from source>`.
- Never show "Open to everyone" on a gated event. Listing the event publicly is fine, since it shows the path to Path of Liberation.

**Attribution and disclaimer**
- Each event links to its Tergar source page and states that the event information comes from Tergar. George's summaries are his own.
- Footer disclaimer: the site is independent and is not an official Tergar site. It carries practice and community information only.

**Meeting series**
- Shared or local. Each has a cadence (weekly, every other week, or certain weeks of the month), a start time, a time zone, a format (in person, Zoom, or both), a place, a Zoom access setting (on request by default, or login only, or shown), and optional start and end dates.
- The next occurrence is computed from the cadence. Ended series are hidden.

**Text and dates**
- A first announcement mentioning a month that has already passed, with no year, is flagged for correction.

**Shared choices**
- Quotes, From Tergar items, and resource links are chosen by each group from central lists. Nothing chosen means the block is hidden.

**Approval**
- Nothing publishes until approved. Each change is a labelled pending item with a preview of what it will publish. The approver may be the same person as the editor.
- Suggestion for later: approval writes the change to the data file and makes a git commit, so the history is the audit trail.

**Images**
- First milestone: book covers and the filler only.
- Never depict Rinpoche, monks, or other holy figures. Use Tergar logos only as provided and approved.

**Privacy**
- Contacts are role addresses only, with the group's consent. No personal emails or phone numbers.
- The approved-sender list stays out of published files.

## Out of scope for the first milestone

- Newsletter output and sign-up forms
- Email intake and outbound email
- Logins (the group menu is used by agreement during the pilot)
- Image uploads
- Newsletter archives
- Languages other than English

## Milestones

**Milestone 1: static pages for Venice and Stuart**
Generated from the group data files and the shared events file. Include the layout, featured alternation, column balancing, program announcements, Requires label, attribution, disclaimer, and time display. Show the pages locally before deploying.

**Milestone 2: approval flow**
Pending changes with previews, approve and reject, and the git-commit record.

**Milestone 3: collector and summaries**
Refine the collector and generate summaries in the build, with the review gate.

## Hosting

- Domain: tergargroups.org, owned by George. Its root currently has no site, so the path is free.
- Paths: `/us/venice-fl` and `/us/stuart-fl`, unless George decides otherwise.
- Deploy: Cloudflare Pages on George's account. The Wrangler token already includes Pages write access.
- Keep the Presence Room Worker separate, on `presence.tergargroups.org`.

## Open decisions

1. Confirm path structure (`/us/...`) before milestone 1.
2. Whether the dashboard and approval flow become part of the public site, or stay a separate tool. This affects milestone 2.
3. Zoom access default for the pilot. Proposed: on request.
