"""
Write data/shared-events.yaml from the collector's latest snapshot
(data/last_run.json).

This is the bridge between the events collector and the site build until
milestone 3, when the collector writes this file itself.

- Each event gets a stable id (title + start date), so groups can select it.
- The copied Description is NOT exported (it is never published).
- Review decisions already recorded in shared-events.yaml (review_cleared,
  summary_approved) are kept when the file is regenerated.

Run:  py -3.9 tools/export_shared_events.py
"""

import datetime as dt
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "data" / "last_run.json"
OUT = ROOT / "data" / "shared-events.yaml"

NOT_LISTED = "Not listed"
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def slug(text):
    import unicodedata
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    text = text.lower().replace("’", "").replace("'", "")
    text = re.sub(r"[^\w]+", "-", text, flags=re.UNICODE).strip("-")
    return text[:60].strip("-") or "event"


def iso_or_none(v):
    return v if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", v) else None


def month_label_date(v, last=False):
    """'Sep 2026 (no day listed)' -> first (or last) day of that month."""
    m = re.match(r"^([A-Za-z]{3}) (\d{4})", v or "")
    if not m or m.group(1).lower() not in MONTHS:
        return None
    y, mo = int(m.group(2)), MONTHS[m.group(1).lower()]
    if not last:
        return dt.date(y, mo, 1).isoformat()
    nxt = dt.date(y + (mo == 12), mo % 12 + 1, 1)
    return (nxt - dt.timedelta(days=1)).isoformat()


def clean_value(v):
    return None if v in (None, "", NOT_LISTED) else v


def main():
    if not SNAPSHOT.exists():
        sys.exit("No collector snapshot found (%s). Run tergar_events.py first." % SNAPSHOT)
    snap = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    previous = {}
    if OUT.exists():
        old = yaml.safe_load(OUT.read_text(encoding="utf-8")) or {}
        previous = {e["id"]: e for e in old.get("events", [])}

    events, seen = [], set()
    for r in snap["events"]:
        start = iso_or_none(r.get("Start date"))
        end = iso_or_none(r.get("End date"))
        date_text = None
        if not start:
            # Month-only or undated: keep the wording, never invent days.
            parts = [p for p in (r.get("Start date"), r.get("End date")) if p and p != NOT_LISTED]
            date_text = " to ".join(re.sub(r"\s*\(no day listed\)", "", p) for p in parts) or None
        sort_date = start or month_label_date(r.get("Start date"))
        last_date = end or start or month_label_date(r.get("End date"), last=True)

        base = slug(r["Event title"]) + "-" + (start or (sort_date or "undated"))
        eid, n = base, 2
        while eid in seen:
            eid, n = "%s-%d" % (base, n), n + 1
        seen.add(eid)

        sources = [u.strip() for u in (r.get("Source URL") or "").split(" ; ") if u.strip()]
        info = [u.strip() for u in (r.get("More information") or "").split(" ; ")
                if u.strip().startswith("http")]
        restricted = {"Yes": "yes", "No": "no"}.get(r.get("Restricted"), "not stated")
        needs = r.get("Needs review") or "No"
        prev = previous.get(eid, {})

        events.append({
            "id": eid,
            "title": r["Event title"],
            "start": start,
            "end": end,
            "date_text": date_text,
            "sort_date": sort_date,
            "last_date": last_date,
            "time": None,          # milestone 3: separate time field
            "time_zone": None,     # milestone 3: separate time zone field
            "date_as_listed": clean_value(r.get("Date (as listed)")),
            "type": clean_value(r.get("Type")),
            "format": clean_value(r.get("Format(s)")),
            "languages": clean_value(r.get("Language(s)")),
            "teachers": clean_value(r.get("Teacher(s)")),
            "host": clean_value(r.get("Host")),
            "place": clean_value(r.get("Location")),
            "restricted": restricted,
            "prerequisites": clean_value(r.get("Prerequisites")),
            "source_url": sources[0] if sources else None,
            "registration_url": info[0] if info else None,
            "attribution": "Event information from Tergar",
            "summary": clean_value(r.get("Summary")),
            "needs_review": None if needs == "No" else re.sub(r"^Yes:\s*", "", needs),
            "review_cleared": bool(prev.get("review_cleared", False)),
            "summary_approved": bool(prev.get("summary_approved", False))
                                and prev.get("summary") == clean_value(r.get("Summary")),
            "collector_source": r.get("_source"),
            "date_fetched": r.get("Date fetched"),
        })

    events.sort(key=lambda e: (e["sort_date"] or "9999", e["title"]))
    header = (
        "# Shared Tergar events library. Generated by tools/export_shared_events.py\n"
        "# from the collector snapshot (data/last_run.json) on %s.\n"
        "# Groups select events by id. Do not edit event facts here; rerun the\n"
        "# collector instead. Review decisions you may set by hand:\n"
        "#   review_cleared: true    -> a flagged event may be published\n"
        "#   summary_approved: true  -> the summary may be published\n"
        "# (an approval resets if the summary text changes)\n" % dt.date.today().isoformat()
    )
    body = yaml.safe_dump({"generated": dt.date.today().isoformat(),
                           "collector_run": snap.get("run_date"),
                           "events": events},
                          allow_unicode=True, sort_keys=False, width=100)
    OUT.write_text(header + body, encoding="utf-8")
    flagged = sum(1 for e in events if e["needs_review"] and not e["review_cleared"])
    print("Wrote %s: %d events (%d flagged and not yet cleared)" % (OUT, len(events), flagged))


if __name__ == "__main__":
    main()
