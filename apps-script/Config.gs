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
