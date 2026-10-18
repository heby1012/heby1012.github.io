'use strict';

// ───────── 기본 단어 (구글 시트를 연결하기 전까지 사용) ─────────
const DEFAULT_CSV = `No.,Word,Meaning,Unit
1,dream,꿈,UNIT 03 To My Teacher
2,drone,드론,UNIT 03 To My Teacher
3,guitar,기타,UNIT 03 To My Teacher
4,hobby,취미,UNIT 03 To My Teacher
5,pet,반려동물,UNIT 03 To My Teacher
6,tent,텐트,UNIT 03 To My Teacher
7,apartment,아파트,UNIT 03 To My Teacher
8,camping,캠핑,UNIT 03 To My Teacher
9,live,살다,UNIT 03 To My Teacher
10,mobile game,핸드폰 게임,UNIT 03 To My Teacher
11,near,근처에,UNIT 03 To My Teacher
12,our,우리의,UNIT 03 To My Teacher
13,teach,가르치다,UNIT 03 To My Teacher
14,town,(작은) 도시,UNIT 03 To My Teacher`;

// ───────── 저장소 ─────────
const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem('wordbook.' + k);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem('wordbook.' + k, JSON.stringify(v)); } catch {}
  },
};

// ───────── CSV ─────────
const HEADERS = {
  english: ['영어', '영단어', '단어', 'english', 'word', 'words'],
  korean: ['뜻', '한글', '한국어', '의미', 'korean', 'meaning', 'meanings'],
  example: ['예문', 'example', 'sentence'],
  unit: ['단원', 'unit', 'lesson', 'day', '과'],
};

function parseRows(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 1행이 제목이면 열 이름으로 찾고, 아니면 A=영어, B=뜻, C=예문, D=단원으로 읽는다. "No." 등 다른 열은 무시.
function parseWords(text) {
  const rows = parseRows(text).filter(r => r.some(c => c.trim()));
  if (!rows.length) return [];
  const header = rows[0].map(c => c.trim().toLowerCase());
  const find = names => header.findIndex(h => names.includes(h));
  const iEng = find(HEADERS.english), iKor = find(HEADERS.korean);
  const hasHeader = iEng >= 0 || iKor >= 0;
  const cols = {
    eng: iEng >= 0 ? iEng : 0,
    kor: iKor >= 0 ? iKor : 1,
    ex: hasHeader ? find(HEADERS.example) : 2,
    unit: hasHeader ? find(HEADERS.unit) : 3,
  };
  const seen = new Set();
  const words = [];
  for (const r of rows.slice(hasHeader ? 1 : 0)) {
    const col = i => (i >= 0 && r[i] != null ? r[i].trim() : '');
    const w = { english: col(cols.eng), korean: col(cols.kor), example: col(cols.ex), unit: col(cols.unit) };
    if (!w.english || !w.korean || seen.has(keyOf(w))) continue;
    seen.add(keyOf(w));
    words.push(w);
  }
  return words;
}

// ───────── 구글 시트 ─────────
const SHARE_HELP = "시트를 열 수 없어요. 구글 시트의 [공유]에서 '링크가 있는 모든 사용자'로 바꿔 주세요.";

function toCsvUrl(input) {
  const url = input.trim();
  if (!url) return null;
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
  // [파일] → [공유] → [웹에 게시]로 만든 링크
  if (url.includes('/spreadsheets/d/e/')) {
    const base = url.split(/[?#]/)[0].replace(/\/(pubhtml|pub)?\/?$/, '');
    return `${base}/pub?output=csv${gid ? '&gid=' + gid : ''}`;
  }
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const id = m ? m[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(url) ? url : null);
  if (!id) return null;
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1${gid ? '&gid=' + gid : ''}`;
}

async function importSheet(url) {
  const csvUrl = toCsvUrl(url);
  if (!csvUrl) throw new Error('구글 시트 링크가 올바르지 않아요.');
  let res;
  try {
    res = await fetch(csvUrl, { cache: 'no-store' });
  } catch {
    throw new Error('시트를 열 수 없어요. 인터넷 연결과 공유 설정(링크가 있는 모든 사용자)을 확인해 주세요.');
  }
  if ([401, 403, 404].includes(res.status)) throw new Error(SHARE_HELP);
  if (!res.ok) throw new Error(`시트를 불러오지 못했어요. (오류 ${res.status})`);
  const text = await res.text();
  // 공유가 안 된 시트는 CSV 대신 로그인 페이지(HTML)가 온다
  if (/^\s*</.test(text)) throw new Error(SHARE_HELP);
  const words = parseWords(text);
  if (!words.length) throw new Error('시트에서 단어를 찾지 못했어요. 1행에 Word, Meaning 제목을 적어 주세요.');

  state.words = words;
  state.sheetUrl = url.trim();
  if (state.unit && !units().includes(state.unit)) setUnit(null);
  store.set('words', words);
  store.set('sheetUrl', state.sheetUrl);
  return words.length;
}

// ───────── 상태 ─────────
// 같은 단어가 여러 단원에 나올 수 있어서 단원까지 묶어서 구분한다
const keyOf = w => `${w.unit}|${w.english}`.trim().toLowerCase();

const state = {
  words: store.get('words', null) || parseWords(DEFAULT_CSV),
  stars: new Set(store.get('stars', [])),
  wrong: new Set(store.get('wrong', [])),
  unit: store.get('unit', null),
  sheetUrl: store.get('sheetUrl', ''),
  screen: 'home',
  src: 'all',
};

const LABEL = { all: '단어', starred: '별표 단어', wrong: '오답 노트' };

function units() {
  return [...new Set(state.words.map(w => w.unit).filter(Boolean))];
}

function setUnit(u) {
  state.unit = u;
  store.set('unit', u);
}

function wordsFor(src) {
  if (src === 'starred') return state.words.filter(w => state.stars.has(keyOf(w)));
  if (src === 'wrong') return state.words.filter(w => state.wrong.has(keyOf(w)));
  return state.unit ? state.words.filter(w => w.unit === state.unit) : state.words;
}

function toggleStar(key) {
  state.stars.has(key) ? state.stars.delete(key) : state.stars.add(key);
  store.set('stars', [...state.stars]);
}

function markWrong(w) {
  state.wrong.add(keyOf(w));
  store.set('wrong', [...state.wrong]);
}

// 맞히면 오답 노트에서 빠진다
function markRight(w) {
  if (state.wrong.delete(keyOf(w))) store.set('wrong', [...state.wrong]);
}

// ───────── 발음 ─────────
let voice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  voice = voices.find(v => v.lang === 'en-US') || voices.find(v => v.lang.startsWith('en')) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (voice) u.voice = voice;
  u.rate = 0.85;
  speechSynthesis.speak(u);
}

// ───────── 화면 조각 ─────────
const $app = document.getElementById('app');

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const svg = d => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  back: svg('M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z'),
  gear: svg('M19.14 12.94a7.07 7.07 0 0 0 .06-.94 7.07 7.07 0 0 0-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.48.48 0 0 0 13.92 2h-3.84a.48.48 0 0 0-.48.41l-.36 2.54a7.37 7.37 0 0 0-1.63.94l-2.39-.96a.49.49 0 0 0-.59.22L2.71 8.47a.48.48 0 0 0 .12.61l2.03 1.58a7.4 7.4 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54a7.03 7.03 0 0 0 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z'),
  speak: svg('M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z'),
  star: svg('M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z'),
  starBorder: svg('m22 9.24-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z'),
  shuffle: svg('M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z'),
  check: svg('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'),
};

function header(title, { back = true, right = '' } = {}) {
  return `<header class="bar">
    ${back ? `<button class="icon" data-act="back" aria-label="뒤로">${ICON.back}</button>` : ''}
    <h1>${esc(title)}</h1>
    <div class="right">${right}</div>
  </header>`;
}

const speakBtn = text =>
  `<button class="icon speak" data-act="speak" data-text="${esc(text)}" aria-label="발음 듣기">${ICON.speak}</button>`;

const starBtn = key => {
  const on = state.stars.has(key);
  return `<button class="icon star ${on ? 'on' : ''}" data-act="star" data-key="${esc(key)}" aria-label="${on ? '별표 빼기' : '별표 하기'}">${on ? ICON.star : ICON.starBorder}</button>`;
};

const empty = text => `<div class="empty">${esc(text)}</div>`;

// ───────── 홈 ─────────
function renderHome() {
  const us = units();
  const chip = (u, label) =>
    `<button class="chip ${state.unit === u ? 'on' : ''}" data-act="unit" data-unit="${esc(u ?? '')}">${esc(label)}</button>`;
  const menu = (emoji, title, sub, color, href) =>
    `<button class="menu" style="background:${color}" data-act="nav" data-href="${href}">
      <span class="emoji">${emoji}</span><span><b>${title}</b><small>${esc(sub)}</small></span>
    </button>`;

  $app.innerHTML = header('초3 영어 단어장', {
    back: false,
    right: `<button class="icon" data-act="nav" data-href="#/settings" aria-label="단어 불러오기">${ICON.gear}</button>`,
  }) + `<main>
    ${us.length ? `<div class="label">단원 고르기</div>
      <div class="chips">${chip(null, '전체')}${us.map(u => chip(u, u)).join('')}</div>` : ''}
    <div class="count">공부할 단어 ${wordsFor('all').length}개</div>
    ${menu('📖', '카드 학습', '카드를 넘기며 단어 외우기', '#FFCC80', '#/cards/all')}
    ${menu('✏️', '퀴즈', '뜻 맞히기 10문제', '#90CAF9', '#/quiz/all')}
    ${menu('📋', '단어 목록', '단어를 한눈에 보기', '#A5D6A7', '#/list/all')}
    ${menu('⭐', '별표 단어', `${wordsFor('starred').length}개`, '#FFF59D', '#/list/starred')}
    ${menu('❌', '오답 노트', `틀린 단어 ${wordsFor('wrong').length}개`, '#EF9A9A', '#/list/wrong')}
  </main>`;
}

// ───────── 카드 학습 ─────────
let cards = null;

function startCards(src) {
  // 공부 중에 별표를 빼도 카드가 사라지지 않게 처음 목록을 고정한다
  const base = wordsFor(src);
  cards = { src, base, list: base, i: 0, flipped: false, shuffled: false };
  renderCards();
  if (base.length) speak(base[0].english);
}

function renderCards() {
  const c = cards;
  const right = `<button class="icon toggle ${c.shuffled ? 'on' : ''}" data-act="shuffle" aria-label="섞기">${ICON.shuffle}</button>`;
  if (!c.list.length) {
    $app.innerHTML = header(`${LABEL[c.src]} 카드`, { right }) + empty('공부할 단어가 없어요.');
    return;
  }
  const w = c.list[c.i];
  const key = keyOf(w);
  const tools = `<div class="tools">${speakBtn(w.english)}${starBtn(key)}</div>`;
  $app.innerHTML = header(`${LABEL[c.src]} 카드`, { right }) + `<main class="cards">
    <div class="progress-text">${c.i + 1} / ${c.list.length}</div>
    <div class="progress"><div style="width:${((c.i + 1) / c.list.length) * 100}%"></div></div>
    <div class="card-wrap" id="swipe">
      <div class="flip ${c.flipped ? 'flipped' : ''}" data-act="flip">
        <div class="face front">${tools}
          <div class="word-big">${esc(w.english)}</div>
          <div class="hint">눌러서 뜻 보기 👆</div>
        </div>
        <div class="face back">${tools}
          <div class="meaning">${esc(w.korean)}</div>
          <div class="sub">${esc(w.english)}</div>
          ${w.example ? `<div class="example">${esc(w.example)}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="row">
      <button class="btn outline" data-act="prev" ${c.i === 0 ? 'disabled' : ''}>◀ 이전</button>
      <button class="btn" data-act="next" ${c.i === c.list.length - 1 ? 'disabled' : ''}>다음 ▶</button>
    </div>
  </main>`;

  // 좌우로 밀어서 넘기기
  const area = document.getElementById('swipe');
  let sx = 0, sy = 0;
  area.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  area.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) moveCard(dx < 0 ? 1 : -1);
  });
}

function moveCard(step) {
  const c = cards;
  const i = c.i + step;
  if (i < 0 || i >= c.list.length) return;
  c.i = i;
  c.flipped = false;
  renderCards();
  speak(c.list[i].english);
}

// ───────── 퀴즈 ─────────
let quiz = null;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeQuestions(pool, all, count = 10) {
  const distractorPool = pool.length >= 4 ? pool : all;
  return shuffle(pool).slice(0, count).map(w => {
    const askEnglish = Math.random() < 0.5; // true: 영어 보고 뜻 고르기, false: 뜻 보고 영어 고르기
    const text = x => (askEnglish ? x.korean : x.english);
    const correct = text(w);
    // 영어나 뜻이 같은 단어(color/paint = 색칠하다 등)는 오답 보기에서 뺀다
    const same = x => x.korean === w.korean || x.english.toLowerCase() === w.english.toLowerCase();
    const wrongs = shuffle([...new Set(distractorPool.filter(x => !same(x)).map(text))]).slice(0, 3);
    const choices = shuffle([...wrongs, correct]);
    return { word: w, askEnglish, choices, answer: choices.indexOf(correct) };
  });
}

function startQuiz(src) {
  quiz = { src, questions: makeQuestions(wordsFor(src), state.words), i: 0, selected: null, score: 0 };
  renderQuiz();
}

function renderQuiz() {
  const z = quiz;
  const top = header(`${LABEL[z.src]} 퀴즈`);
  if (!z.questions.length) {
    $app.innerHTML = top + empty('퀴즈를 낼 단어가 없어요.');
    return;
  }
  const total = z.questions.length;
  if (z.i >= total) {
    const ratio = z.score / total;
    const [emoji, cheer] =
      z.score === total ? ['🏆', '모두 맞았어요! 최고예요!'] :
      ratio >= 0.8 ? ['🌟', '아주 잘했어요!'] :
      ratio >= 0.5 ? ['👍', '잘했어요! 조금만 더 연습해요.'] :
      ['💪', '괜찮아요! 오답 노트로 다시 연습해요.'];
    $app.innerHTML = top + `<main><div class="result">
      <div class="emoji">${emoji}</div>
      <h2>${total}문제 중 ${z.score}개 맞았어요!</h2>
      <p>${cheer}</p>
      <button class="btn" data-act="retry">다시 하기</button>
      <button class="btn outline" data-act="nav" data-href="#/">처음으로</button>
    </div></main>`;
    return;
  }

  const q = z.questions[z.i];
  const answered = z.selected != null;
  const choices = q.choices.map((c, i) => {
    const cls = !answered ? '' : i === q.answer ? 'correct' : i === z.selected ? 'wrong' : '';
    return `<button class="choice ${cls}" data-act="choice" data-i="${i}">${esc(c)}</button>`;
  }).join('');
  const right = z.selected === q.answer;

  $app.innerHTML = top + `<main>
    <div class="progress-text">${z.i + 1} / ${total}</div>
    <div class="progress"><div style="width:${((z.i + 1) / total) * 100}%"></div></div>
    <div class="question">
      <div class="ask">${q.askEnglish ? '이 단어의 뜻은?' : '이 뜻의 영어 단어는?'}</div>
      <div class="prompt"><span>${esc(q.askEnglish ? q.word.english : q.word.korean)}</span>
        ${q.askEnglish ? speakBtn(q.word.english) : ''}</div>
    </div>
    ${choices}
    ${answered ? `
      <div class="feedback ${right ? 'ok' : 'no'}">${right ? '정답이에요! 🎉' : `아쉬워요! 정답은 '${esc(q.choices[q.answer])}' 이에요.`}</div>
      <button class="btn block" data-act="qnext">${z.i + 1 < total ? '다음 문제 ▶' : '결과 보기'}</button>` : ''}
  </main>`;
}

function chooseAnswer(i) {
  const z = quiz;
  if (z.selected != null) return;
  const q = z.questions[z.i];
  z.selected = i;
  if (i === q.answer) {
    z.score++;
    markRight(q.word);
  } else {
    markWrong(q.word);
  }
  if (!q.askEnglish) speak(q.word.english);
  renderQuiz();
  document.querySelector('[data-act="qnext"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function nextQuestion() {
  quiz.i++;
  quiz.selected = null;
  renderQuiz();
  window.scrollTo(0, 0);
  const q = quiz.questions[quiz.i];
  if (q?.askEnglish) speak(q.word.english);
}

// ───────── 단어 목록 ─────────
function renderList(src) {
  const list = wordsFor(src);
  const title = src === 'all' ? (state.unit || '전체 단어') : LABEL[src];
  if (!list.length) {
    const msg = {
      starred: '별표한 단어가 없어요.\n카드나 목록에서 ☆를 눌러 보세요!',
      wrong: '틀린 단어가 없어요.\n정말 잘했어요! 🎉',
      all: '단어가 없어요.',
    }[src];
    $app.innerHTML = header(title) + empty(msg);
    return;
  }
  $app.innerHTML = header(title) + `<main>
    <div class="row">
      <button class="btn small" data-act="nav" data-href="#/cards/${src}">📖 카드 학습</button>
      <button class="btn small" data-act="nav" data-href="#/quiz/${src}">✏️ 퀴즈</button>
    </div>
    <div class="list">${list.map(w => `
      <div class="item">
        <div class="text"><b>${esc(w.english)}</b><span>${esc(w.korean)}</span></div>
        ${speakBtn(w.english)}${starBtn(keyOf(w))}
        ${src === 'wrong' ? `<button class="icon learned" data-act="learned" data-key="${esc(keyOf(w))}" aria-label="외웠어요">${ICON.check}</button>` : ''}
      </div>`).join('')}
    </div>
  </main>`;
}

// ───────── 단어 불러오기 ─────────
let settingsMsg = null; // { text, ok }
let loading = false;

function renderSettings() {
  const draft = document.getElementById('sheet')?.value ?? state.sheetUrl;
  const same = draft.trim() && draft.trim() === state.sheetUrl;
  $app.innerHTML = header('단어 불러오기') + `<main>
    <div class="label">구글 시트에서 단어 가져오기</div>
    <div class="box">
      <ol>
        <li>1행에 제목을 적어요: <b>Word | Meaning | Unit</b><br>(영어 | 뜻 | 단원 | 예문 도 돼요. No. 열은 있어도 괜찮아요)</li>
        <li>2행부터 단어를 적어요. 단원·예문은 비워도 돼요.</li>
        <li>[공유] → 일반 액세스를 <b>'링크가 있는 모든 사용자'</b>로 바꿔요.</li>
        <li>링크를 복사해서 아래에 붙여 넣어요.</li>
      </ol>
      <div class="note">※ 탭이 여러 개면, 원하는 탭을 연 상태에서 주소창의 링크를 복사하세요.<br>※ 연결해 두면 앱을 열 때마다 시트의 새 단어를 자동으로 받아 와요.</div>
    </div>
    <label class="field">구글 시트 링크
      <textarea id="sheet" placeholder="https://docs.google.com/spreadsheets/d/...">${esc(draft)}</textarea>
    </label>
    <button class="btn block" data-act="load" ${loading ? 'disabled' : ''}>${loading ? '불러오는 중…' : same ? '다시 불러오기' : '불러오기'}</button>
    ${settingsMsg ? `<div class="msg ${settingsMsg.ok ? 'ok' : 'err'}">${esc(settingsMsg.text)}</div>` : ''}
    <div class="info">지금 단어 ${state.words.length}개 · 단원 ${units().length}개</div>
    <hr>
    <button class="btn outline block" data-act="reset">기본 단어로 되돌리기</button>
  </main>`;
}

async function loadFromSettings() {
  const url = document.getElementById('sheet').value;
  if (!url.trim()) return;
  loading = true;
  settingsMsg = null;
  renderSettings();
  try {
    const n = await importSheet(url);
    settingsMsg = { text: `단어 ${n}개를 불러왔어요! 🎉`, ok: true };
  } catch (e) {
    settingsMsg = { text: e.message, ok: false };
  }
  loading = false;
  if (state.screen === 'settings') renderSettings();
}

function resetWords() {
  if (!confirm('기본 단어로 되돌릴까요?\n시트 연결이 풀리고, 별표와 오답 기록은 그대로 남아요.')) return;
  state.words = parseWords(DEFAULT_CSV);
  state.sheetUrl = '';
  setUnit(null);
  store.set('words', null);
  store.set('sheetUrl', '');
  const box = document.getElementById('sheet');
  if (box) box.value = '';
  settingsMsg = { text: '기본 단어로 되돌렸어요.', ok: true };
  renderSettings();
}

// ───────── 화면 이동 ─────────
function route() {
  const [, screen = '', src = 'all'] = location.hash.replace(/^#/, '').split('/');
  const s = LABEL[src] ? src : 'all';
  state.screen = screen || 'home';
  state.src = s;
  if (screen !== 'settings') settingsMsg = null;
  if (screen === 'cards') startCards(s);
  else if (screen === 'quiz') startQuiz(s);
  else if (screen === 'list') renderList(s);
  else if (screen === 'settings') renderSettings();
  else { state.screen = 'home'; renderHome(); }
  window.scrollTo(0, 0);
}

const actions = {
  back: () => history.back(),
  nav: el => { location.hash = el.dataset.href; },
  speak: el => speak(el.dataset.text),
  star: el => {
    toggleStar(el.dataset.key);
    if (state.screen === 'list') renderList(state.src);
    else document.querySelectorAll(`[data-act="star"][data-key="${CSS.escape(el.dataset.key)}"]`)
      .forEach(b => { b.outerHTML = starBtn(el.dataset.key); });
  },
  learned: el => {
    state.wrong.delete(el.dataset.key);
    store.set('wrong', [...state.wrong]);
    renderList(state.src);
  },
  unit: el => { setUnit(el.dataset.unit || null); renderHome(); },
  flip: el => { cards.flipped = !cards.flipped; el.classList.toggle('flipped', cards.flipped); },
  prev: () => moveCard(-1),
  next: () => moveCard(1),
  shuffle: () => {
    const c = cards;
    c.shuffled = !c.shuffled;
    c.list = c.shuffled ? shuffle(c.base) : c.base;
    c.i = 0;
    c.flipped = false;
    renderCards();
    if (c.list.length) speak(c.list[0].english);
  },
  choice: el => chooseAnswer(Number(el.dataset.i)),
  qnext: () => nextQuestion(),
  retry: () => startQuiz(quiz.src),
  load: () => loadFromSettings(),
  reset: () => resetWords(),
};

$app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) actions[el.dataset.act]?.(el, e);
});

window.addEventListener('hashchange', route);

// 다른 화면 주소로 바로 열어도 '뒤로'를 누르면 홈으로 가게 한다
if (location.hash && location.hash !== '#/') {
  const target = location.hash;
  history.replaceState(null, '', '#/');
  history.pushState(null, '', target);
}
route();

// 시트가 연결돼 있으면 열 때마다 새 단어를 받아 온다
if (state.sheetUrl) {
  importSheet(state.sheetUrl)
    .then(() => { if (state.screen === 'home') renderHome(); })
    .catch(() => {});
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
