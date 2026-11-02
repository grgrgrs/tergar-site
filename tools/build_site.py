"""
Build the Living Group Pages (milestone 1: static pages for Venice and Stuart).

Reads:   data/shared-events.yaml, data/shared/*.yaml, data/groups/*.yaml
Writes:  site/           publish build (only reviewed content)    --mode publish
         site-preview/   preview build for George (everything,     --mode preview (default)
                         with review badges). Never deploy this one.
Report:  data/build-report-<mode>.txt

Run:  py -3.9 tools/build_site.py                 (preview)
      py -3.9 tools/build_site.py --mode publish

Design and rules: docs/living-group-pages-handoff.md and CLAUDE.md.
"""

import argparse
import datetime as dt
import html
import json
import re
import shutil
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
DATA = ROOT / "data"

MAX_FEATURED = 10
_private = DATA / "private" / "contacts.yaml"
PRIVATE_CONTACTS = (yaml.safe_load(_private.read_text(encoding="utf-8")) or {}).get("contacts", {}) \
    if _private.exists() else {}
UTC = ZoneInfo("UTC")
ZONE_ABBR = {"America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT",
             "America/Phoenix": "MST", "America/Los_Angeles": "PT"}
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
ORD = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
FORMAT_TEXT = {"in_person": "In person", "zoom": "Zoom", "both": "In person and Zoom"}


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def load_yaml(path):
    return yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}


def as_date(v):
    if v is None or isinstance(v, dt.date):
        return v
    return dt.date.fromisoformat(str(v))


# --------------------------------------------------------------------------
# Dates and times
# --------------------------------------------------------------------------

def fmt12(t):
    h, m = t.hour, t.minute
    return "%d:%02d %s" % ((h + 11) % 12 + 1, m, "pm" if h >= 12 else "am")


def zone_abbr(zone, when):
    return ZONE_ABBR.get(zone) or when.tzname()


def time_label(day, hhmm, src_zone, group_zone):
    """'10:00 am ET / 15:00 UTC' in the group's zone first, then UTC."""
    if not hhmm or not day:
        return None
    h, m = [int(x) for x in str(hhmm).split(":")]
    src = dt.datetime(day.year, day.month, day.day, h, m, tzinfo=ZoneInfo(src_zone or group_zone))
    local = src.astimezone(ZoneInfo(group_zone))
    utc = src.astimezone(UTC)
    label = "%s %s / %02d:%02d UTC" % (fmt12(local), zone_abbr(group_zone, local), utc.hour, utc.minute)
    if utc.date() > local.date():
        label += " (next day)"
    elif utc.date() < local.date():
        label += " (previous day)"
    return label


def fmt_day(d, with_weekday=True):
    s = "%s %d" % (MONTHS[d.month - 1][:3], d.day)
    return ("%s, %s" % (WEEKDAYS[d.weekday()][:3], s)) if with_weekday else s


def date_range(start, end, today):
    """'Fri, Dec 4 – Mon, Dec 7' (+ year when not this year)."""
    if not start:
        return None
    end = end or start
    years = {start.year, end.year}
    show_year = years != {today.year}
    if end == start:
        return fmt_day(start) + (", %d" % start.year if show_year else "")
    if start.year != end.year:
        return "%s, %d – %s, %d" % (fmt_day(start), start.year, fmt_day(end), end.year)
    return "%s – %s%s" % (fmt_day(start), fmt_day(end), (", %d" % start.year) if show_year else "")


# --------------------------------------------------------------------------
# Meeting series
# --------------------------------------------------------------------------

def series_dates(s, today, count=10):
    """Upcoming meeting dates computed from the cadence (in the series' zone)."""
    wd = WEEKDAYS.index(s["weekday"])
    start = as_date(s.get("start_date"))
    end = as_date(s.get("end_date"))
    d = max(today, start) if start else today
    out = []
    for _ in range(800):
        if end and d > end:
            break
        ok = d.weekday() == wd
        if ok and s["cadence"] == "monthly_weeks":
            ok = ((d.day - 1) // 7 + 1) in s.get("weeks", [])
        if ok and s["cadence"] == "every_other_week":
            anchor = as_date(s["anchor_date"])
            ok = ((d - anchor).days // 7) % 2 == 0
        if ok:
            out.append(d)
            if len(out) >= count:
                break
        d += dt.timedelta(days=1)
    return out


def cadence_text(s):
    if s["cadence"] == "weekly":
        return "Every %s" % s["weekday"]
    if s["cadence"] == "every_other_week":
        return "Every other %s" % s["weekday"]
    weeks = [ORD[w] for w in s.get("weeks", [])]
    joined = " and ".join(weeks) if len(weeks) <= 2 else ", ".join(weeks[:-1]) + " and " + weeks[-1]
    return "%s %ss of the month" % (joined, s["weekday"])


# --------------------------------------------------------------------------
# Access line (Requires / open / not stated)
# --------------------------------------------------------------------------

GENERIC_PREREQ = re.compile(r"^Prerequisites apply( \(details not shown on calendar\)| \(see (linked )?page\))?$")


def tidy_place(place, fmt):
    """Tidy listing wording: 'Online Event| Tergar Institute' -> 'Online; Tergar Institute'.
    Drops a bare 'Online' that only repeats the format."""
    if not place:
        return None
    parts = [p.strip() for p in re.split(r"\s*\|\s*", place) if p.strip()]
    parts = ["Online" if re.fullmatch(r"online( event)?", p, re.I) else p for p in parts]
    if parts == ["Online"] and fmt and "online" in fmt.lower():
        return None
    return "; ".join(parts)


def access_line(restricted, prerequisites):
    """Returns (kind, text). Never 'Open to everyone' for a gated or unknown event."""
    if restricted == "yes":
        if not prerequisites or GENERIC_PREREQ.match(prerequisites):
            return "requires", "Requires: prerequisites set by the organizer; see the event page for details."
        return "requires", "Requires: " + prerequisites
    if restricted == "no":
        return "open", "Open to everyone"
    return "unknown", "Access not stated, check the event page."


# --------------------------------------------------------------------------
# Build one group page
# --------------------------------------------------------------------------

def stale_months(text, today):
    """Months already passed this year, named without a year."""
    out = []
    for m in re.finditer(r"\b(%s)\b(?!,?\s+\d{4})" % "|".join(MONTHS), text or ""):
        if MONTHS.index(m.group(1)) + 1 < today.month:
            out.append(m.group(1))
    return out


def build_group(g, shared_events, shared_series, lib, today, mode, report):
    preview = mode == "preview"
    zone = g["time_zone"]
    page = {"g": g, "preview": preview, "issues": []}

    def issue(text):
        page["issues"].append(text)
        report.append("  - " + text)

    # Contact (role address, only with consent). The address lives in the
    # private, uncommitted file data/private/contacts.yaml.
    c = dict(g.get("contact") or {})
    c.setdefault("address", PRIVATE_CONTACTS.get(g["path"]))
    page["contact"] = None
    if c.get("address"):
        if c.get("consent"):
            page["contact"] = {"address": c["address"], "draft": False}
        elif preview:
            page["contact"] = {"address": c["address"], "draft": True}
            issue("Contact %s is shown in preview only: group consent not yet recorded" % c["address"])
        else:
            issue("Contact not published: group consent not yet recorded")

    # Quote
    quotes = {q["id"]: q for q in lib.get("quotes", [])}
    page["quote"] = quotes.get(g.get("quote")) if g.get("quote") else None
    if g.get("quote") and not page["quote"]:
        issue("Quote id '%s' not found in the shared library" % g["quote"])

    # First announcement (+ flag a passed month with no year)
    ann = g.get("first_announcement")
    page["announcement"] = ann
    page["announcement_flags"] = stale_months(ann, today) if ann else []
    for mname in page["announcement_flags"]:
        issue("First announcement mentions %s with no year, and %s has passed: please correct" % (mname, mname))

    # Meeting series. Three places on the page:
    #   series:     Meeting schedule  -> the group's own meetings only
    #   recurring:  Program announcements, "Recurring" -> other Tergar series
    #   community:  Program announcements, "Community events (non-Tergar)"
    # Any series in 'series' or 'recurring' may also be featured.
    local_series = {s["id"]: s for s in g.get("local_series", [])}

    def series_item(entry):
        s = shared_series.get(entry["shared"]) if "shared" in entry else local_series.get(entry.get("local"))
        if not s:
            issue("Meeting series %s not found" % entry)
            return None
        if s.get("cadence_text"):          # free-text schedule (community events)
            return {"title": s["title"], "host": s.get("host"), "cadence": s["cadence_text"],
                    "time": None, "format": None, "place": s.get("place"), "next": None,
                    "dates_json": None, "zoom_text": None, "zoom_url": None, "requires": None,
                    "notes": s.get("notes"), "links": s.get("links") or [], "url": s.get("url"),
                    "featured": False}
        dates = series_dates(s, today)
        if not dates:
            return None  # ended series are hidden
        fmt = s.get("format", "zoom")
        zoom_text, zoom_url = None, None
        if fmt in ("zoom", "both"):
            if s.get("zoom_access") == "shown" and s.get("zoom_url"):
                zoom_text, zoom_url = "Join on Zoom", s["zoom_url"]
            else:
                zoom_text = "Zoom link on request"
        return {
            "id": s["id"], "title": s["title"], "host": s.get("host"),
            "cadence": cadence_text(s),
            "time": time_label(dates[0], s["start_time"], s.get("time_zone"), zone),
            "format": FORMAT_TEXT.get(fmt, fmt), "place": s.get("place"),
            "next": fmt_day(dates[0]), "next_date": dates[0],
            "dates_json": json.dumps([[d.isoformat(), fmt_day(d),
                                       time_label(d, s["start_time"], s.get("time_zone"), zone)]
                                      for d in dates]),
            "zoom_text": zoom_text, "zoom_url": zoom_url,
            "requires": ("Requires: " + s["requires"]) if s.get("requires") else None,
            "notes": s.get("notes"), "description": s.get("description"),
            "links": s.get("links") or [], "url": s.get("url"),
            "featured": bool(entry.get("featured")),
        }

    page["schedule"] = [x for x in (series_item(e) for e in g.get("series", [])) if x]
    page["recurring"] = [x for x in (series_item(e) for e in g.get("recurring", [])) if x]
    page["community"] = [x for x in (series_item(e) for e in g.get("community", [])) if x]
    page["community_note"] = g.get("community_note")
    page["zoom_on_request"] = any(x["zoom_text"] and not x["zoom_url"]
                                  for x in page["schedule"] + page["recurring"])

    # Next meeting (hidden once its date has passed)
    nm = g.get("next_meeting")
    if nm and (not nm.get("date") or as_date(nm["date"]) >= today):
        page["next_meeting"] = dict(nm, day=fmt_day(as_date(nm["date"])) if nm.get("date") else None)
    else:
        page["next_meeting"] = None

    # Events
    local_events = {e["id"]: e for e in g.get("local_events", [])}
    items = []
    for sel in g.get("events", []):
        if "shared" in sel:
            ev = shared_events.get(sel["shared"])
            if not ev:
                issue("Shared event id not found (maybe renamed by the collector): %s" % sel["shared"])
                continue
            start, end = as_date(ev.get("start")), as_date(ev.get("end"))
            last = as_date(ev.get("last_date"))
            sort = as_date(ev.get("sort_date"))
            badges = []
            if ev.get("needs_review") and not ev.get("review_cleared"):
                if not preview:
                    issue("Not published (needs review): %s - %s" % (ev["title"], ev["needs_review"]))
                    continue
                badges.append("Needs review: " + ev["needs_review"])
                issue("Needs review (hidden in publish build): %s" % ev["title"])
            summary = ev.get("summary")
            summary_draft = False
            if summary and not ev.get("summary_approved"):
                if preview:
                    summary_draft = True
                else:
                    summary = None
            kind, access = access_line(ev.get("restricted"), ev.get("prerequisites"))
            item = {
                "id": ev["id"], "title": ev["title"], "local": False,
                "start": start, "end": end, "sort": sort, "last": last,
                "date_text": date_range(start, end, today) or ev.get("date_text") or "Dates not listed",
                "time": time_label(start, ev.get("time"), ev.get("time_zone"), zone) if ev.get("time") else None,
                "teachers": ev.get("teachers"), "format": ev.get("format"),
                "place": tidy_place(ev.get("place"), ev.get("format")),
                "languages": ev.get("languages"),
                "access_kind": kind, "access": access,
                "summary": summary, "summary_draft": summary_draft,
                "source_url": ev.get("source_url"), "registration_url": ev.get("registration_url"),
                "attribution": ev.get("attribution") or "Event information from Tergar",
                "badges": badges,
            }
        else:
            ev = local_events.get(sel.get("local"))
            if not ev:
                issue("Local event id not found: %s" % sel.get("local"))
                continue
            start, end = as_date(ev.get("start")), as_date(ev.get("end"))
            kind, access = ("requires", "Requires: " + ev["requires"]) if ev.get("requires") else (None, None)
            item = {
                "id": ev["id"], "title": ev["title"], "local": True,
                "start": start, "end": end, "sort": start, "last": end or start,
                "date_text": date_range(start, end, today) or "Dates not listed",
                "time": time_label(start, ev.get("time"), zone, zone) if ev.get("time") else None,
                "teachers": ev.get("teachers"), "format": ev.get("format"), "place": ev.get("place"),
                "languages": None, "access_kind": kind, "access": access,
                "summary": ev.get("description"), "summary_draft": False,
                "source_url": None, "registration_url": ev.get("url"),
                "attribution": None, "badges": [],
            }
        if item["last"] and item["last"] < today:
            continue  # past events drop off
        if not item["sort"]:
            if preview:
                item["badges"].append("No dates: hidden from the publish build")
            else:
                issue("Not published (no dates): %s" % item["title"])
                continue
        item["featured"] = bool(sel.get("featured"))
        item["note"] = sel.get("note")
        items.append(item)

    drafts = [x["title"] for x in items if x["summary_draft"] and x.get("featured")]
    if drafts:
        issue("%d featured summar%s not yet approved (hidden in publish build): %s"
              % (len(drafts), "y" if len(drafts) == 1 else "ies", "; ".join(drafts)))
    items.sort(key=lambda x: (x["sort"] or dt.date.max, x["title"]))
    # Featured: events and series together, closest date first (a series by its
    # next meeting). Placement is decided in the browser by measured column
    # heights (each block goes to the shorter column); the side set here is
    # only the no-JavaScript fallback.
    featured = [dict(x, kind="event") for x in items if x["featured"]]
    for s in page["schedule"] + page["recurring"]:
        if s["featured"]:
            featured.append(dict(s, kind="series", sort=s["next_date"]))
    featured.sort(key=lambda x: (x["sort"] or dt.date.max, x["title"]))
    if len(featured) > MAX_FEATURED:
        issue("%d items featured; only the first %d (by date) are shown as blocks"
              % (len(featured), MAX_FEATURED))
        featured = featured[:MAX_FEATURED]
    for i, x in enumerate(featured):
        x["feat_index"] = i
        x["side"] = "L" if i % 2 == 0 else "R"
    page["announcements"] = items
    page["featured"] = featured

    # From Tergar and resources (chosen from central lists)
    ft = {x["id"]: x for x in lib.get("from_tergar", [])}
    rs = {x["id"]: x for x in lib.get("resources", [])}
    page["from_tergar"] = [ft[i] for i in g.get("from_tergar", []) if i in ft]
    page["resources"] = [rs[i] for i in g.get("resources", []) if i in rs]
    for i in g.get("from_tergar", []):
        if i not in ft:
            issue("From Tergar id not found: %s" % i)
    for i in g.get("resources", []):
        if i not in rs:
            issue("Resource id not found: %s" % i)
    return page


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Build the Living Group Pages.")
    ap.add_argument("--mode", choices=["preview", "publish"], default="preview")
    ap.add_argument("--today", help="override today's date (YYYY-MM-DD), for testing")
    args = ap.parse_args()
    today = as_date(args.today) if args.today else dt.date.today()
    out_dir = ROOT / ("site" if args.mode == "publish" else "site-preview")

    shared = load_yaml(DATA / "shared-events.yaml")
    shared_events = {e["id"]: e for e in shared.get("events", [])}
    shared_series = {s["id"]: s for s in load_yaml(DATA / "shared" / "series.yaml").get("series", [])}
    lib = load_yaml(DATA / "shared" / "library.yaml")

    env = Environment(loader=FileSystemLoader(str(TOOLS / "templates")),
                      autoescape=select_autoescape(["html", "j2"]),
                      trim_blocks=True, lstrip_blocks=True)
    tpl = env.get_template("group.html.j2")

    if out_dir.exists():
        shutil.rmtree(out_dir)
    (out_dir / "assets").mkdir(parents=True)
    for f in (TOOLS / "static").iterdir():
        shutil.copy(f, out_dir / "assets" / f.name)

    report = ["Build report (%s) for %s" % (args.mode, today.isoformat()), ""]
    groups = []
    for gf in sorted((DATA / "groups").glob("*.yaml")):
        g = load_yaml(gf)
        report.append("%s (%s)" % (g["name"], g["path"]))
        page = build_group(g, shared_events, shared_series, lib, today, args.mode, report)
        if not page["issues"]:
            report.append("  no issues")
        target = out_dir / g["path"] / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        depth = "../" * len(Path(g["path"]).parts)
        target.write_text(tpl.render(page=page, today=today, built=dt.date.today(),
                                     assets=depth + "assets", mode=args.mode,
                                     zone=g["time_zone"]), encoding="utf-8")
        groups.append({"name": g["name"], "full_name": g.get("full_name"), "path": g["path"],
                       "location": g.get("location")})
        report.append("")

    (out_dir / "index.html").write_text(env.get_template("index.html.j2").render(
        groups=groups, preview=args.mode == "preview", assets="assets"), encoding="utf-8")

    report_path = DATA / ("build-report-%s.txt" % args.mode)
    report_path.write_text("\n".join(report) + "\n", encoding="utf-8")
    print("\n".join(report))
    print("Wrote %s" % out_dir)
    print("Report: %s" % report_path)


if __name__ == "__main__":
    main()
