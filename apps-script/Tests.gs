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
    dueDate: '2026-09-04', points: '10', firstSeen: '2026-09-01', lastSeen: '2026-09-09', courseId: '100', assignmentId: '1001' };
  var arr = currentRowToArray(r);
  assertEq(arr.length, CURRENT_HEADERS.length, 'one cell per header');
  assertEq(arr[0], '1', 'student id first');
  assertEq(arrayToCurrentRow(arr), r, 'roundtrip');
  assertEq(arr[CURRENT_HEADERS.indexOf('First seen')], '2026-09-01', 'first seen under its header');
  assertEq(arr[CURRENT_HEADERS.indexOf('Last seen')], '2026-09-09', 'last seen under its header');
  assertEq(arr[CURRENT_HEADERS.indexOf('Course ID')], '100', 'course id under its header');
  assertEq(arr[CURRENT_HEADERS.indexOf('Assignment ID')], '1001', 'assignment id under its header');
  assertEq(arr[CURRENT_HEADERS.indexOf('Due date')], '2026-09-04', 'due date under its header');
  assertEq(arrayToCurrentRow([1, 'Ada Test', 'e', 9, 'c', 'a', '2026-09-04', 10, '2026-09-01', '2026-09-09', 100, 1001]), r, 'header-ordered numeric array maps to the same row');
}
