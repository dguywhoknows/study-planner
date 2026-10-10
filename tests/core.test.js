const EXAM = { id: 1, subject: 'Math', date: '2026-10-12', difficulty: 3, confidence: 3 };
const base = (over) => Object.assign({ exams: [EXAM], topics: { 1: [{ name: 'A', hours: 1 }, { name: 'B', hours: 0.5 }] }, avail: [2, 2, 2, 2, 2, 2, 2], sessMin: 60, start: '2026-10-05', off: [], done: {} }, over);
const on = (plan, date) => plan.days.find((d) => d.date === date).sessions;

test('date helpers are UTC-safe across month ends', () => {
  assert.eq(addDays('2026-02-27', 2), '2026-03-01');
  assert.eq(dayDiff('2026-01-01', '2026-01-31'), 30);
  assert.eq(weekday('2026-10-08'), 4);
  assert.eq(mondayOf('2026-10-08'), '2026-10-05');
  assert.eq(mondayOf('2026-10-05'), '2026-10-05');
});

test('splitSyllabus keeps parenthesised lists together', () => {
  assert.deepEq(splitSyllabus('limits, derivatives (rules, chain rule); applications'), ['Limits', 'Derivatives (rules, chain rule)', 'Applications']);
  assert.eq(demoTopics({ syllabus: '', difficulty: 3, confidence: 3 }).length, 4);
});

test('buildSchedule learns topics first, then spaced reviews, mock and final review', () => {
  const p = buildSchedule(base());
  assert.eq(p.days.length, 8);
  assert.deepEq(on(p, '2026-10-05').map((s) => s.topic), ['A', 'B']);
  assert.ok(on(p, '2026-10-07').every((s) => s.kind === 'review'), 'reviews two days after learning');
  assert.eq(on(p, '2026-10-09')[0].topic, 'Full mock exam');
  assert.ok(on(p, '2026-10-11').some((s) => s.topic === 'Final review: weak spots'));
  assert.eq(on(p, '2026-10-12').length, 0, 'nothing on exam day');
  assert.deepEq(p.days[7].exams, ['Math']);
  assert.eq(p.overflow.length, 0);
});

test('buildSchedule interleaves subjects', () => {
  const bio = Object.assign({}, EXAM, { id: 2, subject: 'Bio' });
  const p = buildSchedule(base({ exams: [EXAM, bio], topics: { 1: [{ name: 'A', hours: 2 }], 2: [{ name: 'X', hours: 2 }] }, avail: [4, 4, 4, 4, 4, 4, 4] }));
  assert.deepEq(p.days[0].sessions.map((s) => s.subject), ['Math', 'Bio', 'Math', 'Bio']);
});

test('buildSchedule respects days off and reports overflow', () => {
  assert.eq(on(buildSchedule(base({ off: ['2026-10-05'] })), '2026-10-05').length, 0);
  const p = buildSchedule(base({ avail: [0, 0, 0, 0, 0, 0, 0] }));
  assert.eq(p.overflow.length, 4);
  assert.deepEq(p.overflow.map((o) => o.kind).sort(), ['final', 'final', 'learn', 'learn']);
});

test('replanning skips completed sessions', () => {
  const p = buildSchedule(base({ done: { '1-0-L0': true } }));
  assert.deepEq(on(p, '2026-10-05').map((s) => s.topic), ['B']);
  assert.ok(allSessions(p).every((s) => s.id !== '1-0-L0'));
  assert.ok(allSessions(p).some((s) => s.id === '1-A-R0'), 'reviews still queued for the finished topic');
});

test('missedSessions finds past unticked sessions', () => {
  const p = buildSchedule(base());
  assert.eq(missedSessions(p, {}, '2026-10-08').length, 4);
  assert.eq(missedSessions(p, { '1-0-L0': true }, '2026-10-08').length, 3);
});

test('readiness mixes completion and mastery', () => {
  const plan = { days: [{ date: 'x', sessions: [{ id: 'a', examId: 1 }, { id: 'b', examId: 1 }, { id: 'c', examId: 2 }] }] };
  assert.eq(readiness({ id: 1, confidence: 3 }, plan, { a: true }, [0.5]), 50);
  assert.eq(readiness({ id: 3, confidence: 5 }, plan, {}, []), 100);
  assert.eq(updateMastery(null, 3), 0.58);
  assert.eq(updateMastery(0.58, 0), 0.348);
});

test('streak counts back from today or yesterday', () => {
  const d = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-04'];
  assert.eq(streak(d, '2026-10-08'), 3);
  assert.eq(streak(d, '2026-10-09'), 3);
  assert.eq(streak(d, '2026-10-10'), 0);
  const f = focusTotals([{ date: 'a', subject: 'M', minutes: 25 }, { date: 'a', subject: 'B', minutes: 50 }, { date: 'b', subject: 'M', minutes: 25 }]);
  assert.eq(f.total, 100); assert.eq(f.byDate.a, 75); assert.eq(f.bySubject.M, 50);
});

test('gradeSummary works out the score needed on what is left', () => {
  const g = gradeSummary([{ weight: 20, score: 80 }, { weight: 30, score: 90 }, { weight: 50, score: null }], 85);
  assert.near(g.current, 86, 1e-9); assert.near(g.need, 84, 1e-9); assert.near(g.max, 93, 1e-9);
  assert.eq(letter(g.current), 'B'); assert.eq(letter(null), '—');
  assert.eq(gradeSummary([{ weight: 100, score: 70 }], 90).need, null);
});

test('toICS writes timed events with breaks and escapes text', () => {
  const p = buildSchedule(base());
  const ics = toICS(p, [EXAM], '16:00', '20261001T000000Z');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.eq((ics.match(/BEGIN:VEVENT/g) || []).length, allSessions(p).length + 1);
  assert.ok(ics.includes('DTSTART:20261005T160000'));
  assert.ok(ics.includes('DTSTART:20261005T171000'), 'second session after a 10 minute break');
  assert.eq(icsEscape('a,b;c'), 'a\\,b\\;c');
});
