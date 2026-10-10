const { $, $$, h, esc, busy, toast, download, store, md } = Kit;
const COLORS = ['#3b6fe0', '#e2703a', '#1f9d63', '#d6457a', '#7c5cd6', '#0ea5a8', '#c98a0b'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const today = () => localISO();
const pretty = (s) => parseDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const short = (s) => parseDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/* ---------- state ---------- */
const S = Object.assign({
  exams: [
    { id: 1, subject: 'Calculus I', date: addDays(today(), 12), difficulty: 4, confidence: 2, syllabus: 'Limits, derivatives (rules, chain rule, implicit), applications (related rates, optimization), intro integrals' },
    { id: 2, subject: 'Chemistry', date: addDays(today(), 19), difficulty: 3, confidence: 3, syllabus: 'Stoichiometry, gas laws, thermochemistry, atomic structure, periodic trends, bonding' },
    { id: 3, subject: 'World History', date: addDays(today(), 9), difficulty: 2, confidence: 3, syllabus: 'Industrial Revolution, causes of WWI, interwar period, WWII, Cold War origins' },
  ],
  avail: [5, 2.5, 2.5, 2.5, 2.5, 2, 5],
  topics: {}, plan: null, done: {}, mastery: {}, focus: [],
  courses: [{ id: 1, name: 'Calculus I', target: 85, comps: [{ name: 'Homework', weight: 15, score: 92 }, { name: 'Quizzes', weight: 15, score: 78 }, { name: 'Midterm', weight: 30, score: 81 }, { name: 'Final exam', weight: 40, score: null }] }],
}, store.get('planner.v1', {}));
const save = () => store.set('planner.v1', S);
let weekOffset = 0;
const examById = (id) => S.exams.find((e) => e.id === id);
const colorOf = (subject) => { const i = S.exams.findIndex((e) => e.subject === subject); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
const doneDates = () => Object.values(S.done).filter((v) => typeof v === 'string').concat(S.focus.map((f) => f.date));
function toggleDone(id) { if (S.done[id]) delete S.done[id]; else S.done[id] = today(); save(); renderAll(); }

/* ================= plan page ================= */
function renderExams() {
  const box = $('#exams');
  box.innerHTML = '';
  S.exams.sort((a, b) => a.date.localeCompare(b.date)).forEach((e, i) => {
    const bind = (k) => (ev) => { e[k] = ev.target.value; if (k === 'syllabus' || k === 'subject') delete S.topics[e.id]; save(); };
    const syl = h('textarea', { placeholder: 'Syllabus or topics (optional; the model infers one if blank)', 'aria-label': 'Syllabus', oninput: bind('syllabus') });
    syl.value = e.syllabus || '';
    const slider = (k, label) => h('label', {}, `${label} ${e[k]}/5`, h('input', { type: 'range', min: 1, max: 5, value: e[k], oninput: (ev) => { e[k] = +ev.target.value; ev.target.parentElement.firstChild.textContent = `${label} ${e[k]}/5`; save(); } }));
    box.append(h('div', { class: 'exam', style: `--c:${COLORS[i % COLORS.length]}` },
      h('div', { class: 'row' }, h('input', { class: 'input grow', value: e.subject, 'aria-label': 'Subject', oninput: bind('subject') }), h('input', { class: 'input', type: 'date', value: e.date, style: 'width:150px', 'aria-label': 'Exam date', onchange: bind('date') }),
        h('button', { class: 'btn ghost sm danger', 'aria-label': 'Remove exam', onclick: () => { if (!confirm(`Remove ${e.subject}?`)) return; S.exams = S.exams.filter((x) => x !== e); save(); renderExams(); } }, '×')),
      syl, h('div', { class: 'mini' }, slider('difficulty', 'Difficulty'), slider('confidence', 'Confidence'))));
  });
}
$('#addExam').onclick = () => { S.exams.push({ id: Date.now(), subject: 'New subject', date: addDays(today(), 14), difficulty: 3, confidence: 3, syllabus: '' }); save(); renderExams(); };
function renderAvail() {
  $('#avail').innerHTML = '';
  WD.forEach((d, i) => $('#avail').append(h('label', {}, d, h('input', { class: 'input', type: 'number', min: 0, max: 14, step: 0.5, value: S.avail[i], 'aria-label': d + ' hours', onchange: (e) => { S.avail[i] = +e.target.value; save(); } }))));
}

async function breakdown(e) {
  if (S.topics[e.id]) return S.topics[e.id];
  const out = await AI.chat([
    { role: 'system', content: 'You are an expert study coach. Break a course exam into 4-8 study topics with realistic study-hour estimates for a typical student (include practice problems). Harder, foundational topics get more hours. Return JSON {"topics":[{"name":"","hours":number,"tip":"one specific study tip"}]}.' },
    { role: 'user', content: `Subject: ${e.subject}\nSyllabus: ${e.syllabus || '(not given, infer a standard first-year syllabus)'}\nDifficulty ${e.difficulty}/5, student confidence ${e.confidence}/5.` },
  ], { json: true, temperature: 0.3, demo: () => ({ topics: demoTopics(e) }) });
  S.topics[e.id] = (out.topics || []).filter((t) => t.name).map((t) => ({ name: t.name, hours: Math.max(0.5, Math.min(12, +t.hours || 2)), tip: t.tip || '' }));
  return S.topics[e.id];
}
const offDays = () => $('#blackout').value.split(',').map((s) => s.trim()).filter(Boolean);
function schedule(keepDone) {
  S.plan = buildSchedule({ exams: S.exams, topics: S.topics, avail: S.avail, sessMin: +$('#session').value, start: today(), off: offDays(), done: keepDone ? S.done : {} });
  if (!keepDone) S.done = {};
  S.plan.startTime = $('#startTime').value;
  save();
}
async function buildPlan() {
  if (!S.exams.length) return toast('Add at least one exam', 'err');
  if (S.exams.some((e) => e.date <= today())) return toast('All exam dates must be in the future', 'err');
  if (S.plan && Object.keys(S.done).length && !confirm('Rebuilding starts the plan over and clears ticked sessions. Use "Replan from today" to keep them. Continue?')) return;
  for (const e of S.exams) await breakdown(e);
  schedule(false);
  weekOffset = 0;
  renderAll();
  toast('Plan built');
}
$('#replan').onclick = () => {
  const missed = missedSessions(S.plan, S.done, today()).length;
  schedule(true);
  renderAll();
  toast(missed ? `Replanned: ${missed} missed session${missed === 1 ? '' : 's'} moved forward` : 'Replanned from today');
};

function renderPlanPage() {
  renderTopics();
  const P = S.plan;
  ['#ics', '#replan'].forEach((s) => ($(s).disabled = !P));
  if (!P) { $('#tiles').innerHTML = ''; $('#load').innerHTML = '<div class="empty">Build a plan to see your daily load.</div>'; $('#warnCard').classList.add('hidden'); return; }
  const all = allSessions(P), done = all.filter((s) => S.done[s.id]).length, upcoming = S.exams.map((e) => e.date).filter((d) => d > today()).sort()[0];
  $('#tiles').innerHTML = [['Study sessions', all.length], ['Total hours', ((all.length * P.sessMin) / 60).toFixed(1)], ['Completed', `${done}/${all.length}`], ['Next exam', upcoming ? `${dayDiff(today(), upcoming)} days` : '—'], ['Reviews', all.filter((s) => s.kind === 'review').length], ['Unscheduled', P.overflow.length]]
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const w = $('#warnCard');
  if (P.overflow.length) {
    const by = {};
    P.overflow.forEach((o) => (by[o.subject] = (by[o.subject] || 0) + 1));
    w.classList.remove('hidden');
    w.innerHTML = `<b style="color:var(--bad)">Not enough time.</b> ${Object.entries(by).map(([s, n]) => `${esc(s)}: ${n} session${n > 1 ? 's' : ''} (${((n * P.sessMin) / 60).toFixed(1)}h)`).join(' · ')} couldn't fit. Add hours on some days or lower the topic estimates.`;
  } else w.classList.add('hidden');
  renderLoad();
}
function renderLoad() {
  const P = S.plan, W = 760, H = 150, pb = 22;
  const max = Math.max(1, ...P.days.map((d) => (d.cap * P.sessMin) / 60));
  const bw = W / P.days.length, unit = ((H - pb - 6) * P.sessMin) / 60 / max;
  let s = '';
  P.days.forEach((d, i) => {
    let y = H - pb;
    const x = i * bw + 1;
    s += `<rect x="${x}" y="${H - pb - unit * d.cap}" width="${bw - 2}" height="${unit * d.cap}" fill="var(--line)" opacity=".5"/>`;
    d.sessions.forEach((ss) => { y -= unit; s += `<rect x="${x}" y="${y}" width="${bw - 2}" height="${unit - 0.5}" fill="${colorOf(ss.subject)}" opacity="${S.done[ss.id] ? 0.4 : 1}"><title>${esc(ss.subject)}: ${esc(ss.topic)}</title></rect>`; });
    if (d.exams.length) s += `<rect x="${x + bw / 2 - 4}" y="${H - pb - 10}" width="8" height="8" rx="2" fill="var(--text)"><title>${esc(d.exams.join(', '))} exam</title></rect>`;
    if (i % Math.ceil(P.days.length / 12) === 0) s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${short(d.date)}</text>`;
  });
  $('#load').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Study hours per day">${s}</svg><div class="row small">${S.exams.map((e) => `<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colorOf(e.subject)}"></span> ${esc(e.subject)} · ${pretty(e.date)}</span>`).join(' ')}</div>`;
}
function renderTopics() {
  const box = $('#topics');
  box.innerHTML = '';
  if (!S.exams.some((e) => S.topics[e.id])) { box.append(h('div', { class: 'empty' }, 'Each subject is broken into topics with hour estimates when you build the plan.')); return; }
  S.exams.forEach((e) => {
    const ts = S.topics[e.id];
    if (!ts) return;
    box.append(h('h3', { style: `color:${colorOf(e.subject)};margin-top:10px` }, e.subject));
    ts.forEach((t) => box.append(h('div', { class: 'topic-row' }, h('div', {}, t.name, h('div', { class: 'small muted' }, t.tip)),
      h('input', { class: 'input', type: 'number', min: 0.5, step: 0.5, value: t.hours, 'aria-label': 'hours', style: 'padding:4px 6px', onchange: (ev) => { t.hours = +ev.target.value; save(); } }), h('span', { class: 'small muted' }, 'hours, then rebuild'))));
  });
}
$('#ics').onclick = () => {
  download('study-plan.ics', toICS(S.plan, S.exams, $('#startTime').value, new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')), 'text/calendar');
  toast('Calendar file saved. Times use your local clock.');
};

/* ================= today ================= */
function renderToday() {
  const t = today(), P = S.plan;
  $('#todayTitle').textContent = pretty(t);
  const day = P && P.days.find((d) => d.date === t);
  const list = $('#todayList');
  list.innerHTML = '';
  const st = streak(doneDates(), t);
  $('#todaySub').textContent = P ? `${day ? day.sessions.length : 0} sessions planned · ${st}-day streak` : 'Build a plan first.';
  if (!day || !day.sessions.length) list.append(h('div', { class: 'empty' }, P ? 'Nothing scheduled today. Rest, or get ahead with a practice quiz.' : 'No plan yet.'));
  (day ? day.sessions : []).forEach((s) => list.append(h('label', { class: 'today-item' + (S.done[s.id] ? ' done' : '') },
    h('input', { type: 'checkbox', checked: !!S.done[s.id], onchange: () => toggleDone(s.id) }),
    h('span', { class: 'dot', style: `background:${colorOf(s.subject)}` }),
    h('div', {}, h('b', {}, s.topic), h('div', { class: 'small muted' }, `${s.subject} · ${s.kind === 'learn' ? `learn ${s.unit + 1}/${s.units}` : s.kind} · ${P.sessMin} min`)),
    h('button', { class: 'btn ghost sm', onclick: (e) => { e.preventDefault(); $('#focusFor').value = s.subject; setTimer(+$('#tFocus').value * 60, 'focus'); toast('Timer set for ' + s.subject); } }, 'Focus'))));
  const missed = P ? missedSessions(P, S.done, t) : [];
  const mc = $('#missedCard');
  mc.classList.toggle('hidden', !missed.length);
  if (missed.length) {
    mc.innerHTML = '';
    mc.append(h('div', { class: 'row between' }, h('div', {}, h('b', {}, `${missed.length} missed session${missed.length === 1 ? '' : 's'}`), h('div', { class: 'small muted' }, missed.slice(0, 4).map((m) => `${m.subject}: ${m.topic} (${short(m.date)})`).join(' · '))),
      h('button', { class: 'btn', onclick: () => $('#replan').click() }, 'Replan from today')));
  }
  const sel = $('#focusFor'), cur = sel.value;
  sel.innerHTML = '';
  S.exams.forEach((e) => sel.append(h('option', { value: e.subject }, e.subject)));
  sel.append(h('option', { value: 'Other' }, 'Other'));
  if (cur) sel.value = cur;
  const mins = S.focus.filter((f) => f.date === t).reduce((a, f) => a + f.minutes, 0);
  $('#focusToday').textContent = `${mins} focused minutes today`;
}
async function brief() {
  const P = S.plan, t = today();
  if (!P) return toast('Build a plan first', 'err');
  const day = P.days.find((d) => d.date === t && d.sessions.length) || P.days.find((d) => d.date >= t && d.sessions.length);
  if (!day) return toast('No upcoming sessions', 'err');
  const upcoming = S.exams.map((e) => `${e.subject} in ${dayDiff(t, e.date)} days (readiness ${readiness(e, P, S.done, masteryOf(e))}%)`).join('; ');
  const text = await AI.chat([
    { role: 'system', content: 'You are an encouraging, no-fluff study coach. Write a short daily brief: a one-line motivation tied to the real countdown, the plan for the day as a checklist with one concrete technique per session (active recall, practice problems, Feynman, etc.), and one well-being reminder. Markdown, max 150 words.' },
    { role: 'user', content: `Date: ${day.date}\nSessions (${P.sessMin} min each): ${day.sessions.map((s) => `${s.subject}: ${s.topic} [${s.kind}]`).join('; ')}\nExams: ${upcoming}` },
  ], { temperature: 0.6, demo: () => `**${dayDiff(t, S.exams.map((e) => e.date).sort()[0])} days to your first exam.**\n\n${day.sessions.map((s) => `- [ ] **${s.subject}: ${s.topic}**: ${s.kind === 'learn' ? 'read once, then close the notes and write what you remember' : s.kind === 'review' ? 'quiz yourself before looking anything up' : 'timed practice under exam conditions'}`).join('\n')}\n\nTake a five-minute break between sessions and drink some water.` });
  $('#briefOut').innerHTML = md(text);
}
$('#brief').onclick = (e) => busy(e.currentTarget, brief);

/* ---------- focus timer ---------- */
const timer = { left: 25 * 60, total: 25 * 60, phase: 'focus', int: null, startedAt: 0 };
const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
function drawTimer() {
  $('#clock').textContent = fmtClock(Math.max(0, timer.left));
  $('#phase').textContent = timer.phase === 'focus' ? 'Focus' : 'Break';
  $('.timer-card').classList.toggle('break', timer.phase === 'break');
  $('#tStart').textContent = timer.int ? 'Pause' : timer.left < timer.total ? 'Resume' : 'Start';
}
function setTimer(secs, phase) { clearInterval(timer.int); timer.int = null; Object.assign(timer, { left: secs, total: secs, phase }); drawTimer(); }
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach((t, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = i ? 990 : 660; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.18, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.5); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.5); });
  } catch {}
}
function finishPhase() {
  clearInterval(timer.int); timer.int = null;
  chime();
  if (timer.phase === 'focus') {
    const minutes = Math.round((timer.total - Math.max(0, timer.left)) / 60);
    if (minutes > 0) { S.focus.push({ date: today(), subject: $('#focusFor').value || 'Other', minutes }); save(); }
    toast(`Logged ${minutes} focused minutes`);
    setTimer(+$('#tBreak').value * 60, 'break');
  } else setTimer(+$('#tFocus').value * 60, 'focus');
  renderToday();
}
$('#tStart').onclick = () => {
  if (timer.int) { clearInterval(timer.int); timer.int = null; return drawTimer(); }
  const end = Date.now() + timer.left * 1000;
  timer.int = setInterval(() => { timer.left = Math.round((end - Date.now()) / 1000); if (timer.left <= 0) finishPhase(); else drawTimer(); }, 250);
  drawTimer();
};
$('#tReset').onclick = () => setTimer(+(timer.phase === 'focus' ? $('#tFocus') : $('#tBreak')).value * 60, timer.phase);
$('#tSkip').onclick = finishPhase;
$('#tFocus').onchange = () => timer.phase === 'focus' && !timer.int && setTimer(+$('#tFocus').value * 60, 'focus');
$('#tBreak').onchange = () => timer.phase === 'break' && !timer.int && setTimer(+$('#tBreak').value * 60, 'break');

/* ================= calendar ================= */
function renderCal() {
  const P = S.plan, monday = addDays(mondayOf(today()), weekOffset * 7);
  $('#weekLbl').textContent = `${short(monday)} – ${short(addDays(monday, 6))}`;
  const box = $('#cal');
  box.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i), day = P && P.days.find((x) => x.date === d);
    const el = h('div', { class: 'day' + (d === today() ? ' today' : '') + (day && day.off ? ' off' : '') },
      h('div', { class: 'dh' }, h('span', {}, pretty(d)), h('span', { class: 'muted' }, day ? `${((day.sessions.length * P.sessMin) / 60).toFixed(1)}h` : '')));
    S.exams.filter((e) => e.date === d).forEach((e) => el.append(h('div', { class: 'exam-flag' }, e.subject + ' exam')));
    (day ? day.sessions : []).forEach((s) => el.append(h('div', { class: 'sess' + (S.done[s.id] ? ' done' : ''), style: `background:${colorOf(s.subject)}`, title: 'Click to mark done', role: 'button', tabindex: 0, onclick: () => toggleDone(s.id), onkeydown: (e) => e.key === 'Enter' && toggleDone(s.id) },
      s.topic, h('small', {}, `${s.subject} · ${s.kind === 'learn' ? `learn ${s.unit + 1}/${s.units}` : s.kind}`))));
    box.append(el);
  }
  const cd = $('#countdown');
  cd.innerHTML = '';
  S.exams.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => {
    const n = dayDiff(today(), e.date);
    cd.append(h('div', { class: 'cd', style: `background:${colorOf(e.subject)}` }, h('div', { class: 'n' }, n < 0 ? 'done' : n === 0 ? 'today' : n + 'd'), h('div', {}, h('b', {}, e.subject)), h('div', { class: 'small' }, pretty(e.date) + ' · readiness ' + readiness(e, S.plan, S.done, masteryOf(e)) + '%')));
  });
}
$('#prevW').onclick = () => { weekOffset--; renderCal(); };
$('#nextW').onclick = () => { weekOffset++; renderCal(); };
$('#thisW').onclick = () => { weekOffset = 0; renderCal(); };

/* ================= practice ================= */
const masteryOf = (e) => Object.values(S.mastery[e.id] || {});
function topicNames(e) { return (S.topics[e.id] || demoTopics(e)).map((t) => t.name); }
function fillPractice() {
  const subj = $('#pSubject'), cur = subj.value;
  subj.innerHTML = '';
  S.exams.forEach((e) => subj.append(h('option', { value: e.id }, e.subject)));
  if (cur && examById(+cur)) subj.value = cur;
  fillTopics();
  renderMastery();
}
function fillTopics() {
  const e = examById(+$('#pSubject').value);
  $('#pTopic').innerHTML = '';
  if (!e) return;
  const m = S.mastery[e.id] || {};
  topicNames(e).sort((a, b) => (m[a] ?? 0.3) - (m[b] ?? 0.3)).forEach((t) => $('#pTopic').append(h('option', { value: t }, `${t}${m[t] != null ? ` (${Math.round(m[t] * 100)}%)` : ''}`)));
}
$('#pSubject').onchange = fillTopics;
function demoQuestions(e, topic, n) {
  const T = [
    ['Explain ' + topic + ' in two sentences as if to a classmate who missed the lecture.', 'A good answer names the core idea, one key term and where it shows up in the course.'],
    ['What is the most common mistake students make with ' + topic + '?', 'Think about sign errors, missed conditions or confusing two similar definitions. Check your notes for the trap your teacher stressed.'],
    ['Write one exam-style question on ' + topic + ' and solve it without notes.', 'Compare your solution step by step with a worked example from class.'],
    ['How does ' + topic + ' connect to another topic in ' + e.subject + '?', 'Strong answers link a definition here to a technique or result from a different unit.'],
    ['List three key terms from ' + topic + ' and define each.', 'Check each definition against the textbook glossary.'],
    ['What would a 5-mark question on ' + topic + ' ask you to show?', 'Usually: a definition, a worked application and a short justification.'],
    ['Draw or describe a diagram that summarises ' + topic + '.', 'A good diagram has labelled parts and shows how they relate.'],
    ['Teach-back: what would you say first if you had 60 seconds to teach ' + topic + '?', 'Lead with the big idea, then one example.'],
  ];
  return { questions: T.slice(0, n).map(([q, a]) => ({ q, a })) };
}
$('#pGo').onclick = (ev) => busy(ev.currentTarget, async () => {
  const e = examById(+$('#pSubject').value), topic = $('#pTopic').value, n = +$('#pCount').value;
  if (!e || !topic) return toast('Add an exam first', 'err');
  const out = await AI.chat([
    { role: 'system', content: `You write exam practice questions. Mix recall, application and one harder synthesis question. Each answer is a concise model answer (max 60 words). Return JSON {"questions":[{"q":"","a":""}]} with exactly ${n} items.` },
    { role: 'user', content: `Course: ${e.subject}\nTopic: ${topic}\nSyllabus: ${e.syllabus || ''}` },
  ], { json: true, temperature: 0.7, demo: () => demoQuestions(e, topic, n) });
  renderQuiz(e, topic, (out.questions || []).filter((q) => q.q));
});
function renderQuiz(e, topic, qs) {
  const box = $('#quiz');
  box.innerHTML = '';
  const grades = [];
  box.append(h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, `${e.subject}: ${topic}`), h('span', { class: 'small muted', id: 'quizProg' }, `0/${qs.length} graded`)));
  qs.forEach((q, i) => {
    const ans = h('div', { class: 'ans hidden' });
    ans.innerHTML = md(q.a);
    const grade = h('div', { class: 'row grade hidden' }, h('span', { class: 'small muted' }, 'How did you do?'),
      ['Forgot', 'Hard', 'Good', 'Easy'].map((label, g) => h('button', { class: 'btn sm' + (g === 2 ? ' primary' : ''), onclick: () => {
        const m = (S.mastery[e.id] = S.mastery[e.id] || {});
        m[topic] = updateMastery(m[topic], g);
        grades[i] = g; save();
        card.classList.add('graded');
        grade.innerHTML = `<span class="small">Graded: <b>${label}</b> · topic mastery ${Math.round(m[topic] * 100)}%</span>`;
        const n = grades.filter((x) => x != null).length;
        $('#quizProg').textContent = `${n}/${qs.length} graded`;
        if (n === qs.length) toast(`Quiz done. ${topic} mastery is now ${Math.round(m[topic] * 100)}%`);
        renderMastery(); fillTopics(); $('#pTopic').value = topic;
      } }, label)));
    const card = h('div', { class: 'q' }, h('div', { class: 'small muted' }, `Question ${i + 1}`), h('div', { style: 'font-weight:600;margin-top:4px' }, q.q),
      h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: (ev) => { ans.classList.remove('hidden'); grade.classList.remove('hidden'); ev.currentTarget.remove(); } }, 'Reveal answer'), ans, grade);
    box.append(card);
  });
}
function renderMastery() {
  const box = $('#masteryList');
  box.innerHTML = '';
  S.exams.forEach((e) => {
    const m = S.mastery[e.id] || {}, names = topicNames(e);
    box.append(h('h3', { style: `color:${colorOf(e.subject)};margin:10px 0 4px` }, e.subject));
    names.forEach((t) => box.append(h('div', { class: 'ready-row', style: 'grid-template-columns:minmax(0,1fr) 80px 40px;font-size:13px' }, h('span', {}, t), h('div', { class: 'bar' }, h('span', { style: `width:${Math.round((m[t] ?? 0) * 100)}%` })), h('span', { class: 'small muted' }, m[t] != null ? Math.round(m[t] * 100) + '%' : '—'))));
  });
}

/* ================= grades ================= */
function renderCourses() {
  const box = $('#courses');
  box.innerHTML = '';
  if (!S.courses.length) box.append(h('div', { class: 'empty' }, 'Add a course to work out what you need on the final.'));
  S.courses.forEach((c) => {
    const out = h('div', {});
    const update = () => {
      const g = gradeSummary(c.comps, c.target);
      out.innerHTML = '';
      out.append(h('div', { class: 'grid cols-3', style: 'margin-top:10px' },
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Current'), h('div', { class: 'v' }, g.current == null ? '—' : `${g.current.toFixed(1)}% ${letter(g.current)}`)),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, `Needed for ${c.target}%`), h('div', { class: 'v', style: g.need > 100 ? 'color:var(--bad)' : '' }, g.need == null ? (g.current >= c.target ? 'Reached' : 'Not reachable') : g.need <= 0 ? 'Already safe' : g.need > 100 ? `${g.need.toFixed(0)}% (out of reach)` : `${g.need.toFixed(1)}%`)),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Best possible'), h('div', { class: 'v' }, g.max == null ? '—' : `${g.max.toFixed(1)}%`))),
        ...(g.totalW !== 100 ? [h('p', { class: 'small', style: 'color:var(--warn, #c27c0e);margin:8px 0 0' }, `Weights add up to ${g.totalW}%, not 100%.`)] : []));
      save();
    };
    const rows = h('tbody', {});
    const drawRows = () => {
      rows.innerHTML = '';
      c.comps.forEach((k) => rows.append(h('tr', {},
        h('td', {}, h('input', { class: 'input', value: k.name, 'aria-label': 'Component', oninput: (e) => { k.name = e.target.value; save(); } })),
        h('td', { style: 'width:90px' }, h('input', { class: 'input', type: 'number', min: 0, max: 100, value: k.weight, 'aria-label': 'Weight %', oninput: (e) => { k.weight = +e.target.value; update(); } })),
        h('td', { style: 'width:90px' }, h('input', { class: 'input', type: 'number', min: 0, max: 120, value: k.score ?? '', placeholder: 'pending', 'aria-label': 'Score %', oninput: (e) => { k.score = e.target.value === '' ? null : +e.target.value; update(); } })),
        h('td', { style: 'width:36px' }, h('button', { class: 'btn ghost sm', 'aria-label': 'Remove component', onclick: () => { c.comps = c.comps.filter((x) => x !== k); drawRows(); update(); } }, '×')))));
    };
    drawRows();
    box.append(h('div', { class: 'card course' },
      h('div', { class: 'row' }, h('input', { class: 'input grow', value: c.name, style: 'font-weight:600', 'aria-label': 'Course name', oninput: (e) => { c.name = e.target.value; save(); } }),
        h('label', { class: 'row small', style: 'gap:6px' }, 'Target', h('input', { class: 'input', type: 'number', min: 0, max: 100, value: c.target, style: 'width:70px', 'aria-label': 'Target %', oninput: (e) => { c.target = +e.target.value; update(); } }), '%'),
        h('button', { class: 'btn ghost sm danger', onclick: () => { if (confirm(`Delete ${c.name}?`)) { S.courses = S.courses.filter((x) => x !== c); save(); renderCourses(); } } }, 'Delete')),
      h('table', { class: 'table', style: 'margin-top:10px' }, h('thead', {}, h('tr', {}, h('th', {}, 'Component'), h('th', {}, 'Weight %'), h('th', {}, 'Score %'), h('th', {}))), rows),
      h('button', { class: 'btn sm', style: 'margin-top:8px', onclick: () => { c.comps.push({ name: 'New item', weight: 10, score: null }); drawRows(); update(); } }, 'Add component'),
      out));
    update();
  });
}
$('#addCourse').onclick = () => { S.courses.push({ id: Date.now(), name: 'New course', target: 80, comps: [{ name: 'Coursework', weight: 40, score: null }, { name: 'Final exam', weight: 60, score: null }] }); save(); renderCourses(); };

/* ================= progress ================= */
function renderProgress() {
  const t = today(), all = allSessions(S.plan), ft = focusTotals(S.focus);
  const doneCount = all.filter((s) => S.done[s.id]).length;
  $('#progKpis').innerHTML = [['Streak', ((n) => `${n} day${n === 1 ? '' : 's'}`)(streak(doneDates(), t))], ['Sessions done', `${doneCount}/${all.length}`], ['Focus time', `${(ft.total / 60).toFixed(1)} h`], ['Quizzed topics', Object.values(S.mastery).reduce((a, m) => a + Object.keys(m).length, 0)]]
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const r = $('#ready');
  r.innerHTML = '';
  S.exams.forEach((e) => {
    const v = readiness(e, S.plan, S.done, masteryOf(e));
    r.append(h('div', { class: 'ready-row' }, h('span', {}, e.subject, h('div', { class: 'small muted' }, `${dayDiff(t, e.date)} days left`)), h('div', { class: 'bar' }, h('span', { style: `width:${v}%;background:${colorOf(e.subject)}` })), h('b', {}, v + '%')));
  });
  r.append(h('p', { class: 'small muted', style: 'margin:8px 0 0' }, 'Readiness = 60% sessions completed for that exam + 40% practice mastery (self-rated confidence until you take a quiz).'));
  const W = 560, H = 160, pb = 20, days = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
  const max = Math.max(30, ...days.map((d) => ft.byDate[d] || 0)), bw = W / 14;
  $('#focusChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Focused minutes per day">${days.map((d, i) => {
    const v = ft.byDate[d] || 0, bh = ((H - pb - 14) * v) / max;
    return `<rect x="${i * bw + 3}" y="${H - pb - bh}" width="${bw - 6}" height="${bh}" rx="3" fill="var(--accent)"><title>${short(d)}: ${v} min</title></rect>${v ? `<text x="${i * bw + bw / 2}" y="${H - pb - bh - 3}" text-anchor="middle" font-size="9" fill="var(--muted)">${v}</text>` : ''}${i % 2 ? '' : `<text x="${i * bw + bw / 2}" y="${H - 5}" text-anchor="middle" font-size="9" fill="var(--muted)">${short(d)}</text>`}`;
  }).join('')}</svg>`;
  const split = $('#subjectSplit');
  split.innerHTML = '';
  const planned = {};
  all.forEach((s) => (planned[s.subject] = (planned[s.subject] || 0) + (S.done[s.id] ? S.plan.sessMin : 0)));
  const subjects = [...new Set([...Object.keys(planned), ...Object.keys(ft.bySubject)])];
  if (!subjects.length) split.append(h('div', { class: 'empty' }, 'Tick off sessions or run the focus timer to see where your time goes.'));
  const tot = subjects.map((s) => (planned[s] || 0) + (ft.bySubject[s] || 0)), mx = Math.max(1, ...tot);
  subjects.forEach((s, i) => split.append(h('div', { class: 'ready-row' }, h('span', {}, s), h('div', { class: 'bar' }, h('span', { style: `width:${(100 * tot[i]) / mx}%;background:${colorOf(s)}` })), h('span', { class: 'small muted' }, (tot[i] / 60).toFixed(1) + 'h'))));
}

/* ================= boot ================= */
function renderAll() {
  renderPlanPage();
  renderToday();
  renderCal();
  renderProgress();
}
$('#plan').onclick = (e) => busy(e.currentTarget, buildPlan);
Router.on('today', renderToday);
Router.on('calendar', renderCal);
Router.on('practice', fillPractice);
Router.on('grades', renderCourses);
Router.on('progress', renderProgress);
renderExams();
renderAvail();
renderAll();
fillPractice();
renderCourses();
setTimer(+$('#tFocus').value * 60, 'focus');

/* ================= AI command box ================= */
const examNamed = (q) => { const s = String(q).toLowerCase(); const e = S.exams.find((x) => x.subject.toLowerCase() === s) || S.exams.find((x) => x.subject.toLowerCase().includes(s) || s.includes(x.subject.toLowerCase())); if (!e) throw new Error(`No exam like "${q}". Exams: ${S.exams.map((x) => x.subject).join(', ')}`); return e; };
const rebuild = async () => { for (const e of S.exams) await breakdown(e); schedule(!!S.plan); renderAll(); const n = S.plan ? allSessions(S.plan).length : 0; return `${n} sessions planned until ${S.exams.map((e) => e.date).sort().pop()}`; };
Copilot.register({
  context: () => `Today is ${today()} (${WD[weekday(today())]}). Exams: ${S.exams.map((e) => `${e.subject} on ${e.date} (difficulty ${e.difficulty}, confidence ${e.confidence}, topics: ${(S.topics[e.id] || []).map((t) => t.name).join(', ') || e.syllabus || 'none'})`).join('; ')}. Hours available ${WD.map((d, i) => `${d} ${S.avail[i]}`).join(', ')}. Plan: ${S.plan ? `${allSessions(S.plan).length} sessions, ${Object.keys(S.done).length} done, ${missedSessions(S.plan, S.done, today()).length} missed` : 'not built'}.`,
  actions: [
    { name: 'add_exam', description: 'Add an exam with its syllabus (replaces one with the same subject) and rebuild the plan', params: { subject: 'subject', date: 'YYYY-MM-DD', syllabus: 'topics, comma-separated', difficulty: '1-5, default 3', confidence: '1-5, default 3' },
      run: async ({ subject, date, syllabus, difficulty, confidence }) => { if (!date || date <= today()) throw new Error('The exam date must be in the future'); let e = S.exams.find((x) => x.subject.toLowerCase() === String(subject).toLowerCase()); if (!e) { e = { id: Date.now() }; S.exams.push(e); } Object.assign(e, { subject, date, syllabus: syllabus || e.syllabus || '', difficulty: +difficulty || e.difficulty || 3, confidence: +confidence || e.confidence || 3 }); delete S.topics[e.id]; save(); Router.go('plan'); renderExams(); return `Added ${subject} on ${date}. ${await rebuild()}`; } },
    { name: 'update_exam', description: 'Change an exam\'s date, difficulty, confidence or syllabus', params: { subject: 'exam', date: 'optional', difficulty: 'optional', confidence: 'optional', syllabus: 'optional' }, run: async (a) => { const e = examNamed(a.subject); ['date', 'syllabus'].forEach((k) => { if (a[k]) e[k] = a[k]; }); ['difficulty', 'confidence'].forEach((k) => { if (a[k]) e[k] = Math.max(1, Math.min(5, +a[k])); }); if (a.syllabus) delete S.topics[e.id]; save(); renderExams(); return `Updated ${e.subject}. ${await rebuild()}`; } },
    { name: 'remove_exam', description: 'Remove an exam', params: { subject: 'exam' }, run: async ({ subject }) => { const e = examNamed(subject); S.exams = S.exams.filter((x) => x !== e); save(); renderExams(); return `Removed ${e.subject}. ${S.exams.length ? await rebuild() : ''}`; } },
    { name: 'set_availability', description: 'Set study hours per day and rebuild the plan from today, keeping completed sessions', params: { weekdays: 'optional hours for Mon-Fri', weekends: 'optional hours for Sat-Sun', days: 'optional object like {"Wed": 0, "Sat": 4}', days_off: 'optional comma-separated YYYY-MM-DD dates' },
      run: async ({ weekdays, weekends, days, days_off }) => { if (weekdays != null) [1, 2, 3, 4, 5].forEach((i) => (S.avail[i] = +weekdays)); if (weekends != null) [0, 6].forEach((i) => (S.avail[i] = +weekends)); Object.entries(days || {}).forEach(([d, v]) => { const i = WD.findIndex((x) => x.toLowerCase() === String(d).slice(0, 3).toLowerCase()); if (i >= 0) S.avail[i] = +v; }); if (days_off) $('#blackout').value = days_off; save(); renderAvail(); Router.go('plan'); return `Hours: ${WD.map((d, i) => `${d} ${S.avail[i]}`).join(', ')}. ${await rebuild()}`; } },
    { name: 'build_plan', description: 'Build or rebuild the study plan', params: {}, run: async () => { Router.go('plan'); return rebuild(); } },
    { name: 'quiz', description: 'Open a practice quiz, on the weakest topic unless one is named', params: { subject: 'optional exam', topic: 'optional topic', count: '3 | 5 | 8' },
      run: async ({ subject, topic, count }) => { Router.go('practice'); fillPractice(); let e = subject ? examNamed(subject) : null, t = topic; if (!e || !t) { const cands = (e ? [e] : S.exams).flatMap((x) => topicNames(x).map((n) => ({ e: x, n, m: (S.mastery[x.id] || {})[n] ?? 0.3 }))).sort((a, b) => a.m - b.m); const pick = t ? cands.find((c) => c.n.toLowerCase().includes(String(t).toLowerCase())) || cands[0] : cands[0]; e = pick.e; t = pick.n; } $('#pSubject').value = e.id; fillTopics(); $('#pTopic').value = [...$('#pTopic').options].find((o) => o.value.toLowerCase().includes(String(t).toLowerCase()))?.value || $('#pTopic').value; if (count) $('#pCount').value = String(count); await $('#pGo').onclick({ currentTarget: $('#pGo') }); return `Quiz on ${$('#pTopic').value} (${e.subject})`; } },
    { name: 'mark_today_done', description: 'Tick off today\'s sessions (all, or those matching a subject)', params: { subject: 'optional' }, run: ({ subject }) => { const day = S.plan?.days.find((d) => d.date === today()); if (!day) throw new Error('Nothing planned today'); const ss = day.sessions.filter((s) => !subject || JSON.stringify(s).toLowerCase().includes(String(subject).toLowerCase())); ss.forEach((s) => (S.done[s.id] = today())); save(); renderAll(); return `${ss.length} sessions done`; } },
    { name: 'daily_brief', description: 'Write today\'s study brief', params: {}, run: async () => { Router.go('today'); await brief(); return $('#briefOut').innerText.slice(0, 600); } },
    { name: 'progress', query: true, description: 'Look up readiness per exam, mastery per topic, missed sessions and streak', params: {}, run: () => JSON.stringify({ today: today(), exams: S.exams.map((e) => ({ subject: e.subject, date: e.date, daysLeft: dayDiff(today(), e.date), readiness: S.plan ? readiness(e, S.plan, S.done, S.mastery[e.id] || {}) : null, mastery: S.mastery[e.id] || {} })), missed: S.plan ? missedSessions(S.plan, S.done, today()).length : 0, streak: streak(doneDates(), today()), focus: focusTotals(S.focus) }) },
  ],
});
