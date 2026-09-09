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
