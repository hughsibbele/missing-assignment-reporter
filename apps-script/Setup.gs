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
