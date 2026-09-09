// Email.gs — Tuesday digests. Pure text comes from Digest.gs.

function sendOne_(cfg, msg, kind, errors) {
  if (!msg.to) { errors.push(kind + ': no recipient'); return false; }
  var to = msg.to, subject = msg.subject;
  if (cfg.dry_run) {
    to = cfg.dry_run_recipient;
    subject = '[DRY RUN → ' + msg.to + '] ' + subject;
    if (!to) { errors.push(kind + ': dry_run_recipient is blank'); return false; }
  }
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

function getUiOrNull_() {
  try { return SpreadsheetApp.getUi(); } catch (e) { return null; }   // no UI under a trigger
}

function sendWeeklyDigests() {
  var cfg = readConfig();
  var today = todayIso();
  var current = readCurrentRows_();
  var roster = readRoster_();
  var rosterById = {};
  roster.forEach(function (r) { rosterById[r.studentId] = r; });
  var errors = [], sent = 0, gaps = [], fatal = '';
  var ui = getUiOrNull_();

  var byStudent = groupBy(current, function (r) { return r.studentId; });
  var studentIds = Object.keys(byStudent).filter(function (sid) { return !!rosterById[sid]; });

  if (ui && !cfg.dry_run) {
    var answer = ui.alert('Send live emails?',
      'This will email ' + studentIds.length + ' student(s) and their advisors from your account. Continue?',
      ui.ButtonSet.YES_NO);
    if (answer !== ui.Button.YES) { logEvent('send', { emailsSent: 0 }, 'Cancelled at confirmation prompt.'); return; }
  }

  try {
    studentIds.forEach(function (sid) {
      try {
        if (sendOne_(cfg, buildStudentDigest(byStudent[sid], cfg, today), 'student ' + sid, errors)) sent++;
      } catch (e) { errors.push('student ' + sid + ': ' + e.message); }
    });

    var advisorDigests = [];
    try { advisorDigests = buildAdvisorDigests(current, roster, cfg, today); }
    catch (e) { errors.push('advisor digests: ' + e.message); }
    advisorDigests.forEach(function (msg) {
      try { if (sendOne_(cfg, msg, 'advisor', errors)) sent++; }
      catch (e) { errors.push('advisor ' + msg.to + ': ' + e.message); }
    });

    gaps = findRosterGaps(current, roster);
    if (gaps.length && cfg.dry_run_recipient) {
      var lines = gaps.map(function (g) { return '  - ' + g.student + ' (ID ' + g.studentId + '): ' + g.reason; });
      var body = 'These students have missing work but could not be emailed or reported to an advisor.\n' +
        'Fix the Roster tab and they will be included next week.\n\n' + lines.join('\n') + '\n';
      var gapMsg = { to: cfg.dry_run_recipient, subject: 'Roster gaps — missing work sheet', body: body };
      try { if (sendOne_(cfg, gapMsg, 'gaps', errors)) sent++; }
      catch (e) { errors.push('gaps: ' + e.message); }
    }
  } catch (e) {
    fatal = 'Run aborted: ' + e.message;
  } finally {
    var notes = (cfg.dry_run ? 'DRY RUN. ' : '') + (gaps.length ? gaps.length + ' roster gap(s). ' : '') +
      (fatal ? fatal + ' ' : '') + (errors.length ? 'Errors: ' + errors.join(' | ') : '');
    logEvent('send', { emailsSent: sent }, notes.trim());
  }

  if (ui) ui.alert('Sent ' + sent + ' email(s)' + (cfg.dry_run ? ' (dry run, all to ' + cfg.dry_run_recipient + ')' : '') + '.' +
    (fatal ? '\n\n' + fatal : '') + (errors.length ? '\n\nErrors:\n' + errors.join('\n') : ''));
}

// Removes this user's existing sendWeeklyDigests trigger, then installs Tuesday 07:00. Triggers are per-user: only one person should install it.
function installWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklyDigests') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWeeklyDigests')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.TUESDAY)
    .atHour(7)
    .create();
  var ui = getUiOrNull_();
  if (ui) ui.alert('Tuesday 7am trigger installed. Emails send from ' + Session.getEffectiveUser().getEmail() + '. Check Config → dry_run before the first Tuesday.');
}
