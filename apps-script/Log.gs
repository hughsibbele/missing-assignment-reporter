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
