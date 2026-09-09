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
