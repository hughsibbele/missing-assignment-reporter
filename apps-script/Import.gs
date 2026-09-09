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
