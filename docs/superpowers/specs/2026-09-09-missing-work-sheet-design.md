# Missing Work Sheet — Design

Date: 2026-09-09
Status: approved in conversation, pending written review

## Purpose

Give a colleague (and anyone they share a Google Sheet with) a live list of every
grade-9 student's missing assignments, updated from CSV exports of the Students of
Concern Dashboard, and use that sheet as the source for a weekly digest email to
each student and each advisor.

## Constraints and decisions

- **Input** is a CSV exported by hand from the dashboard's "Download missing
  assignments (CSV)" link. Each export is the complete picture for its scope
  (all students shown under the active filters, all active courses). Anything
  absent from a new file is treated as no longer missing.
- **Identity** is Canvas student ID and Canvas assignment ID, never names.
  Names appear for display only.
- **Student email** is `login_id@episcopalhighschool.org`. The dashboard derives
  it; the sheet never applies the rule.
- **Advisor mapping** is entered by hand in a Roster tab keyed by Student ID.
- **No history tab.** Rows that disappear are deleted. Per-import counts go to a Log.
- **No opt-out.**
- **Emails** go out Tuesday 07:00 local as a digest, sent from the colleague's
  school Google Workspace account via Apps Script.
- Everything runs inside Google Workspace. No third-party services.

## Component 1: Dashboard export change

Repo: `~/code/Students of Concern Dashboard/`, function `export_missing` in
`app/views/dashboard.py`, helper `_load_missing_rows`.

New column order:

| # | Header | Source |
|---|---|---|
| 1 | Student | existing (redaction still applies) |
| 2 | Grade level | existing |
| 3 | Course | existing |
| 4 | Assignment | existing |
| 5 | Due date | existing |
| 6 | Points possible | existing |
| 7 | Student ID | `students.canvas_id` |
| 8 | Student email | `students.login_id + "@episcopalhighschool.org"`; empty if login_id empty |
| 9 | Course ID | `missing_assignments.course_id` |
| 10 | Assignment ID | `missing_assignments.assignment_id` |

New columns are appended so existing consumers of the first six are unaffected.
The domain is a module-level constant `STUDENT_EMAIL_DOMAIN`. Redact mode does not
alter IDs or email (the email carries the login ID; redaction is a UI convenience
for screenshots, not a security boundary, and the CSV is only reachable behind the
shared login). Tests in `tests/test_dashboard_export.py` are extended to assert the
new headers and values.

## Component 2: Google Sheet + Apps Script

A container-bound Apps Script project attached to a blank spreadsheet. Files:

- `Setup.gs` — menu, `setupSheet()` that creates tabs and headers idempotently.
- `Import.gs` — file-picker dialog, CSV parsing, header validation, reconciliation.
- `Email.gs` — digest builders and `sendWeeklyDigests()`; trigger installer.
- `Config.gs` — reads Config tab into an object; constants (tab names, headers).
- `Log.gs` — `logEvent(kind, details)`.
- `ImportDialog.html` — small upload form served by `HtmlService`.

### Tabs

**Current** (the shared view). Columns, in order:
Student ID, Student, Email, Grade, Course, Assignment, Due date, Points,
First seen, Last seen, Course ID, Assignment ID.
Sorted by Student, then Due date ascending with blanks last.
Row highlight (light yellow) when Student ID is not in Roster.
Sheet is protected except via script; viewers see it read-only.

**Roster**. Columns: Student ID, Student, Advisor name, Advisor email.
Import pre-fills Student ID and Student for any ID it sees that is not yet in
Roster, leaving advisor cells blank. The colleague fills them.

**Config**. Two columns, Key and Value. Keys:

| Key | Default |
|---|---|
| `dry_run` | `TRUE` |
| `dry_run_recipient` | (colleague's email, set at setup from `Session.getActiveUser()`) |
| `student_subject` | `Missing work as of {date}` |
| `student_intro` | short paragraph |
| `advisor_subject` | `Advisees' missing work as of {date}` |
| `advisor_intro` | short paragraph |
| `cc` | (blank) |
| `reply_to` | (blank; defaults to sender) |
| `delete_guard_fraction` | `0.5` |

**Log**. Columns: Timestamp, User, Kind, Added, Removed, Unchanged, Emails sent,
Notes.

### Import flow

1. Menu: **Missing Work → Import CSV…** opens `ImportDialog.html`; user picks a file.
2. Server receives file text. Parse with `Utilities.parseCsv`.
3. Validate: first row must contain all ten expected headers (order-insensitive,
   matched by exact header text after trim). Otherwise abort with a message naming
   the missing headers. Nothing is written.
4. Build map `key = studentId + "|" + assignmentId` → row for the file. Rows with a
   blank Student ID or Assignment ID are counted and reported, then skipped.
5. Read Current into a map by the same key.
6. Compute added / removed / unchanged. If `removed / current.size >
   delete_guard_fraction` and Current is non-empty, show a confirm dialog with the
   counts; cancel aborts with no writes.
7. Write Current in one `setValues` call: unchanged rows keep First seen and get
   Last seen = today; added rows get First seen = Last seen = today.
   Sort, then re-apply highlight rule.
8. Add any new Student IDs to Roster (ID and name only).
9. Log line, then summary dialog with counts.

### Email flow

`sendWeeklyDigests()` runs from an installable time-driven trigger, Tuesday 07:00.
Menu items: **Send digests now** (respects dry_run) and **Install Tuesday trigger**.

1. Read Config, Roster, Current.
2. Group Current by Student ID. For each group with a Roster row: build one email
   listing items grouped by course, each line `Assignment — due {Due date} — missing {n}
   days` (or "newly listed" when First seen is blank, "new this week" on the day it first
   appears) where n = today − First seen. Send to Email column value.
3. Group Roster rows by Advisor email. For each advisor with at least one advisee
   present in Current: one email, sections per advisee, same line format.
4. Students in Current with no Roster row, or a Roster row with blank advisor email:
   collected into a single notice emailed to `dry_run_recipient` (which doubles as
   the maintainer address) titled "Roster gaps".
5. When `dry_run` is TRUE, every email goes to `dry_run_recipient` with the
   intended recipient prepended to the subject. Counts are still logged.
6. Errors sending to one recipient are caught, written to Log Notes, and the run
   continues. Total counts logged at end.

Sender is whoever installed the trigger (the colleague). Gmail Workspace quota
(about 1,500/day) is far above the roughly 60 sends per run expected.

### Error handling summary

- Wrong file or missing headers: abort before any write.
- Blank IDs: skip row, report count.
- Large deletion: confirm before write.
- Send failure: log and continue.
- Roster gaps: reported by email, rows highlighted in Current.

### Testing

- Dashboard: pytest, extend existing export test with a fixture asserting the new
  headers and derived email.
- Apps Script: a `Tests.gs` file with pure functions (`reconcile`, `buildStudentDigest`,
  `buildAdvisorDigests`) that take plain arrays and return plain objects, exercised by
  a `runTests()` function callable from the editor. The sheet-touching wrappers stay
  thin. A fixture CSV with fake names is provided for a manual end-to-end run with
  `dry_run` on.

## Deliverables

1. Dashboard export change with tests, in the dashboard repo.
2. Apps Script source files and `ImportDialog.html` in `apps-script/` in this folder,
   plus a fake-data fixture CSV.
3. `SETUP.md`: step-by-step for the colleague — create sheet, open Extensions →
   Apps Script, paste files, run Set up sheet, authorize, fill Roster, test with dry
   run, install Tuesday trigger, turn dry run off.

## Out of scope

- Automatic pull from Canvas (no CSV step).
- Advisor mapping from Canvas advisory courses.
- History or resolved tracking.
- Multiple grade levels in one sheet (works if the export includes them, but the
  design assumes one grade).
