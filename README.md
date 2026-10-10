# study-planner

[![tests](https://github.com/dguywhoknows/study-planner/actions/workflows/tests.yml/badge.svg)](https://github.com/dguywhoknows/study-planner/actions/workflows/tests.yml)

AI breaks your syllabus into topics; a spaced-repetition scheduler turns them into a realistic study calendar you can export to Google or Apple Calendar.

Live: https://dguywhoknows.github.io/study-planner/

## Overview

Enter your exams (date, difficulty, how confident you feel, optional syllabus) and your free hours per weekday. The AI splits each subject into topics with study-hour estimates and tips. A constraint-based scheduler then fills your calendar day by day, ranking sessions by urgency (slack until deadline) × weight (difficulty × lack of confidence). It interleaves subjects, unlocks spaced reviews 2 and 6 days after you finish a topic, and reserves a mock exam and final review before each test. If you don't have enough time, it tells you exactly how many hours you're short.

## Pages

- **Plan**
- **Today**
- **Calendar**
- **Practice**
- **Grades**
- **Progress**
- **Settings**

## Features

- Exam editor with difficulty/confidence sliders and optional syllabus
- AI topic breakdown with hour estimates and study tips (editable)
- Greedy constraint scheduler: urgency × weight priority, subject interleaving, sequential learning units
- Spaced repetition: automatic reviews at +2 and +6 days, mock exam and final review before each test
- Capacity, days off and overflow warnings with hour shortfall per subject
- Stacked daily-load chart, weekly calendar, click-to-complete sessions
- iCalendar (.ics) export and an AI 'today's brief' coach
- Replan from today: completed sessions are kept and missed ones are redistributed across the remaining days
- Today page: checklist of today's sessions, missed-session alert, AI daily brief and a study streak
- Focus timer with configurable focus/break lengths, a chime, and a per-subject focus log
- Calendar page: week view with click-to-complete sessions and an exam countdown with readiness per exam
- Practice page: AI-generated questions per topic with reveal-and-self-grade; grades update topic mastery
- Grades page: weighted grade calculator per course showing current grade, the score needed on remaining work for a target, and the best possible outcome
- Progress page: readiness per exam (sessions completed + mastery), focus minutes for the last 14 days and time by subject

## How it works

LLM calls are used for:

- Syllabus → topics + hour estimates + tips (JSON)
- Daily brief that pairs each session with a concrete study technique

Everything else (scheduling, spaced repetition, capacity planning, charts, calendar, .ics generation) runs locally in the browser.

## Getting started

No build step and no dependencies. Serve the folder with any static server:

```bash
git clone https://github.com/dguywhoknows/study-planner.git
cd study-planner
python -m http.server 8000
```

Then open http://localhost:8000.

`index.html` is the public home page, `login.html` handles accounts and `app.html` is the app.

### Telling the app what to do

Every page has an **Ask AI** box (Ctrl/Cmd+K). Type a request in plain words and the model plans a sequence of
calls to the app's own functions, runs them and reports back. The **Instructions** tab stores standing
preferences that are added to every AI request the app makes.

### Configuration

`src/lib/config.js` is generated from the build settings: the Supabase project (accounts) and the AI proxy URL.
Signed-in users get the built-in AI through the proxy, which keeps the provider key as a server-side secret.
Without those settings the app runs for guests, in demo mode, or with a personal [Groq](https://console.groq.com/keys)
or [OpenRouter](https://openrouter.ai/keys) key entered under **Settings → Model provider** (stored only in this
browser and sent only to that provider).

## Testing

`src/core.js` holds the app's logic as pure functions and is covered by 11 unit tests.

```bash
node tests/run-node.js        # CI runs this on every push
```

Or open `tests/index.html` in a browser ([live](https://dguywhoknows.github.io/study-planner/tests/)).

## Project structure

```
index.html           public home page (generated)
login.html           sign-in and sign-up (generated)
app.html             the app: markup for every page
src/app.js           UI, page wiring and event handlers
src/core.js          pure logic with no DOM access (unit-tested)
src/lib/ai.js        LLM client: Groq / OpenRouter, streaming, JSON mode, retries
src/lib/dom.js       DOM helpers, namespaced storage, markdown renderer
src/lib/router.js    hash router and the Settings page
src/lib/copilot.js   AI command box that drives the app's own functions
src/lib/auth.js      accounts (Supabase Auth) and the sign-in gate
styles/base.css      design tokens and shared components
styles/app.css       app-specific styles
tests/               unit tests (browser runner + Node runner for CI)
```

## Tech

- Priority-based constraint scheduler
- RFC 5545 iCalendar writer
- UTC-safe date math
- Pure scheduler, readiness, streak and grade maths in src/core.js covered by unit tests run in the browser and in CI
- Vanilla JavaScript, no framework or bundler
- Deployed with GitHub Pages

## License

MIT
