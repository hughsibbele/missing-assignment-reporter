// Digest.gs — pure: build email text from Current + Roster.

function groupBy(arr, fn) {
  var out = {};
  arr.forEach(function (x) { var k = fn(x); (out[k] = out[k] || []).push(x); });
  return out;
}

function longDate_(iso) {
  var p = iso.split('-');
  return MONTHS_[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
}

function fillTemplate(s, todayIso) {
  return String(s || '').replace(/\{date\}/g, longDate_(todayIso));
}

function ageLabel_(item, todayIso) {
  var d = daysBetween(item.firstSeen, todayIso);
  if (d <= 0) return 'new this week';
  return 'missing ' + d + ' day' + (d === 1 ? '' : 's');
}

function itemLine_(item, todayIso) {
  var due = item.dueDate ? 'due ' + formatShort(item.dueDate) : 'no due date';
  return '  - ' + item.assignment + ' — ' + due + ' — ' + ageLabel_(item, todayIso);
}

// Items for ONE student, grouped by course (courses alphabetical, items as given).
function renderItems(items, todayIso) {
  var byCourse = groupBy(items, function (i) { return i.course; });
  var courses = Object.keys(byCourse).sort();
  var lines = [];
  courses.forEach(function (c) {
    lines.push(c + ':');
    byCourse[c].forEach(function (i) { lines.push(itemLine_(i, todayIso)); });
  });
  return lines.join('\n');
}

function plural_(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

function buildStudentDigest(items, cfg, todayIso) {
  var s = items[0];
  var body = [
    'Hi ' + s.student + ',',
    '',
    fillTemplate(cfg.student_intro, todayIso),
    '',
    'You have ' + plural_(items.length, 'missing assignment') + ':',
    '',
    renderItems(items, todayIso),
    ''
  ].join('\n');
  return { to: s.email, subject: fillTemplate(cfg.student_subject, todayIso), body: body };
}

function buildAdvisorDigests(currentRows, roster, cfg, todayIso) {
  var byStudent = groupBy(currentRows, function (r) { return r.studentId; });
  var byAdvisor = {};
  roster.forEach(function (rr) {
    if (!rr.advisorEmail || !byStudent[rr.studentId]) return;
    var key = rr.advisorEmail.toLowerCase();
    byAdvisor[key] = byAdvisor[key] || { to: rr.advisorEmail, advisorName: rr.advisorName, advisees: [] };
    byAdvisor[key].advisees.push({ student: rr.student || byStudent[rr.studentId][0].student, items: byStudent[rr.studentId] });
  });
  return Object.keys(byAdvisor).sort().map(function (k) {
    var a = byAdvisor[k];
    a.advisees.sort(function (x, y) { return x.student < y.student ? -1 : x.student > y.student ? 1 : 0; });
    var sections = a.advisees.map(function (adv) {
      return adv.student + ' (' + adv.items.length + ' missing)\n' + renderItems(adv.items, todayIso);
    });
    var body = [
      'Hi ' + (a.advisorName || 'there') + ',',
      '',
      fillTemplate(cfg.advisor_intro, todayIso),
      '',
      sections.join('\n\n'),
      ''
    ].join('\n');
    return { to: a.to, advisorName: a.advisorName, subject: fillTemplate(cfg.advisor_subject, todayIso), body: body };
  });
}

function findRosterGaps(currentRows, roster) {
  var rosterById = {};
  roster.forEach(function (r) { rosterById[r.studentId] = r; });
  var seen = {}, gaps = [];
  currentRows.forEach(function (r) {
    if (seen[r.studentId]) return;
    seen[r.studentId] = true;
    var rr = rosterById[r.studentId];
    if (!rr) gaps.push({ studentId: r.studentId, student: r.student, reason: 'not in Roster' });
    else if (!rr.advisorEmail) gaps.push({ studentId: r.studentId, student: r.student, reason: 'no advisor email' });
  });
  return gaps.sort(function (a, b) { return a.student < b.student ? -1 : a.student > b.student ? 1 : 0; });
}
