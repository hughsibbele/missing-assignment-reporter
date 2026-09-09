# Missing Work Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Google Sheet that rebuilds its missing-assignments list from a dashboard CSV export and emails Tuesday digests to students and advisors.

**Architecture:** Two pieces. (1) The Students of Concern Dashboard's `/export/missing.csv` gains ID and email columns. (2) A container-bound Google Apps Script keeps a Current tab in sync with each import (keyed on Student ID + Assignment ID) and sends digests from a Tuesday trigger. Pure logic (parse, reconcile, digest text) lives in files with no Apps Script globals so it can be run under Node locally; thin wrappers touch the sheet and Gmail.

**Tech Stack:** Python/Flask/pytest (dashboard); Google Apps Script (V8 runtime, plain ES5-compatible JS), Node for local tests.

**Spec:** `docs/superpowers/specs/2026-09-09-missing-work-sheet-design.md`

## Global Constraints

- Student email is `login_id + "@episcopalhighschool.org"`; derived in the dashboard only.
- Identity key everywhere is `Student ID + "|" + Assignment ID`. Never match on names.
- No history tab, no opt-out column.
- Export columns, exact order: `Student, Grade level, Course, Assignment, Due date, Points possible, Student ID, Student email, Course ID, Assignment ID`.
- Current tab columns, exact order: `Student ID, Student, Email, Grade, Course, Assignment, Due date, Points, First seen, Last seen, Course ID, Assignment ID`.
- Roster tab columns: `Student ID, Student, Advisor name, Advisor email`.
- Log tab columns: `Timestamp, User, Kind, Added, Removed, Unchanged, Emails sent, Notes`.
- Dashboard repo is `~/code/Students of Concern Dashboard/` (git). This folder (`Stuff for Steven`) is not a git repo; Apps Script files live in `apps-script/` here and are pasted into the Apps Script editor by hand.
- Test data uses fake names only. Never paste real student names into files or the conversation.
- All dates in pure code are ISO strings `YYYY-MM-DD` or `""`. Wrappers convert to/from `Date`.

---

## File Structure

Dashboard repo:
- Modify `app/views/dashboard.py` — `_load_missing_rows` (join students, select IDs) and `export_missing` (four new columns), plus constant `STUDENT_EMAIL_DOMAIN`.
- Modify `tests/test_dashboard_export.py` — seed `login_id`, extend header/value tests.

This folder, `apps-script/`:
- `Config.gs` — tab names, header lists, config defaults, `readConfig()` wrapper.
- `Dates.gs` — pure: `parseDueDate`, `formatShort`, `daysBetween`, `toIso`.
- `Reconcile.gs` — pure: `parseImportRows`, `rowKey`, `reconcile`, `sortCurrentRows`.
- `Digest.gs` — pure: `buildStudentDigest`, `buildAdvisorDigests`, `findRosterGaps`.
- `Setup.gs` — `onOpen` menu, `setupSheet`.
- `Log.gs` — `logEvent`.
- `Import.gs` — `showImportDialog`, `importCsvText` (sheet wrapper around Reconcile).
- `ImportDialog.html` — upload form.
- `Email.gs` — `sendWeeklyDigests`, `installWeeklyTrigger`.
- `Tests.gs` — `runTests()` over the pure files; runnable in Node via `test-local.sh`.
- `test-local.sh` — concatenates pure files + Tests.gs and runs under Node.
- `fixtures/missing_assignments_sample.csv` — fake-name fixture in the new export format.
- `SETUP.md` — colleague's setup guide.

---

### Task 1: Dashboard export gains ID and email columns

**Files:**
- Modify: `~/code/Students of Concern Dashboard/app/views/dashboard.py` (`_load_missing_rows` ~line 456, `export_missing` ~line 482)
- Test: `~/code/Students of Concern Dashboard/tests/test_dashboard_export.py`

**Interfaces:**
- Produces: CSV with header `Student, Grade level, Course, Assignment, Due date, Points possible, Student ID, Student email, Course ID, Assignment ID`. Task 2's `CSV_HEADERS` must match exactly.

- [ ] **Step 1: Seed login_id in the test fixture and add failing tests**

In `tests/test_dashboard_export.py`, change the students insert in `_seed` to include `login_id`:

```python
        INSERT INTO students (canvas_id, name, sortable_name, login_id, grade_level, in_dash, in_nash) VALUES
          (1, 'Zed Alpha',   'Alpha, Zed',   'zalpha30',   9,  1, 0),
          (2, 'Amy Bravo',   'Bravo, Amy',   'abravo29',   10, 0, 1),
          (3, 'Kim Charlie', 'Charlie, Kim', 'kcharlie27', 12, 0, 0);
```

Change `HEADER` and add a test:

```python
HEADER = [
    "Student", "Grade level", "Course", "Assignment", "Due date", "Points possible",
    "Student ID", "Student email", "Course ID", "Assignment ID",
]


def test_missing_id_and_email_columns(client):
    rows = _rows(client.get("/export/missing.csv?grade=9"))
    assert [r["Student ID"] for r in rows] == ["1", "1", "1"]
    assert {r["Student email"] for r in rows} == {"zalpha30@episcopalhighschool.org"}
    assert [r["Course ID"] for r in rows] == ["100", "100", "100"]
    assert [r["Assignment ID"] for r in rows] == ["1002", "1001", "1003"]


def test_missing_redact_mode_keeps_ids(client):
    rows = _rows(client.get("/export/missing.csv?redact=1&grade=9"))
    assert {r["Student"] for r in rows} == {"Student Name"}
    assert {r["Student ID"] for r in rows} == {"1"}
    assert {r["Student email"] for r in rows} == {"zalpha30@episcopalhighschool.org"}


def test_missing_blank_login_gives_blank_email(client):
    import app.db as db
    conn = db.get_connection()
    conn.execute("UPDATE students SET login_id = NULL WHERE canvas_id = 1")
    conn.commit()
    conn.close()
    rows = _rows(client.get("/export/missing.csv?grade=9"))
    assert {r["Student email"] for r in rows} == {""}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/code/"Students of Concern Dashboard" && ./venv/bin/python -m pytest tests/test_dashboard_export.py -v`
Expected: `test_missing_unfiltered_one_row_per_assignment` fails on header mismatch; the three new tests fail with `KeyError: 'Student ID'`.

- [ ] **Step 3: Implement**

In `app/views/dashboard.py`, add near the other module constants (after `REDACTED_NAME` is defined or imported):

```python
STUDENT_EMAIL_DOMAIN = "episcopalhighschool.org"


def _student_email(login_id: str | None) -> str:
    return f"{login_id}@{STUDENT_EMAIL_DOMAIN}" if login_id else ""
```

Replace the SELECT in `_load_missing_rows`:

```python
    cur.execute(
        f"""
        SELECT m.student_id, m.course_id, m.assignment_id,
               c.name AS course_name, m.name, m.due_at, m.points_possible,
               s.login_id
        FROM missing_assignments m
        JOIN courses c ON c.canvas_id = m.course_id
        LEFT JOIN students s ON s.canvas_id = m.student_id
        WHERE c.active_in_period = 1 AND m.student_id IN ({placeholders})
        ORDER BY m.student_id, c.name, m.due_at IS NULL, m.due_at, m.name
        """,
        student_ids,
    )
```

Replace the body of `export_missing`:

```python
    rows = [[
        "Student", "Grade level", "Course", "Assignment", "Due date", "Points possible",
        "Student ID", "Student email", "Course ID", "Assignment ID",
    ]]
    for s in students:
        for a in missing_by_student.get(s["student_id"], []):
            points = a["points_possible"]
            rows.append([
                _display_name(s["name"]),
                s.get("grade_level") or "",
                a["course_name"],
                a["name"],
                _format_due(a["due_at"]),
                "" if points is None else (int(points) if float(points).is_integer() else points),
                a["student_id"],
                _student_email(a["login_id"]),
                a["course_id"],
                a["assignment_id"],
            ])
    return _csv_response(rows, "missing_assignments")
```

- [ ] **Step 4: Run the full export test file and the whole suite**

Run: `cd ~/code/"Students of Concern Dashboard" && ./venv/bin/python -m pytest tests/test_dashboard_export.py -v && ./venv/bin/python -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Update CLAUDE.md line about the export**

In the dashboard's `CLAUDE.md`, in the "Filtered CSV export" paragraph, replace `student, grade level, course, assignment title, due date, points possible` with `student, grade level, course, assignment title, due date, points possible, Canvas student ID, student email (login_id@episcopalhighschool.org), course ID, assignment ID. The ID columns feed the Missing Work Google Sheet (see ~/code/Stuff for others/Stuff for Steven/).`

- [ ] **Step 6: Commit**

```bash
cd ~/code/"Students of Concern Dashboard" && git add app/views/dashboard.py tests/test_dashboard_export.py CLAUDE.md && git commit -m "Add Canvas IDs and student email to the missing-assignments export

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYzJ8MNVAHg5x2ngnRbpS3"
```

---

### Task 2: Apps Script constants, date helpers, and local test harness

**Files:**
- Create: `apps-script/Config.gs`
- Create: `apps-script/Dates.gs`
- Create: `apps-script/Tests.gs`
- Create: `apps-script/test-local.sh`

**Interfaces:**
- Produces: `TAB`, `CSV_HEADERS`, `CURRENT_HEADERS`, `ROSTER_HEADERS`, `LOG_HEADERS`, `CONFIG_DEFAULTS`, `readConfig()`; `parseDueDate(str) -> iso|''`, `formatShort(iso) -> 'Sep 8'`, `daysBetween(isoA, isoB) -> int`, `toIso(Date|string) -> iso|''`, `fromIso(iso) -> Date|''`; test helpers `assertEq(actual, expected, label)`, `runTests()`.

- [ ] **Step 1: Write Tests.gs with the harness and failing date tests**

```javascript
// Tests.gs — pure-function tests. Run in the editor via runTests(), or locally
// with ./test-local.sh (Node). Only Dates.gs, Reconcile.gs, Digest.gs and the
// constants in Config.gs are under test; sheet/Gmail wrappers are not.

var TEST_RESULTS_ = [];

function tlog_(msg) {
  if (typeof Logger !== 'undefined') Logger.log(msg); else console.log(msg);
}

function assertEq(actual, expected, label) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { TEST_RESULTS_.push({ok: true, label: label}); }
  else { TEST_RESULTS_.push({ok: false, label: label, actual: a, expected: e}); }
}

function runTests() {
  TEST_RESULTS_ = [];
  var names = [];
  var scope = (typeof globalThis !== 'undefined') ? globalThis : this;
  for (var k in scope) if (/^test_/.test(k) && typeof scope[k] === 'function') names.push(k);
  names.sort();
  names.forEach(function (n) { try { scope[n](); } catch (err) { TEST_RESULTS_.push({ok: false, label: n + ' threw', actual: String(err), expected: 'no throw'}); } });
  var failed = TEST_RESULTS_.filter(function (r) { return !r.ok; });
  TEST_RESULTS_.forEach(function (r) {
    tlog_((r.ok ? 'PASS ' : 'FAIL ') + r.label + (r.ok ? '' : '\n   expected ' + r.expected + '\n   actual   ' + r.actual));
  });
  tlog_(TEST_RESULTS_.length + ' checks, ' + failed.length + ' failed');
  return failed.length;
}

// --- Dates -----------------------------------------------------------------

function test_parseDueDate() {
  assertEq(parseDueDate('Sep 8, 2026'), '2026-09-08', 'parses dashboard format');
  assertEq(parseDueDate('Dec 25, 2026'), '2026-12-25', 'parses December');
  assertEq(parseDueDate(''), '', 'blank stays blank');
  assertEq(parseDueDate('2026-09-08'), '2026-09-08', 'iso passes through');
  assertEq(parseDueDate('garbage'), '', 'unparseable becomes blank');
}

function test_formatShort() {
  assertEq(formatShort('2026-09-08'), 'Sep 8', 'short month day');
  assertEq(formatShort(''), 'no due date', 'blank labelled');
}

function test_daysBetween() {
  assertEq(daysBetween('2026-09-01', '2026-09-09'), 8, 'eight days');
  assertEq(daysBetween('2026-09-09', '2026-09-09'), 0, 'same day');
}

function test_toIso() {
  assertEq(toIso(new Date(2026, 8, 8, 13, 45)), '2026-09-08', 'Date to iso, local');
  assertEq(toIso('2026-09-08'), '2026-09-08', 'iso string passthrough');
  assertEq(toIso(''), '', 'blank');
  assertEq(toIso(null), '', 'null');
}
```

- [ ] **Step 2: Write test-local.sh and run it to see failures**

```bash
#!/usr/bin/env bash
# Runs the pure-function tests under Node. Usage: ./test-local.sh
set -euo pipefail
cd "$(dirname "$0")"
cat Config.gs Dates.gs Reconcile.gs Digest.gs Tests.gs 2>/dev/null > /tmp/mw_tests_bundle.js
printf '\nprocess.exit(runTests() === 0 ? 0 : 1);\n' >> /tmp/mw_tests_bundle.js
node /tmp/mw_tests_bundle.js
```

Run: `cd "/Users/hkoeze/code/Stuff for others/Stuff for Steven/apps-script" && chmod +x test-local.sh && ./test-local.sh`
Expected: exits 1; failures show `test_parseDueDate threw ... parseDueDate is not defined` etc.

- [ ] **Step 3: Write Config.gs**

```javascript
// Config.gs — names, headers, defaults. Pure constants plus readConfig().

var TAB = { CURRENT: 'Current', ROSTER: 'Roster', CONFIG: 'Config', LOG: 'Log' };

// Must match the dashboard's /export/missing.csv exactly.
var CSV_HEADERS = [
  'Student', 'Grade level', 'Course', 'Assignment', 'Due date', 'Points possible',
  'Student ID', 'Student email', 'Course ID', 'Assignment ID'
];

var CURRENT_HEADERS = [
  'Student ID', 'Student', 'Email', 'Grade', 'Course', 'Assignment', 'Due date',
  'Points', 'First seen', 'Last seen', 'Course ID', 'Assignment ID'
];

var ROSTER_HEADERS = ['Student ID', 'Student', 'Advisor name', 'Advisor email'];

var LOG_HEADERS = ['Timestamp', 'User', 'Kind', 'Added', 'Removed', 'Unchanged', 'Emails sent', 'Notes'];

var CONFIG_DEFAULTS = [
  ['dry_run', 'TRUE'],
  ['dry_run_recipient', ''],
  ['student_subject', 'Missing work as of {date}'],
  ['student_intro', 'Here is the work Canvas currently shows as missing for you. Please talk with your teacher if you think something is listed in error.'],
  ['advisor_subject', "Advisees' missing work as of {date}"],
  ['advisor_intro', 'Here is the work Canvas currently shows as missing for your advisees.'],
  ['cc', ''],
  ['reply_to', ''],
  ['delete_guard_fraction', '0.5']
];

// Reads the Config tab into {key: value}. Missing keys fall back to defaults.
function readConfig() {
  var cfg = {};
  CONFIG_DEFAULTS.forEach(function (kv) { cfg[kv[0]] = kv[1]; });
  var sheet = SpreadsheetApp.getActive().getSheetByName(TAB.CONFIG);
  if (!sheet) return cfg;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var k = String(values[i][0] || '').trim();
    if (k) cfg[k] = String(values[i][1] === undefined ? '' : values[i][1]).trim();
  }
  cfg.dry_run = /^(true|yes|1)$/i.test(cfg.dry_run);
  cfg.delete_guard_fraction = parseFloat(cfg.delete_guard_fraction);
  if (isNaN(cfg.delete_guard_fraction)) cfg.delete_guard_fraction = 0.5;
  return cfg;
}
```

- [ ] **Step 4: Write Dates.gs**

```javascript
// Dates.gs — pure date helpers. ISO 'YYYY-MM-DD' strings in, out.

var MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

// 'Sep 8, 2026' or '2026-09-08' -> '2026-09-08'; anything else -> ''.
function parseDueDate(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec(s);
  if (!m) return '';
  var mi = MONTHS_.indexOf(m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase());
  if (mi < 0) return '';
  return m[3] + '-' + pad2_(mi + 1) + '-' + pad2_(parseInt(m[2], 10));
}

// '2026-09-08' -> 'Sep 8'; '' -> 'no due date'.
function formatShort(iso) {
  if (!iso) return 'no due date';
  var p = iso.split('-');
  return MONTHS_[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10);
}

// Whole days from isoA to isoB (UTC arithmetic so DST cannot skew it).
function daysBetween(isoA, isoB) {
  var a = isoA.split('-'), b = isoB.split('-');
  var ua = Date.UTC(+a[0], +a[1] - 1, +a[2]);
  var ub = Date.UTC(+b[0], +b[1] - 1, +b[2]);
  return Math.round((ub - ua) / 86400000);
}

// Date (local) or iso string or blank -> iso string.
function toIso(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return v.getFullYear() + '-' + pad2_(v.getMonth() + 1) + '-' + pad2_(v.getDate());
  }
  return parseDueDate(String(v));
}

// iso string -> local Date at midnight, or '' for blank.
function fromIso(iso) {
  if (!iso) return '';
  var p = iso.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function todayIso() { return toIso(new Date()); }
```

- [ ] **Step 5: Run the local tests**

Run: `cd "/Users/hkoeze/code/Stuff for others/Stuff for Steven/apps-script" && ./test-local.sh`
Expected: all date checks PASS, `0 failed`, exit 0.

---

### Task 3: Pure reconciliation (parse import rows, diff against Current)

**Files:**
- Create: `apps-script/Reconcile.gs`
- Modify: `apps-script/Tests.gs` (append tests)

**Interfaces:**
- Consumes: `CSV_HEADERS`, `parseDueDate`, `daysBetween` from Task 2.
- Produces:
  - `parseImportRows(csvRows: string[][]) -> {rows: ImportRow[], skipped: number, missingHeaders: string[]}` where `ImportRow = {studentId, student, email, grade, course, assignment, dueDate(iso|''), points, courseId, assignmentId}` (all strings except none; IDs are strings).
  - `rowKey(r) -> studentId + '|' + assignmentId`.
  - `reconcile(currentRows: CurrentRow[], importRows: ImportRow[], todayIso) -> {rows: CurrentRow[], added, removed, unchanged, newStudents: [{studentId, student}]}` where `CurrentRow = ImportRow + {firstSeen, lastSeen}`.
  - `sortCurrentRows(rows) -> rows` sorted by student, then due date ascending, blanks last, then assignment.
  - `currentRowToArray(r) -> any[]` and `arrayToCurrentRow(arr) -> CurrentRow` mapping to/from `CURRENT_HEADERS` order (dates as iso strings; wrappers convert).

- [ ] **Step 1: Append failing tests to Tests.gs**

```javascript
// --- Reconcile -------------------------------------------------------------

function csvFixture_() {
  return [
    CSV_HEADERS.slice(),
    ['Ada Test', '9', 'Algebra I', 'Homework 5', 'Sep 4, 2026', '10', '1', 'atest30@episcopalhighschool.org', '100', '1001'],
    ['Ada Test', '9', 'Algebra I', 'Lab Notebook', '', '5', '1', 'atest30@episcopalhighschool.org', '100', '1003'],
    ['Bo Sample', '9', 'Biology', 'Quiz 3', 'Sep 2, 2026', '', '2', 'bsample30@episcopalhighschool.org', '102', '1002']
  ];
}

function test_parseImportRows_happy() {
  var out = parseImportRows(csvFixture_());
  assertEq(out.missingHeaders, [], 'no missing headers');
  assertEq(out.skipped, 0, 'nothing skipped');
  assertEq(out.rows.length, 3, 'three rows');
  assertEq(out.rows[0], {
    studentId: '1', student: 'Ada Test', email: 'atest30@episcopalhighschool.org', grade: '9',
    course: 'Algebra I', assignment: 'Homework 5', dueDate: '2026-09-04', points: '10',
    courseId: '100', assignmentId: '1001'
  }, 'first row mapped');
  assertEq(out.rows[1].dueDate, '', 'blank due date');
}

function test_parseImportRows_header_order_insensitive() {
  var rows = csvFixture_();
  var idx = {}; rows[0].forEach(function (h, i) { idx[h] = i; });
  var order = ['Assignment ID', 'Student', 'Student ID', 'Course', 'Assignment', 'Due date', 'Points possible', 'Grade level', 'Student email', 'Course ID'];
  var shuffled = rows.map(function (r) { return order.map(function (h) { return r[idx[h]]; }); });
  var out = parseImportRows(shuffled);
  assertEq(out.rows[2].assignmentId, '1002', 'shuffled columns still map');
}

function test_parseImportRows_missing_headers() {
  var rows = csvFixture_();
  rows = rows.map(function (r) { return r.slice(0, 6); });
  var out = parseImportRows(rows);
  assertEq(out.missingHeaders, ['Student ID', 'Student email', 'Course ID', 'Assignment ID'], 'reports missing');
  assertEq(out.rows, [], 'no rows when headers missing');
}

function test_parseImportRows_skips_blank_ids() {
  var rows = csvFixture_();
  rows[2][6] = '';
  rows[3][9] = '';
  var out = parseImportRows(rows);
  assertEq(out.skipped, 2, 'two skipped');
  assertEq(out.rows.length, 1, 'one kept');
}

function test_parseImportRows_ignores_trailing_blank_lines() {
  var rows = csvFixture_(); rows.push(['']); rows.push([]);
  assertEq(parseImportRows(rows).rows.length, 3, 'blank lines ignored');
}

function test_reconcile_adds_updates_removes() {
  var imp = parseImportRows(csvFixture_()).rows;
  var current = [
    { studentId: '1', student: 'Ada Test', email: 'atest30@episcopalhighschool.org', grade: '9', course: 'Algebra I',
      assignment: 'Homework 5', dueDate: '2026-09-04', points: '10', courseId: '100', assignmentId: '1001',
      firstSeen: '2026-09-01', lastSeen: '2026-09-05' },
    { studentId: '1', student: 'Ada Test', email: 'atest30@episcopalhighschool.org', grade: '9', course: 'Algebra I',
      assignment: 'Old Essay', dueDate: '2026-08-30', points: '20', courseId: '100', assignmentId: '999',
      firstSeen: '2026-08-31', lastSeen: '2026-09-05' }
  ];
  var out = reconcile(current, imp, '2026-09-09');
  assertEq([out.added, out.removed, out.unchanged], [2, 1, 1], 'counts');
  var byKey = {}; out.rows.forEach(function (r) { byKey[rowKey(r)] = r; });
  assertEq(byKey['1|1001'].firstSeen, '2026-09-01', 'survivor keeps first seen');
  assertEq(byKey['1|1001'].lastSeen, '2026-09-09', 'survivor updates last seen');
  assertEq(byKey['1|1003'].firstSeen, '2026-09-09', 'new row first seen today');
  assertEq(byKey['1|999'], undefined, 'absent row removed');
  assertEq(out.newStudents, [{ studentId: '2', student: 'Bo Sample' }], 'new student reported once');
}

function test_reconcile_survivor_takes_fresh_display_fields() {
  var imp = parseImportRows(csvFixture_()).rows;
  imp[0].assignment = 'Homework 5 (renamed)';
  var current = [{ studentId: '1', student: 'Ada Test', email: '', grade: '9', course: 'Algebra I',
    assignment: 'Homework 5', dueDate: '2026-09-04', points: '10', courseId: '100', assignmentId: '1001',
    firstSeen: '2026-09-01', lastSeen: '2026-09-05' }];
  var out = reconcile(current, imp, '2026-09-09');
  var row = out.rows.filter(function (r) { return rowKey(r) === '1|1001'; })[0];
  assertEq(row.assignment, 'Homework 5 (renamed)', 'display fields refreshed');
  assertEq(row.email, 'atest30@episcopalhighschool.org', 'email refreshed');
}

function test_reconcile_newStudents_excludes_known() {
  var imp = parseImportRows(csvFixture_()).rows;
  var out = reconcile([], imp, '2026-09-09');
  assertEq(out.newStudents, [{ studentId: '1', student: 'Ada Test' }, { studentId: '2', student: 'Bo Sample' }], 'both new on empty sheet');
}

function test_sortCurrentRows() {
  var rows = [
    { student: 'Bo Sample', dueDate: '2026-09-02', assignment: 'b' },
    { student: 'Ada Test', dueDate: '', assignment: 'z' },
    { student: 'Ada Test', dueDate: '2026-09-04', assignment: 'a' },
    { student: 'Ada Test', dueDate: '2026-09-01', assignment: 'c' }
  ];
  var s = sortCurrentRows(rows).map(function (r) { return r.student + '/' + r.assignment; });
  assertEq(s, ['Ada Test/c', 'Ada Test/a', 'Ada Test/z', 'Bo Sample/b'], 'student, then due, blanks last');
}

function test_currentRow_array_roundtrip() {
  var r = { studentId: '1', student: 'Ada Test', email: 'e', grade: '9', course: 'c', assignment: 'a',
    dueDate: '2026-09-04', points: '10', courseId: '100', assignmentId: '1001', firstSeen: '2026-09-01', lastSeen: '2026-09-09' };
  var arr = currentRowToArray(r);
  assertEq(arr.length, CURRENT_HEADERS.length, 'one cell per header');
  assertEq(arr[0], '1', 'student id first');
  assertEq(arrayToCurrentRow(arr), r, 'roundtrip');
  assertEq(arrayToCurrentRow([1, 'Ada Test', 'e', 9, 'c', 'a', '2026-09-04', 10, '2026-09-01', '2026-09-09', 100, 1001]).studentId, '1', 'numbers become strings');
}
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `./test-local.sh` (from `apps-script/`)
Expected: date tests PASS; reconcile tests FAIL with "not defined"; exit 1.

- [ ] **Step 3: Write Reconcile.gs**

```javascript
// Reconcile.gs — pure: CSV rows -> import rows -> diff against Current.

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

// csvRows: string[][] from Utilities.parseCsv (first row = headers).
function parseImportRows(csvRows) {
  var out = { rows: [], skipped: 0, missingHeaders: [] };
  if (!csvRows || !csvRows.length) { out.missingHeaders = CSV_HEADERS.slice(); return out; }
  var idx = {};
  csvRows[0].forEach(function (h, i) { idx[str_(h)] = i; });
  CSV_HEADERS.forEach(function (h) { if (!(h in idx)) out.missingHeaders.push(h); });
  if (out.missingHeaders.length) return out;
  var get = function (r, h) { return str_(r[idx[h]]); };
  for (var i = 1; i < csvRows.length; i++) {
    var r = csvRows[i];
    if (!r || r.join('').trim() === '') continue;
    var sid = get(r, 'Student ID'), aid = get(r, 'Assignment ID');
    if (!sid || !aid) { out.skipped++; continue; }
    out.rows.push({
      studentId: sid,
      student: get(r, 'Student'),
      email: get(r, 'Student email'),
      grade: get(r, 'Grade level'),
      course: get(r, 'Course'),
      assignment: get(r, 'Assignment'),
      dueDate: parseDueDate(get(r, 'Due date')),
      points: get(r, 'Points possible'),
      courseId: get(r, 'Course ID'),
      assignmentId: aid
    });
  }
  return out;
}

function rowKey(r) { return r.studentId + '|' + r.assignmentId; }

// Returns new Current rows plus counts. Display fields come from the import;
// firstSeen survives from the existing row when present.
function reconcile(currentRows, importRows, todayIso) {
  var existing = {};
  currentRows.forEach(function (r) { existing[rowKey(r)] = r; });
  var knownStudents = {};
  currentRows.forEach(function (r) { knownStudents[r.studentId] = true; });

  var rows = [], added = 0, unchanged = 0, seen = {}, newStudents = [], newSeen = {};
  importRows.forEach(function (imp) {
    var k = rowKey(imp);
    if (seen[k]) return;   // duplicate line in the file
    seen[k] = true;
    var prev = existing[k];
    var row = {};
    for (var f in imp) row[f] = imp[f];
    row.firstSeen = prev ? prev.firstSeen : todayIso;
    row.lastSeen = todayIso;
    rows.push(row);
    if (prev) unchanged++; else added++;
    if (!knownStudents[imp.studentId] && !newSeen[imp.studentId]) {
      newSeen[imp.studentId] = true;
      newStudents.push({ studentId: imp.studentId, student: imp.student });
    }
  });
  var removed = 0;
  currentRows.forEach(function (r) { if (!seen[rowKey(r)]) removed++; });
  return { rows: sortCurrentRows(rows), added: added, removed: removed, unchanged: unchanged, newStudents: newStudents };
}

function sortCurrentRows(rows) {
  return rows.slice().sort(function (a, b) {
    if (a.student !== b.student) return a.student < b.student ? -1 : 1;
    var ad = a.dueDate || '9999-99-99', bd = b.dueDate || '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    if (a.assignment !== b.assignment) return a.assignment < b.assignment ? -1 : 1;
    return 0;
  });
}

var CURRENT_FIELDS_ = ['studentId', 'student', 'email', 'grade', 'course', 'assignment',
  'dueDate', 'points', 'firstSeen', 'lastSeen', 'courseId', 'assignmentId'];

function currentRowToArray(r) {
  return CURRENT_FIELDS_.map(function (f) { return str_(r[f]); });
}

function arrayToCurrentRow(arr) {
  var r = {};
  CURRENT_FIELDS_.forEach(function (f, i) { r[f] = str_(arr[i]); });
  return r;
}
```

- [ ] **Step 4: Run tests**

Run: `./test-local.sh`
Expected: `0 failed`, exit 0.

---

### Task 4: Pure digest builders and roster-gap finder

**Files:**
- Create: `apps-script/Digest.gs`
- Modify: `apps-script/Tests.gs` (append tests)

**Interfaces:**
- Consumes: `formatShort`, `daysBetween` (Task 2); `CurrentRow` shape (Task 3).
- Produces:
  - `groupBy(arr, fn) -> {key: items[]}` (helper).
  - `renderItems(items, todayIso) -> string` — one line per item: `  - Assignment — due Sep 4 — 5 days missing`, grouped under `Course:` headings.
  - `buildStudentDigest(items: CurrentRow[], cfg, todayIso) -> {to, subject, body}`.
  - `buildAdvisorDigests(currentRows, roster: RosterRow[], cfg, todayIso) -> [{to, advisorName, subject, body}]` where `RosterRow = {studentId, student, advisorName, advisorEmail}`.
  - `findRosterGaps(currentRows, roster) -> [{studentId, student, reason}]` with reason `'not in Roster'` or `'no advisor email'`.
  - `fillTemplate(s, todayIso) -> string` replacing `{date}` with e.g. `Sep 9, 2026`.

- [ ] **Step 1: Append failing tests**

```javascript
// --- Digest ----------------------------------------------------------------

function currentFixture_() {
  var base = { grade: '9', points: '10', lastSeen: '2026-09-09' };
  function row(o) { var r = {}; for (var k in base) r[k] = base[k]; for (var k2 in o) r[k2] = o[k2]; return r; }
  return [
    row({ studentId: '1', student: 'Ada Test', email: 'atest30@x.org', course: 'Algebra I', assignment: 'Homework 5', dueDate: '2026-09-04', courseId: '100', assignmentId: '1001', firstSeen: '2026-09-04' }),
    row({ studentId: '1', student: 'Ada Test', email: 'atest30@x.org', course: 'Algebra I', assignment: 'Lab Notebook', dueDate: '', courseId: '100', assignmentId: '1003', firstSeen: '2026-09-09' }),
    row({ studentId: '1', student: 'Ada Test', email: 'atest30@x.org', course: 'Biology', assignment: 'Quiz 1', dueDate: '2026-09-01', courseId: '102', assignmentId: '1010', firstSeen: '2026-09-02' }),
    row({ studentId: '2', student: 'Bo Sample', email: 'bsample30@x.org', course: 'Biology', assignment: 'Quiz 3', dueDate: '2026-09-02', courseId: '102', assignmentId: '1002', firstSeen: '2026-09-03' }),
    row({ studentId: '3', student: 'Cy Fixture', email: 'cfixture30@x.org', course: 'Civics', assignment: 'HW 1', dueDate: '2026-09-08', courseId: '103', assignmentId: '1020', firstSeen: '2026-09-09' })
  ];
}

function rosterFixture_() {
  return [
    { studentId: '1', student: 'Ada Test', advisorName: 'Ms. Adviser', advisorEmail: 'adviser@x.org' },
    { studentId: '2', student: 'Bo Sample', advisorName: 'Ms. Adviser', advisorEmail: 'adviser@x.org' },
    { studentId: '3', student: 'Cy Fixture', advisorName: 'Mr. Blank', advisorEmail: '' }
  ];
}

function cfgFixture_() {
  var cfg = {}; CONFIG_DEFAULTS.forEach(function (kv) { cfg[kv[0]] = kv[1]; });
  cfg.dry_run = false; cfg.delete_guard_fraction = 0.5;
  return cfg;
}

function test_fillTemplate() {
  assertEq(fillTemplate('Missing work as of {date}', '2026-09-09'), 'Missing work as of Sep 9, 2026', 'date filled');
}

function test_renderItems_groups_by_course() {
  var items = currentFixture_().filter(function (r) { return r.studentId === '1'; });
  var text = renderItems(items, '2026-09-09');
  assertEq(text, [
    'Algebra I:',
    '  - Homework 5 — due Sep 4 — missing 5 days',
    '  - Lab Notebook — no due date — new this week',
    'Biology:',
    '  - Quiz 1 — due Sep 1 — missing 7 days'
  ].join('\n'), 'grouped text');
}

function test_buildStudentDigest() {
  var items = currentFixture_().filter(function (r) { return r.studentId === '1'; });
  var d = buildStudentDigest(items, cfgFixture_(), '2026-09-09');
  assertEq(d.to, 'atest30@x.org', 'to student email');
  assertEq(d.subject, 'Missing work as of Sep 9, 2026', 'subject');
  assertEq(d.body.indexOf('Hi Ada Test,') === 0, true, 'greets by name');
  assertEq(d.body.indexOf(CONFIG_DEFAULTS[3][1]) > 0, true, 'intro included');
  assertEq(d.body.indexOf('Algebra I:') > 0, true, 'items included');
  assertEq(d.body.indexOf('3 missing assignments') > 0, true, 'count line');
}

function test_buildAdvisorDigests() {
  var ds = buildAdvisorDigests(currentFixture_(), rosterFixture_(), cfgFixture_(), '2026-09-09');
  assertEq(ds.length, 1, 'only advisors with email');
  assertEq(ds[0].to, 'adviser@x.org', 'advisor email');
  assertEq(ds[0].subject, "Advisees' missing work as of Sep 9, 2026", 'subject');
  assertEq(ds[0].body.indexOf('Ada Test (3 missing)') > 0, true, 'advisee header with count');
  assertEq(ds[0].body.indexOf('Bo Sample (1 missing)') > 0, true, 'second advisee');
  assertEq(ds[0].body.indexOf('Ada Test') < ds[0].body.indexOf('Bo Sample'), true, 'advisees alphabetical');
}

function test_buildAdvisorDigests_skips_advisors_with_no_current_items() {
  var roster = rosterFixture_().concat([{ studentId: '9', student: 'Nobody Here', advisorName: 'Dr. Quiet', advisorEmail: 'quiet@x.org' }]);
  var ds = buildAdvisorDigests(currentFixture_(), roster, cfgFixture_(), '2026-09-09');
  assertEq(ds.map(function (d) { return d.to; }), ['adviser@x.org'], 'quiet advisor gets nothing');
}

function test_findRosterGaps() {
  var current = currentFixture_().concat([{ studentId: '4', student: 'Di Orphan', email: 'd@x.org', course: 'Art', assignment: 'Sketch', dueDate: '', firstSeen: '2026-09-09', lastSeen: '2026-09-09', courseId: '104', assignmentId: '1030', grade: '9', points: '1' }]);
  var gaps = findRosterGaps(current, rosterFixture_());
  assertEq(gaps, [
    { studentId: '3', student: 'Cy Fixture', reason: 'no advisor email' },
    { studentId: '4', student: 'Di Orphan', reason: 'not in Roster' }
  ], 'gaps found once per student, sorted by name');
}
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `./test-local.sh`
Expected: digest tests FAIL with "not defined"; exit 1.

- [ ] **Step 3: Write Digest.gs**

```javascript
// Digest.gs — pure: build email text from Current + Roster.

function groupBy(arr, fn) {
  var out = {};
  arr.forEach(function (x) { var k = fn(x); (out[k] = out[k] || []).push(x); });
  return out;
}

function longDate_(iso) {
  var p = iso.split('-');
  return MONTHS_[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
}

function fillTemplate(s, todayIso) {
  return String(s || '').replace(/\{date\}/g, longDate_(todayIso));
}

function ageLabel_(item, todayIso) {
  var d = daysBetween(item.firstSeen, todayIso);
  if (d <= 0) return 'new this week';
  return 'missing ' + d + ' day' + (d === 1 ? '' : 's');
}

function itemLine_(item, todayIso) {
  var due = item.dueDate ? 'due ' + formatShort(item.dueDate) : 'no due date';
  return '  - ' + item.assignment + ' — ' + due + ' — ' + ageLabel_(item, todayIso);
}

// Items for ONE student, grouped by course (courses alphabetical, items as given).
function renderItems(items, todayIso) {
  var byCourse = groupBy(items, function (i) { return i.course; });
  var courses = Object.keys(byCourse).sort();
  var lines = [];
  courses.forEach(function (c) {
    lines.push(c + ':');
    byCourse[c].forEach(function (i) { lines.push(itemLine_(i, todayIso)); });
  });
  return lines.join('\n');
}

function plural_(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

function buildStudentDigest(items, cfg, todayIso) {
  var s = items[0];
  var body = [
    'Hi ' + s.student + ',',
    '',
    fillTemplate(cfg.student_intro, todayIso),
    '',
    'You have ' + plural_(items.length, 'missing assignment') + ':',
    '',
    renderItems(items, todayIso),
    ''
  ].join('\n');
  return { to: s.email, subject: fillTemplate(cfg.student_subject, todayIso), body: body };
}

function buildAdvisorDigests(currentRows, roster, cfg, todayIso) {
  var byStudent = groupBy(currentRows, function (r) { return r.studentId; });
  var byAdvisor = {};
  roster.forEach(function (rr) {
    if (!rr.advisorEmail || !byStudent[rr.studentId]) return;
    var key = rr.advisorEmail.toLowerCase();
    byAdvisor[key] = byAdvisor[key] || { to: rr.advisorEmail, advisorName: rr.advisorName, advisees: [] };
    byAdvisor[key].advisees.push({ student: rr.student || byStudent[rr.studentId][0].student, items: byStudent[rr.studentId] });
  });
  return Object.keys(byAdvisor).sort().map(function (k) {
    var a = byAdvisor[k];
    a.advisees.sort(function (x, y) { return x.student < y.student ? -1 : x.student > y.student ? 1 : 0; });
    var sections = a.advisees.map(function (adv) {
      return adv.student + ' (' + adv.items.length + ' missing)\n' + renderItems(adv.items, todayIso);
    });
    var body = [
      'Hi ' + (a.advisorName || 'there') + ',',
      '',
      fillTemplate(cfg.advisor_intro, todayIso),
      '',
      sections.join('\n\n'),
      ''
    ].join('\n');
    return { to: a.to, advisorName: a.advisorName, subject: fillTemplate(cfg.advisor_subject, todayIso), body: body };
  });
}

function findRosterGaps(currentRows, roster) {
  var rosterById = {};
  roster.forEach(function (r) { rosterById[r.studentId] = r; });
  var seen = {}, gaps = [];
  currentRows.forEach(function (r) {
    if (seen[r.studentId]) return;
    seen[r.studentId] = true;
    var rr = rosterById[r.studentId];
    if (!rr) gaps.push({ studentId: r.studentId, student: r.student, reason: 'not in Roster' });
    else if (!rr.advisorEmail) gaps.push({ studentId: r.studentId, student: r.student, reason: 'no advisor email' });
  });
  return gaps.sort(function (a, b) { return a.student < b.student ? -1 : a.student > b.student ? 1 : 0; });
}
```

- [ ] **Step 4: Run tests**

Run: `./test-local.sh`
Expected: `0 failed`, exit 0.

---

### Task 5: Sheet setup, logging, and menu

**Files:**
- Create: `apps-script/Setup.gs`
- Create: `apps-script/Log.gs`

**Interfaces:**
- Consumes: `TAB`, `*_HEADERS`, `CONFIG_DEFAULTS` (Task 2).
- Produces: `onOpen()`, `setupSheet()`, `getOrCreateSheet_(name, headers) -> Sheet`, `logEvent(kind, counts, notes)` where `counts = {added, removed, unchanged, emailsSent}` (any may be omitted), `highlightRosterGaps_()`.
- Note: not unit-tested (touches SpreadsheetApp). Verified manually in Task 8.

- [ ] **Step 1: Write Log.gs**

```javascript
// Log.gs — one line per import or send run.

function logEvent(kind, counts, notes) {
  counts = counts || {};
  var sheet = getOrCreateSheet_(TAB.LOG, LOG_HEADERS);
  var user = '';
  try { user = Session.getActiveUser().getEmail(); } catch (e) { user = ''; }
  sheet.appendRow([
    new Date(), user, kind,
    counts.added === undefined ? '' : counts.added,
    counts.removed === undefined ? '' : counts.removed,
    counts.unchanged === undefined ? '' : counts.unchanged,
    counts.emailsSent === undefined ? '' : counts.emailsSent,
    notes || ''
  ]);
}
```

- [ ] **Step 2: Write Setup.gs**

```javascript
// Setup.gs — menu and one-time sheet scaffolding. Safe to re-run.

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Missing Work')
    .addItem('Import CSV…', 'showImportDialog')
    .addSeparator()
    .addItem('Send digests now', 'sendWeeklyDigests')
    .addItem('Install Tuesday 7am trigger', 'installWeeklyTrigger')
    .addSeparator()
    .addItem('Set up sheet', 'setupSheet')
    .addToUi();
}

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var hasHeaders = headers.every(function (h, i) { return String(firstRow[i]).trim() === h; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  return sheet;
}

function setupSheet() {
  var ss = SpreadsheetApp.getActive();
  var current = getOrCreateSheet_(TAB.CURRENT, CURRENT_HEADERS);
  var roster = getOrCreateSheet_(TAB.ROSTER, ROSTER_HEADERS);
  var config = getOrCreateSheet_(TAB.CONFIG, ['Key', 'Value']);
  getOrCreateSheet_(TAB.LOG, LOG_HEADERS);

  // Config defaults: add any missing key, never overwrite existing values.
  var existing = {};
  var vals = config.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) existing[String(vals[i][0]).trim()] = true;
  var me = '';
  try { me = Session.getActiveUser().getEmail(); } catch (e) { me = ''; }
  CONFIG_DEFAULTS.forEach(function (kv) {
    if (existing[kv[0]]) return;
    var v = kv[0] === 'dry_run_recipient' ? me : kv[1];
    config.appendRow([kv[0], v]);
  });
  config.setColumnWidth(2, 520);

  // Date columns display as dates; ID columns as plain text.
  current.getRange('G:G').setNumberFormat('mmm d, yyyy');
  current.getRange('I:J').setNumberFormat('yyyy-mm-dd');
  current.getRange('A:A').setNumberFormat('@');
  current.getRange('K:L').setNumberFormat('@');
  roster.getRange('A:A').setNumberFormat('@');
  current.setColumnWidth(5, 260);
  current.setColumnWidth(6, 320);

  // Remove the default "Sheet1" if it is empty and we created our own tabs.
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  highlightRosterGaps_();
  SpreadsheetApp.getUi().alert('Sheet is set up. Fill the Roster tab (Student ID, Advisor name, Advisor email), then use Missing Work → Import CSV.');
}

// Light-yellow rows in Current whose Student ID is absent from Roster.
function highlightRosterGaps_() {
  var ss = SpreadsheetApp.getActive();
  var current = ss.getSheetByName(TAB.CURRENT);
  if (!current) return;
  var n = current.getMaxRows();
  var range = current.getRange(2, 1, Math.max(n - 1, 1), CURRENT_HEADERS.length);
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($A2<>"", ISNA(MATCH($A2, INDIRECT("' + TAB.ROSTER + '!A:A"), 0)))')
    .setBackground('#fff3cd')
    .setRanges([range])
    .build();
  current.setConditionalFormatRules([rule]);
}
```

- [ ] **Step 3: Syntax-check under Node**

Run: `cd apps-script && node --check Setup.gs && node --check Log.gs && echo OK`
Expected: `OK` (Node parses `.gs` as JS when passed explicitly; if it refuses the extension, run `cp Setup.gs /tmp/s.js && node --check /tmp/s.js`).

---

### Task 6: Import dialog and sheet-side import

**Files:**
- Create: `apps-script/ImportDialog.html`
- Create: `apps-script/Import.gs`

**Interfaces:**
- Consumes: `parseImportRows`, `reconcile`, `currentRowToArray`, `arrayToCurrentRow` (Task 3); `toIso`, `fromIso`, `todayIso` (Task 2); `getOrCreateSheet_`, `highlightRosterGaps_`, `logEvent` (Task 5); `readConfig` (Task 2).
- Produces: `showImportDialog()`, `importCsvText(text, fileName) -> {ok, message, needsConfirm?, counts?}`, `confirmImport_(payloadJson)`, `readCurrentRows_() -> CurrentRow[]`, `writeCurrentRows_(rows)`, `readRoster_() -> RosterRow[]`, `appendRosterStudents_(newStudents)`.
- Two-phase import: the client calls `importCsvText`; if the server returns `needsConfirm` with a cached token, the client shows the counts and calls `confirmImport_` to proceed. The parsed rows are stashed in `CacheService` for 10 minutes.

- [ ] **Step 1: Write ImportDialog.html**

```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <style>
      body { font: 14px system-ui, sans-serif; margin: 16px; }
      #status { margin-top: 12px; white-space: pre-wrap; }
      .warn { color: #8a6d00; }
      .err { color: #b00020; }
      button { margin-top: 10px; }
    </style>
  </head>
  <body>
    <p>Choose the <b>missing_assignments_*.csv</b> file downloaded from the dashboard.</p>
    <input type="file" id="file" accept=".csv,text/csv">
    <div><button id="go" disabled>Import</button></div>
    <div id="status"></div>
    <script>
      var fileInput = document.getElementById('file');
      var go = document.getElementById('go');
      var status = document.getElementById('status');
      fileInput.onchange = function () { go.disabled = !fileInput.files.length; };

      function show(msg, cls) { status.className = cls || ''; status.textContent = msg; }

      go.onclick = function () {
        var f = fileInput.files[0];
        if (!f) return;
        go.disabled = true;
        show('Reading ' + f.name + '…');
        var reader = new FileReader();
        reader.onload = function () {
          google.script.run
            .withSuccessHandler(handleResult)
            .withFailureHandler(function (e) { show('Error: ' + e.message, 'err'); go.disabled = false; })
            .importCsvText(reader.result, f.name);
        };
        reader.readAsText(f);
      };

      function handleResult(res) {
        if (!res.ok) { show(res.message, 'err'); go.disabled = false; return; }
        if (res.needsConfirm) {
          show(res.message, 'warn');
          if (confirm(res.message + '\n\nContinue?')) {
            google.script.run
              .withSuccessHandler(handleResult)
              .withFailureHandler(function (e) { show('Error: ' + e.message, 'err'); })
              .confirmImport_(res.token);
          } else {
            show('Import cancelled. Nothing was changed.');
            go.disabled = false;
          }
          return;
        }
        show(res.message);
        setTimeout(function () { google.script.host.close(); }, 2500);
      }
    </script>
  </body>
</html>
```

Note: the `confirm()` here runs inside the dialog iframe, not the sheet, so it does not block Apps Script.

- [ ] **Step 2: Write Import.gs**

```javascript
// Import.gs — sheet wrapper around Reconcile.gs.

function showImportDialog() {
  var html = HtmlService.createHtmlOutputFromFile('ImportDialog').setWidth(420).setHeight(240);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import missing-assignments CSV');
}

function readCurrentRows_() {
  var sheet = getOrCreateSheet_(TAB.CURRENT, CURRENT_HEADERS);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, CURRENT_HEADERS.length).getValues();
  return values
    .filter(function (v) { return String(v[0]).trim() !== ''; })
    .map(function (v) {
      var r = arrayToCurrentRow(v);
      r.dueDate = toIso(v[6]);
      r.firstSeen = toIso(v[8]);
      r.lastSeen = toIso(v[9]);
      return r;
    });
}

function writeCurrentRows_(rows) {
  var sheet = getOrCreateSheet_(TAB.CURRENT, CURRENT_HEADERS);
  var last = sheet.getLastRow();
  if (last >= 2) sheet.getRange(2, 1, last - 1, CURRENT_HEADERS.length).clearContent();
  if (!rows.length) return;
  var values = rows.map(function (r) {
    var a = currentRowToArray(r);
    a[6] = fromIso(r.dueDate);
    a[8] = fromIso(r.firstSeen);
    a[9] = fromIso(r.lastSeen);
    return a;
  });
  sheet.getRange(2, 1, values.length, CURRENT_HEADERS.length).setValues(values);
}

function readRoster_() {
  var sheet = getOrCreateSheet_(TAB.ROSTER, ROSTER_HEADERS);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, ROSTER_HEADERS.length).getValues()
    .filter(function (v) { return String(v[0]).trim() !== ''; })
    .map(function (v) {
      return { studentId: String(v[0]).trim(), student: String(v[1]).trim(),
               advisorName: String(v[2]).trim(), advisorEmail: String(v[3]).trim() };
    });
}

// Adds Student ID + name rows for students not yet in Roster; advisor cells blank.
function appendRosterStudents_(newStudents) {
  if (!newStudents.length) return 0;
  var known = {};
  readRoster_().forEach(function (r) { known[r.studentId] = true; });
  var rows = newStudents
    .filter(function (s) { return !known[s.studentId]; })
    .map(function (s) { return [s.studentId, s.student, '', '']; });
  if (!rows.length) return 0;
  var sheet = getOrCreateSheet_(TAB.ROSTER, ROSTER_HEADERS);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ROSTER_HEADERS.length).setValues(rows);
  return rows.length;
}

// Called from the dialog. Returns {ok, message, needsConfirm?, token?}.
function importCsvText(text, fileName) {
  var csvRows;
  try { csvRows = Utilities.parseCsv(text); } catch (e) { return { ok: false, message: 'Could not parse CSV: ' + e.message }; }
  var parsed = parseImportRows(csvRows);
  if (parsed.missingHeaders.length) {
    return { ok: false, message: 'This does not look like the dashboard export. Missing columns: ' + parsed.missingHeaders.join(', ') + '. Nothing was changed.' };
  }
  var current = readCurrentRows_();
  var result = reconcile(current, parsed.rows, todayIso());
  var cfg = readConfig();
  if (current.length && result.removed / current.length > cfg.delete_guard_fraction) {
    var token = Utilities.getUuid();
    CacheService.getUserCache().put('import:' + token, JSON.stringify({ rows: parsed.rows, fileName: fileName, skipped: parsed.skipped }), 600);
    return {
      ok: true, needsConfirm: true, token: token,
      message: 'This file would remove ' + result.removed + ' of ' + current.length + ' current rows (and add ' + result.added + '). That is a lot. Is this a complete export?'
    };
  }
  return applyImport_(parsed.rows, parsed.skipped, fileName);
}

function confirmImport_(token) {
  var raw = CacheService.getUserCache().get('import:' + token);
  if (!raw) return { ok: false, message: 'Confirmation expired. Please import the file again.' };
  var stash = JSON.parse(raw);
  CacheService.getUserCache().remove('import:' + token);
  return applyImport_(stash.rows, stash.skipped, stash.fileName);
}

function applyImport_(importRows, skipped, fileName) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, message: 'Another import is running. Try again in a minute.' };
  try {
    var current = readCurrentRows_();
    var result = reconcile(current, importRows, todayIso());
    writeCurrentRows_(result.rows);
    var rosterAdded = appendRosterStudents_(result.newStudents);
    highlightRosterGaps_();
    var notes = fileName + (skipped ? '; skipped ' + skipped + ' rows with blank IDs' : '') + (rosterAdded ? '; added ' + rosterAdded + ' students to Roster' : '');
    logEvent('import', { added: result.added, removed: result.removed, unchanged: result.unchanged }, notes);
    return {
      ok: true,
      message: 'Imported. Added ' + result.added + ', removed ' + result.removed + ', unchanged ' + result.unchanged + '.' +
        (rosterAdded ? '\n' + rosterAdded + ' new student(s) added to Roster — fill in their advisor.' : '') +
        (skipped ? '\nSkipped ' + skipped + ' row(s) with blank IDs.' : '')
    };
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 3: Syntax-check**

Run: `cd apps-script && cp Import.gs /tmp/i.js && node --check /tmp/i.js && echo OK`
Expected: `OK`.

---

### Task 7: Sending digests and the weekly trigger

**Files:**
- Create: `apps-script/Email.gs`

**Interfaces:**
- Consumes: `readCurrentRows_`, `readRoster_` (Task 6); `readConfig`, `todayIso` (Task 2); `buildStudentDigest`, `buildAdvisorDigests`, `findRosterGaps`, `groupBy` (Task 4); `logEvent` (Task 5).
- Produces: `sendWeeklyDigests()`, `installWeeklyTrigger()`, `sendOne_(cfg, msg, kind) -> boolean`.

- [ ] **Step 1: Write Email.gs**

```javascript
// Email.gs — Tuesday digests. Pure text comes from Digest.gs.

function sendOne_(cfg, msg, kind, errors) {
  var to = msg.to;
  var subject = msg.subject;
  if (cfg.dry_run) {
    to = cfg.dry_run_recipient;
    subject = '[DRY RUN → ' + msg.to + '] ' + subject;
  }
  if (!to) { errors.push(kind + ': no recipient for ' + (msg.to || '(blank)')); return false; }
  var opts = {};
  if (cfg.cc && !cfg.dry_run) opts.cc = cfg.cc;
  if (cfg.reply_to) opts.replyTo = cfg.reply_to;
  try {
    GmailApp.sendEmail(to, subject, msg.body, opts);
    return true;
  } catch (e) {
    errors.push(kind + ' to ' + to + ': ' + e.message);
    return false;
  }
}

function sendWeeklyDigests() {
  var cfg = readConfig();
  var today = todayIso();
  var current = readCurrentRows_();
  var roster = readRoster_();
  var rosterById = {};
  roster.forEach(function (r) { rosterById[r.studentId] = r; });

  var errors = [], sent = 0;

  // Students: one email each, only if they are in the Roster.
  var byStudent = groupBy(current, function (r) { return r.studentId; });
  Object.keys(byStudent).forEach(function (sid) {
    if (!rosterById[sid]) return;
    var msg = buildStudentDigest(byStudent[sid], cfg, today);
    if (sendOne_(cfg, msg, 'student', errors)) sent++;
  });

  // Advisors.
  buildAdvisorDigests(current, roster, cfg, today).forEach(function (msg) {
    if (sendOne_(cfg, msg, 'advisor', errors)) sent++;
  });

  // Roster gaps: one note to the maintainer.
  var gaps = findRosterGaps(current, roster);
  if (gaps.length && cfg.dry_run_recipient) {
    var lines = gaps.map(function (g) { return '  - ' + g.student + ' (ID ' + g.studentId + '): ' + g.reason; });
    var body = 'These students have missing work but could not be emailed or reported to an advisor.\n' +
      'Fix the Roster tab and they will be included next week.\n\n' + lines.join('\n') + '\n';
    if (sendOne_(cfg, { to: cfg.dry_run_recipient, subject: 'Roster gaps — missing work sheet', body: body }, 'gaps', errors)) sent++;
  }

  var notes = (cfg.dry_run ? 'DRY RUN. ' : '') + (gaps.length ? gaps.length + ' roster gap(s). ' : '') + (errors.length ? 'Errors: ' + errors.join(' | ') : '');
  logEvent('send', { emailsSent: sent }, notes.trim());

  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }   // no UI when run from a trigger
  if (ui) ui.alert('Sent ' + sent + ' email(s)' + (cfg.dry_run ? ' (dry run, all to ' + cfg.dry_run_recipient + ')' : '') + '.' + (errors.length ? '\n\nErrors:\n' + errors.join('\n') : ''));
}

// Idempotent: removes any existing trigger for sendWeeklyDigests, then installs Tuesday 07:00.
function installWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklyDigests') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWeeklyDigests')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.TUESDAY)
    .atHour(7)
    .create();
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  if (ui) ui.alert('Tuesday 7am trigger installed. Emails send from ' + Session.getEffectiveUser().getEmail() + '. Check Config → dry_run before the first Tuesday.');
}
```

- [ ] **Step 2: Syntax-check**

Run: `cd apps-script && cp Email.gs /tmp/e.js && node --check /tmp/e.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Run the full local test suite once more**

Run: `./test-local.sh`
Expected: `0 failed`.

---

### Task 8: Fixture CSV, setup guide, and manual end-to-end check

**Files:**
- Create: `apps-script/fixtures/missing_assignments_sample.csv`
- Create: `apps-script/SETUP.md`

- [ ] **Step 1: Write the fixture (fake names, new export format)**

```csv
Student,Grade level,Course,Assignment,Due date,Points possible,Student ID,Student email,Course ID,Assignment ID
Ada Test,9,Algebra I,Homework 5,"Sep 4, 2026",10,1,atest30@episcopalhighschool.org,100,1001
Ada Test,9,Algebra I,Lab Notebook,,5,1,atest30@episcopalhighschool.org,100,1003
Ada Test,9,Biology,Quiz 1,"Sep 1, 2026",20,1,atest30@episcopalhighschool.org,102,1010
Bo Sample,9,Biology,Quiz 3,"Sep 2, 2026",,2,bsample30@episcopalhighschool.org,102,1002
Cy Fixture,9,21st Century Civics,HW 1.5,"Sep 8, 2026",2,3,cfixture30@episcopalhighschool.org,103,1020
```

- [ ] **Step 2: Write SETUP.md**

Contents (write in full; this is the colleague's guide):

```markdown
# Missing Work Sheet — setup

Time: about 20 minutes, once.

## 1. Create the sheet
1. In Google Drive, create a new blank Google Sheet. Name it "Missing Work — Grade 9".
2. Menu: Extensions → Apps Script. A code editor opens in a new tab.

## 2. Paste the script
1. In the editor, delete the contents of the default `Code.gs`.
2. For each file in the `apps-script/` folder that ends in `.gs`, click the **+** next to
   "Files", choose **Script**, name it exactly as the file (without `.gs`), and paste the contents.
   Files: Config, Dates, Reconcile, Digest, Setup, Log, Import, Email, Tests.
3. Click **+** → **HTML**, name it `ImportDialog`, paste the contents of `ImportDialog.html`.
4. Click the save icon. Close the editor tab and reload the spreadsheet.

## 3. Set up the tabs
1. A **Missing Work** menu now appears. Choose **Set up sheet**.
2. Google asks you to authorize the script. Choose your school account, click through
   "Advanced → Go to (project name)" if it warns the app is unverified, and allow access to
   Sheets and Gmail. This is your own script running as you.
3. Tabs Current, Roster, Config, Log now exist.

## 4. Test with fake data
1. **Missing Work → Import CSV…**, choose `apps-script/fixtures/missing_assignments_sample.csv`.
2. Current shows 5 rows. Roster has 3 new rows with blank advisor cells.
3. In Roster, type any advisor name and *your own* email for the three fake students.
4. Confirm Config → `dry_run` is `TRUE` and `dry_run_recipient` is your email.
5. **Missing Work → Send digests now**. You receive 3 student emails and 1 advisor email,
   each subject prefixed `[DRY RUN → …]`. Adjust wording in Config and resend until happy.

## 5. Go live
1. Import the real export from the dashboard. Answer "Continue" if it warns about removing
   the fake rows.
2. Delete the three fake rows from Roster. Fill Advisor name and Advisor email for every real
   student (Student ID and name are already there).
3. **Missing Work → Install Tuesday 7am trigger**.
4. Set Config → `dry_run` to `FALSE`.
5. Share the sheet with anyone who should see it (Viewer is enough).

## Weekly routine
- Whenever you want the list refreshed: dashboard → Download missing assignments (CSV) →
  **Missing Work → Import CSV…**. Anything not in the new file disappears from Current.
- Tuesday 7am: digests go out automatically to every student in Current who has a Roster row,
  and to every advisor with at least one advisee listed. You get a "Roster gaps" email if any
  student could not be matched.
- The Log tab shows every import and send with counts.

## Things to know
- The import must be a complete export (all students, all courses). If a file would remove
  more than half the current rows, the import asks you to confirm first.
- Rows are matched by Canvas IDs, so renaming a student or assignment in Canvas does not
  create duplicates.
- Emails send from your account. Replies come to you. Set Config → `reply_to` to change that,
  and `cc` to copy someone on every live email.
- To pause emails, set `dry_run` back to `TRUE`; the trigger keeps running but everything
  goes to you.
```

- [ ] **Step 3: Manual end-to-end check (the user or colleague performs; record results in the plan)**

Follow SETUP.md sections 1–4 in a scratch Google Sheet with the fixture. Expected:
- 5 rows in Current sorted Ada Test (Sep 1, Sep 4, blank), Bo Sample, Cy Fixture.
- Roster gets 3 pre-filled rows; those rows in Current are yellow until advisor email is filled.
- Import the fixture a second time: Log shows added 0, removed 0, unchanged 5; First seen unchanged.
- Delete the last fixture line, import again: removed 1.
- Send digests (dry run): 3 student + 1 advisor emails arrive at the maintainer address.

Record the outcome under this step in the plan file.

---

## Self-review notes

- Spec coverage: export change (T1); tabs, config keys, log (T5); import flow incl. header check, blank-ID skip, delete guard, all-or-nothing write, roster pre-fill (T3, T6); email flow incl. dry run, per-recipient error capture, roster gaps, trigger (T4, T7); tests (T2–T4 local, T8 manual); deliverables (T8).
- Type consistency: `CurrentRow` fields match `CURRENT_FIELDS_`; `RosterRow` from `readRoster_` matches what `buildAdvisorDigests`/`findRosterGaps` expect; `logEvent(kind, counts, notes)` used identically in T6 and T7.
- Known limitation, by design: `highlightRosterGaps_` uses `INDIRECT`, which is fine at this size (a few hundred rows).
