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
