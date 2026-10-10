/* core.js — dates, the study scheduler, readiness, streaks, grade maths and calendar export (pure, unit-tested). */

var DAY_MS = 864e5;
function isoDate(d) { return d.toISOString().slice(0, 10); }
function parseDate(s) { return new Date(s + 'T00:00:00Z'); }
function addDays(s, n) { return isoDate(new Date(parseDate(s).getTime() + n * DAY_MS)); }
function dayDiff(a, b) { return Math.round((parseDate(b) - parseDate(a)) / DAY_MS); }
function localISO(d) { d = d || new Date(); return isoDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))); }
function weekday(s) { return parseDate(s).getUTCDay(); }
function mondayOf(s) { return addDays(s, -((weekday(s) + 6) % 7)); }

/* "Limits, derivatives (rules, chain rule), applications" -> topic names, keeping parentheses intact. */
function splitSyllabus(text) {
  return String(text || '').split(/[,;\n](?![^(]*\))/).map(function (s) { return s.trim(); }).filter(Boolean)
    .map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); });
}
function demoTopics(exam) {
  var parts = splitSyllabus(exam.syllabus);
  if (!parts.length) parts = ['Core concepts', 'Key definitions', 'Worked problems', 'Past papers'];
  return parts.slice(0, 7).map(function (p, i) {
    return { name: p, hours: +(0.75 + ((exam.difficulty + i) % 3) * 0.5 + (5 - exam.confidence) * 0.25).toFixed(1), tip: i % 2 ? 'Do 5 practice questions before re-reading notes.' : 'Make a one-page summary from memory, then check gaps.' };
  });
}

/*
 * Greedy deadline-aware scheduler.
 * opts: {exams, topics: {examId: [{name, hours}]}, avail: [hours Sun..Sat], sessMin, start, off: [iso], done: {sessionId: true}}
 * Learn units of a topic run in order; finishing a topic queues spaced reviews (+2 and +6 days);
 * each exam gets a mock exam and a final review in its last days. Subjects are interleaved.
 * Completed sessions (from `done`) are not rescheduled, so running it again "replans from today".
 */
function buildSchedule(opts) {
  var sessMin = opts.sessMin, start = opts.start, off = {}, done = opts.done || {};
  (opts.off || []).forEach(function (d) { off[d] = true; });
  var tasks = [], learned = {}, reviewsFor = function (t, from) {
    [2, 6].forEach(function (gap, k) {
      var id = t.exam.id + '-' + t.topic + '-R' + k, e1 = addDays(from, gap);
      if (done[id]) return;
      if (e1 < t.exam.date) tasks.push({ id: id, exam: t.exam, ei: t.ei, topic: t.topic, kind: 'review', earliest: e1 < start ? start : e1, deadline: addDays(t.exam.date, -1), weight: t.weight * 0.8, seq: 5e3 });
    });
  };
  opts.exams.forEach(function (e, ei) {
    if (e.date <= start) return;
    var weight = e.difficulty * (6 - e.confidence);
    (opts.topics[e.id] || []).forEach(function (t, ti) {
      var units = Math.max(1, Math.ceil((t.hours * 60) / sessMin));
      for (var u = 0; u < units; u++) {
        var task = { id: e.id + '-' + ti + '-L' + u, exam: e, ei: ei, topic: t.name, kind: 'learn', unit: u, units: units, earliest: start, deadline: addDays(e.date, -2), weight: weight, seq: ti * 100 + u };
        if (done[task.id]) { learned[e.id + '-' + t.name + '-' + u] = true; if (u === units - 1) reviewsFor(task, addDays(start, -1)); }
        else tasks.push(task);
      }
    });
    [['final1', 'Full mock exam', -3, 5], ['final2', 'Final review: weak spots', -1, 6]].forEach(function (f, k) {
      var id = e.id + '-' + f[0];
      if (!done[id]) tasks.push({ id: id, exam: e, ei: ei, topic: f[1], kind: 'final', earliest: addDays(e.date, f[2]) < start ? start : addDays(e.date, f[2]), deadline: addDays(e.date, -1), weight: weight + f[3], seq: 9e3 + k });
    });
  });
  var lastExam = opts.exams.reduce(function (a, e) { return e.date > a ? e.date : a; }, start);
  var days = [];
  for (var d = start; d <= lastExam; d = addDays(d, 1)) {
    var cap = off[d] ? 0 : Math.floor(((opts.avail[weekday(d)] || 0) * 60) / sessMin);
    var day = { date: d, sessions: [], cap: cap, off: !!off[d], exams: opts.exams.filter(function (e) { return e.date === d; }).map(function (e) { return e.subject; }) };
    var lastSubj = null;
    for (var slot = 0; slot < cap; slot++) {
      var avail = tasks.filter(function (t) { return t.earliest <= d && d <= t.deadline && t.exam.date > d && (t.kind !== 'learn' || t.unit === 0 || learned[t.exam.id + '-' + t.topic + '-' + (t.unit - 1)]); });
      if (!avail.length) break;
      var score = function (t) {
        var slack = Math.max(0, dayDiff(d, t.deadline));
        var left = tasks.filter(function (p) { return p.exam === t.exam; }).length;
        var s = (t.weight + left * 1.5) / (slack + 1);
        if (t.kind === 'final' && t.deadline === d) s += 1000;
        if (t.kind === 'review') s += 2 / (slack + 1);
        if (t.exam.subject === lastSubj) s *= 0.55;
        return s - t.seq * 1e-6;
      };
      avail.sort(function (a, b) { return score(b) - score(a); });
      var t = avail[0];
      tasks.splice(tasks.indexOf(t), 1);
      day.sessions.push({ id: t.id, subject: t.exam.subject, examId: t.exam.id, ei: t.ei, topic: t.topic, kind: t.kind, unit: t.unit, units: t.units });
      lastSubj = t.exam.subject;
      if (t.kind === 'learn') { learned[t.exam.id + '-' + t.topic + '-' + t.unit] = true; if (t.unit === t.units - 1) reviewsFor(t, d); }
    }
    days.push(day);
  }
  return {
    days: days, sessMin: sessMin, start: start,
    overflow: tasks.filter(function (t) { return t.kind !== 'review'; }).map(function (t) { return { subject: t.exam.subject, topic: t.topic, kind: t.kind }; }),
  };
}
function allSessions(plan) { return plan ? plan.days.reduce(function (a, d) { return a.concat(d.sessions.map(function (s) { return Object.assign({ date: d.date }, s); })); }, []) : []; }
/* Sessions scheduled before today that were never ticked off. */
function missedSessions(plan, done, today) { return allSessions(plan).filter(function (s) { return s.date < today && !done[s.id]; }); }

/* Readiness 0..100: 60% plan completion for the exam, 40% practice mastery (falls back to self-rated confidence). */
function readiness(exam, plan, done, mastery) {
  var mine = allSessions(plan).filter(function (s) { return s.examId === exam.id; });
  var m = mastery && mastery.length ? mastery.reduce(function (a, x) { return a + x; }, 0) / mastery.length : (exam.confidence - 1) / 4;
  if (!mine.length) return Math.round(100 * m);
  var d = mine.filter(function (s) { return done[s.id]; }).length;
  return Math.round(100 * (0.6 * (d / mine.length) + 0.4 * m));
}
/* Practice grading: 0 = forgot, 1 = hard, 2 = good, 3 = easy. Exponential moving mastery. */
function updateMastery(prev, grade) { var target = [0, 0.4, 0.75, 1][grade]; return +((prev == null ? 0.3 : prev) * 0.6 + target * 0.4).toFixed(3); }

/* Consecutive study days ending today (or yesterday, if today has nothing yet). */
function streak(dates, today) {
  var set = {}; dates.forEach(function (d) { set[d] = true; });
  var d = set[today] ? today : addDays(today, -1), n = 0;
  while (set[d]) { n++; d = addDays(d, -1); }
  return n;
}
/* Focus log [{date, subject, minutes}] -> totals by date and by subject. */
function focusTotals(log) {
  var byDate = {}, bySubject = {}, total = 0;
  log.forEach(function (x) { byDate[x.date] = (byDate[x.date] || 0) + x.minutes; bySubject[x.subject] = (bySubject[x.subject] || 0) + x.minutes; total += x.minutes; });
  return { byDate: byDate, bySubject: bySubject, total: total };
}

/* Grade maths. components: [{name, weight, score|null}] in percent. */
function gradeSummary(components, target) {
  var totalW = 0, scoredW = 0, earned = 0;
  components.forEach(function (c) { var w = +c.weight || 0; totalW += w; if (c.score != null && c.score !== '') { scoredW += w; earned += (w * +c.score) / 100; } });
  var remainingW = totalW - scoredW;
  return {
    totalW: totalW, scoredW: scoredW, remainingW: remainingW,
    current: scoredW ? (100 * earned) / scoredW : null,
    locked: earned,
    need: remainingW > 0 ? ((target * totalW) / 100 - earned) / remainingW * 100 : null,
    max: totalW ? (100 * (earned + remainingW)) / totalW : null,
  };
}
function letter(pct) { return pct == null ? '—' : pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F'; }

/* iCalendar export. Sessions start at `startTime` (HH:MM) with 10-minute breaks between them. */
function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, function (m) { return '\\' + m; }).replace(/\n/g, '\\n'); }
function toICS(plan, exams, startTime, stamp) {
  var hm = startTime.split(':').map(Number);
  var fmt = function (date, mins) { var d = parseDate(date); d.setUTCHours(hm[0], hm[1] + mins); return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, ''); };
  var out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//study-planner//EN', 'CALSCALE:GREGORIAN'];
  plan.days.forEach(function (d) {
    d.sessions.forEach(function (s, i) {
      var off = i * (plan.sessMin + 10);
      out.push('BEGIN:VEVENT', 'UID:' + s.id + '-' + d.date + '@study-planner', 'DTSTAMP:' + stamp, 'DTSTART:' + fmt(d.date, off), 'DTEND:' + fmt(d.date, off + plan.sessMin), 'SUMMARY:' + icsEscape(s.subject + ': ' + s.topic), 'DESCRIPTION:' + s.kind + ' session', 'END:VEVENT');
    });
  });
  exams.forEach(function (e) { out.push('BEGIN:VEVENT', 'UID:exam-' + e.id + '@study-planner', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + e.date.replace(/-/g, ''), 'SUMMARY:' + icsEscape(e.subject + ' exam'), 'END:VEVENT'); });
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}
