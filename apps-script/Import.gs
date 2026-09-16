// Import.gs — sheet wrapper around Reconcile.gs.

function showImportDialog() {
  var html = HtmlService.createHtmlOutputFromFile('ImportDialog').setWidth(420).setHeight(300);
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

// Writes the new block first, then clears only stale rows below it, so a
// failure mid-way never leaves the sheet empty.
function writeCurrentRows_(rows) {
  var sheet = getOrCreateSheet_(TAB.CURRENT, CURRENT_HEADERS);
  var last = sheet.getLastRow();
  var needed = rows.length + 1;
  if (needed > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  if (rows.length) {
    var values = rows.map(function (r) {
      var a = currentRowToArray(r);
      a[6] = fromIso(r.dueDate);
      a[8] = fromIso(r.firstSeen);
      a[9] = fromIso(r.lastSeen);
      return a;
    });
    sheet.getRange(2, 1, values.length, CURRENT_HEADERS.length).setValues(values);
  }
  var firstStale = 2 + rows.length;
  if (last >= firstStale) {
    sheet.getRange(firstStale, 1, last - firstStale + 1, CURRENT_HEADERS.length).clearContent();
  }
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

// Optional Advisors tab: every student in the school with their advisor, in Roster's
// columns (the Student column may be blank). Never emailed from directly.
function readAdvisors_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(TAB.ADVISORS);
  if (!sheet || sheet.getLastRow() < 2) return {};
  return advisorsFromValues(sheet.getRange(1, 1, sheet.getLastRow(), ROSTER_HEADERS.length).getValues());
}

// Adds a Roster row for each student in the import who is not in Roster yet, with the
// advisor filled from the Advisors tab when it lists them. Returns {added, needAdvisor}.
function appendRosterStudents_(importRows) {
  var rows = newRosterRows(importRows, readRoster_(), readAdvisors_());
  if (!rows.length) return { added: 0, needAdvisor: 0 };
  var sheet = getOrCreateSheet_(TAB.ROSTER, ROSTER_HEADERS);
  var needed = sheet.getLastRow() + rows.length;
  if (needed > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ROSTER_HEADERS.length).setValues(rows);
  return { added: rows.length, needAdvisor: rows.filter(function (r) { return !r[3]; }).length };
}

// Called from the dialog. confirmed=true bypasses the delete guard.
function importCsvText(text, fileName, confirmed) {
  var csvRows;
  try { csvRows = Utilities.parseCsv(text); } catch (e) { return { ok: false, message: 'Could not parse CSV: ' + e.message }; }
  var parsed = parseImportRows(csvRows);
  if (parsed.missingHeaders.length) {
    return { ok: false, message: 'This does not look like the dashboard export. Missing columns: ' + parsed.missingHeaders.join(', ') + '. Nothing was changed.' };
  }
  if (!confirmed) {
    var current = readCurrentRows_();
    var preview = reconcile(current, parsed.rows, todayIso());
    var cfg = readConfig();
    if (current.length && preview.removed / current.length > cfg.delete_guard_fraction) {
      return {
        ok: true, needsConfirm: true,
        message: 'This file would remove ' + preview.removed + ' of ' + current.length + ' current rows (and add ' + preview.added + '). That is a lot. Is this a complete export?'
      };
    }
  }
  return applyImport_(parsed.rows, parsed.skipped, fileName);
}

function applyImport_(importRows, skipped, fileName) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, message: 'Another import is running. Try again in a minute.' };
  try {
    var current = readCurrentRows_();
    var result = reconcile(current, importRows, todayIso());
    writeCurrentRows_(result.rows);
    var roster = { added: 0, needAdvisor: 0 }, postError = '';
    try {
      roster = appendRosterStudents_(importRows);
      highlightRosterGaps_();
    } catch (e) {
      postError = 'Roster/highlight step failed: ' + e.message;
    }
    var notes = fileName +
      (skipped ? '; skipped ' + skipped + ' rows with blank IDs' : '') +
      (roster.added ? '; added ' + roster.added + ' students to Roster (' + roster.needAdvisor + ' without advisor)' : '') +
      (postError ? '; ' + postError : '');
    logEvent('import', { added: result.added, removed: result.removed, unchanged: result.unchanged }, notes);
    return {
      ok: true,
      message: 'Imported. Added ' + result.added + ', removed ' + result.removed + ', unchanged ' + result.unchanged + '.' +
        (roster.added ? '\n' + roster.added + ' student(s) added to Roster' +
          (roster.needAdvisor ? '; ' + roster.needAdvisor + ' need an advisor filled in.' : ', advisors filled from the Advisors tab.') : '') +
        (skipped ? '\nSkipped ' + skipped + ' row(s) with blank IDs.' : '') +
        (postError ? '\nWarning: ' + postError : '')
    };
  } finally {
    lock.releaseLock();
  }
}
