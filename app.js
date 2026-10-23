'use strict';

// index.html 의 <script data-version> 값. 휴대폰이 최신 버전인지 설정 화면에서 확인할 수 있다
const APP_VERSION = document.querySelector('script[data-version]')?.dataset.version || '';

// 기본 단어는 같은 폴더의 words.csv 에서 읽는다 (구글 시트를 연결하면 시트 단어를 대신 쓴다)
const BUILTIN_CSV = 'words.csv';

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
  // 지난번에 받아 둔 단어로 먼저 그리고, 새 단어는 아래에서 받아 온다
  words: store.get(store.get('sheetUrl', '') ? 'words' : 'builtinWords', null) || [],
  stars: new Set(store.get('stars', [])),
  wrong: new Set(store.get('wrong', [])),
  unit: store.get('unit', null),
  sheetUrl: store.get('sheetUrl', ''),
  screen: 'home',
  src: 'all',
};

const LABEL = { all: '단어', starred: '별표 단어', wrong: '오답 노트' };

async function loadBuiltin() {
  const res = await fetch(`${BUILTIN_CSV}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`단어 파일을 불러오지 못했어요. (오류 ${res.status})`);
  const words = parseWords(await res.text());
  state.words = words;
  if (state.unit && !units().includes(state.unit)) setUnit(null);
  store.set('builtinWords', words);
}

// 단어가 바뀌면 공부 중인 카드·퀴즈는 그대로 두고, 목록 화면만 다시 그린다
function refreshView() {
  if (state.screen === 'home') renderHome();
  else if (state.screen === 'list') renderList(state.src);
  else if (state.screen === 'settings') renderSettings();
}

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
let utterance = null; // 크롬이 말하는 도중에 지워 버리지 않게 붙잡아 둔다

// 안드로이드는 언어 코드가 en_US 처럼 올 때도 있다
const isEnglish = v => /^en[-_]/i.test(v.lang);
const isUS = v => /^en[-_]us$/i.test(v.lang);

function pickVoice() {
  const en = speechSynthesis.getVoices().filter(isEnglish);
  // 기기에 들어 있는(인터넷 없이 되는) 미국 영어 음성을 먼저 고른다
  voice = en.find(v => isUS(v) && v.localService) || en.find(isUS) || en.find(v => v.localService) || en[0] || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const say = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice ? voice.lang.replace('_', '-') : 'en-US';
    if (voice) u.voice = voice;
    u.rate = 0.85;
    u.volume = 1;
    utterance = u;
    speechSynthesis.speak(u);
    if (speechSynthesis.paused) speechSynthesis.resume();
  };
  // 말하는 중에 cancel 하고 바로 speak 하면 안드로이드 크롬이 새 말을 버릴 때가 있다
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    setTimeout(say, 100);
  } else {
    say();
  }
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

// 카카오톡 등 앱 안의 브라우저는 발음 기능이 없어서 크롬으로 열도록 안내한다
const inKakao = /KAKAOTALK/i.test(navigator.userAgent);
const inAppBrowser = inKakao || /; wv\)|NAVER|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);

function openInChrome() {
  const url = location.href.split('#')[0];
  location.href = inKakao
    ? 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url)
    : `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;
}

const chromeBanner = () => inAppBrowser || !('speechSynthesis' in window)
  ? `<div class="banner">
      <b>🔇 여기서는 발음 소리가 안 나요</b>
      <span>${inKakao ? '카카오톡' : '앱'} 안에서 열려서 그래요. 크롬으로 열면 소리가 나요.</span>
      <button class="btn small" data-act="openChrome">크롬으로 열기</button>
    </div>`
  : '';

// ───────── 홈 ─────────
function renderHome() {
  const us = units();
  const option = (u, label, n) =>
    `<option value="${esc(u)}" ${(state.unit || '') === u ? 'selected' : ''}>${esc(label)} (${n}개)</option>`;
  const menu = (emoji, title, sub, color, href) =>
    `<button class="menu" style="background:${color}" data-act="nav" data-href="${href}">
      <span class="emoji">${emoji}</span><span><b>${title}</b><small>${esc(sub)}</small></span>
    </button>`;

  $app.innerHTML = header('초3 영어 단어장', {
    back: false,
    right: `<button class="icon" data-act="nav" data-href="#/settings" aria-label="단어 불러오기">${ICON.gear}</button>`,
  }) + `<main>
    ${chromeBanner()}
    ${us.length ? `<label class="unit-pick"><span>단원</span>
      <select id="unit">
        ${option('', '전체', state.words.length)}
        ${us.map(u => option(u, u, state.words.filter(w => w.unit === u).length)).join('')}
      </select></label>` : ''}
    ${menu('📖', '카드 학습', '카드를 넘기며 단어 외우기', '#FFCC80', '#/cards/all')}
    ${menu('✏️', '퀴즈', '뜻 맞히기 10문제', '#90CAF9', '#/quiz/all')}
    ${menu('📋', '단어 목록', '단어를 한눈에 보기', '#A5D6A7', '#/list/all')}
    ${menu('⭐', '별표 단어', `${wordsFor('starred').length}개`, '#FFF59D', '#/list/starred')}
    ${menu('❌', '오답 노트', `틀린 단어 ${wordsFor('wrong').length}개`, '#EF9A9A', '#/list/wrong')}
    ${menu('🎧', 'Shadowing', '영상 보며 문장 따라 말하기', '#CE93D8', '#/shadow')}
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
    <div class="label">구글 시트에서 단어 가져오기 (선택)</div>
    <div class="info">시트를 연결하지 않으면 웹사이트에 들어 있는 단어를 써요.</div>
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
    <div class="info" style="text-align:center">버전 ${esc(APP_VERSION)}</div>
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

async function resetWords() {
  if (!confirm('기본 단어로 되돌릴까요?\n시트 연결이 풀리고, 별표와 오답 기록은 그대로 남아요.')) return;
  state.sheetUrl = '';
  store.set('words', null);
  store.set('sheetUrl', '');
  const box = document.getElementById('sheet');
  if (box) box.value = '';
  try {
    await loadBuiltin();
    settingsMsg = { text: '기본 단어로 되돌렸어요.', ok: true };
  } catch (e) {
    settingsMsg = { text: e.message, ok: false };
  }
  refreshView();
}

// ───────── Shadowing ─────────
// shadowing.json 에는 영상 id 와 문장별 [시작, 끝] 초만 들어 있다. 문장 글자는 영상 화면과 YouTube 자막으로 본다.
let shadowVideos = null;
let sh = null; // 지금 열려 있는 쉐도잉 화면의 상태
let ytApi = null;

const fmtTime = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

async function loadShadowVideos() {
  if (!shadowVideos) {
    // GitHub Pages 가 최대 10분 캐시하므로 주소를 바꿔서 항상 새 파일을 받는다
    const res = await fetch(`shadowing.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`영상 목록을 불러오지 못했어요. (오류 ${res.status})`);
    shadowVideos = await res.json();
  }
  return shadowVideos;
}

function loadYouTubeApi() {
  if (!ytApi) {
    ytApi = new Promise(resolve => {
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytApi;
}

async function renderShadowList() {
  $app.innerHTML = header('Shadowing') + empty('불러오는 중…');
  let videos;
  try {
    videos = await loadShadowVideos();
  } catch (e) {
    $app.innerHTML = header('Shadowing') + empty(e.message);
    return;
  }
  if (location.hash !== '#/shadow') return; // 그 사이에 다른 화면으로 나갔다
  $app.innerHTML = header('Shadowing') + `<main>
    <div class="info">영상을 한 문장씩 듣고 바로 따라 말해 보세요.</div>
    ${videos.map(v => `
      <button class="video-card" data-act="nav" data-href="#/shadow/${esc(v.id)}">
        <img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" loading="lazy">
        <span><b>${esc(v.title)}</b><small>${esc(v.level || '')} · ${v.segments.length}문장</small></span>
      </button>`).join('')}
  </main>`;
}

async function startShadow(id) {
  let video;
  try {
    video = (await loadShadowVideos()).find(v => v.id === id);
  } catch (e) {
    $app.innerHTML = header('Shadowing') + empty(e.message);
    return;
  }
  if (!video) {
    $app.innerHTML = header('Shadowing') + empty('영상을 찾지 못했어요.');
    return;
  }
  sh = {
    video, i: 0, player: null, playing: false, left: 0, timer: null, wait: null,
    opts: { rate: 1, repeat: 1, auto: true, ...store.get('shadowOpts', {}) },
    recorder: null, recIndex: null, // 지금 녹음 중인 문장 번호
    recs: new Map(), // 문장 번호 → 내 녹음(Blob)
    audio: null, exporting: false,
    loop: false, // 문장 목록에서 누른 문장을 계속 반복하는 중
    texts: [],
    lockMsg: '',
  };
  $app.innerHTML = header(video.title) + `<main class="shadow">
    <div class="video-box"><div id="yt"></div></div>
    <div id="sh-panel"></div>
  </main>`;
  renderShadowPanel();
  loadRecordings(video);
  // 이 기기에서 전에 맞힌 비밀번호가 있으면 문장 글자를 바로 연다
  if (video.enc && store.get('shadowPass', '')) unlockShadow(store.get('shadowPass', ''), { silent: true });

  const YT = await loadYouTubeApi();
  if (!sh || sh.video !== video) return; // 그 사이에 다른 화면으로 나갔다
  sh.player = new YT.Player('yt', {
    videoId: video.id,
    playerVars: { playsinline: 1, rel: 0, cc_load_policy: 1, cc_lang_pref: 'en', hl: 'ko' },
    events: {
      onReady: () => sh?.player?.setPlaybackRate(sh.opts.rate),
    },
  });
}

function renderShadowPanel() {
  const panel = document.getElementById('sh-panel');
  if (!sh || !panel) return;
  const { video, i, opts } = sh;
  const n = video.segments.length;
  const [s, e] = video.segments[i];
  const recording = sh.recorder?.state === 'recording';
  const opt = (act, v, label, on) => `<button class="opt ${on ? 'on' : ''}" data-act="${act}" data-v="${v}">${label}</button>`;
  const text = k => sh.texts[k] || '';

  const locked = video.enc && !sh.texts.length;
  const typed = document.getElementById('sh-pass')?.value || ''; // 재생 중 다시 그려도 입력 중인 비밀번호를 지키기

  panel.innerHTML = `
    <div class="progress-text">문장 ${i + 1} / ${n} <small>${fmtTime(s)} – ${fmtTime(e)}</small></div>
    <div class="progress"><div style="width:${((i + 1) / n) * 100}%"></div></div>
    ${text(i) ? `<div class="sh-now">${esc(text(i))}</div>` : ''}
    <div class="sh-controls">
      <button class="round" data-act="shPrev" ${i === 0 ? 'disabled' : ''} aria-label="이전 문장">⏮</button>
      <button class="round" data-act="shReplay" aria-label="다시 듣기">🔁</button>
      <button class="round big" data-act="shPlay" aria-label="${sh.playing ? '멈추기' : '듣기'}">${sh.playing ? '⏸' : '▶'}</button>
      <button class="round" data-act="shNext" ${i === n - 1 ? 'disabled' : ''} aria-label="다음 문장">⏭</button>
    </div>
    <div class="rec-row">
      <button class="btn ${recording && sh.recIndex === i ? 'rec-on' : ''}" data-act="shRec" data-i="${i}">${recording && sh.recIndex === i ? '⏹ 녹음 끝내기' : '🎤 이 문장 녹음'}</button>
      <button class="btn outline" data-act="shMine" data-i="${i}" ${sh.recs.has(i) && !recording ? '' : 'disabled'}>🔊 내 목소리</button>
    </div>
    <div class="opts">
      <span>속도</span>${[0.5, 0.75, 1].map(v => opt('shRate', v, v + 'x', opts.rate === v)).join('')}
    </div>
    <div class="opts">
      <span>반복</span>${[1, 2, 3].map(v => opt('shRepeat', v, v + '번', opts.repeat === v)).join('')}
      <button class="opt ${opts.auto ? 'on' : ''}" data-act="shAuto">자동 넘김</button>
    </div>
    <div class="label">${n} 문장</div>
    ${locked ? `<form class="lock" data-form="unlock">
      <b>🔒 비밀번호를 넣으면 문장 글자가 보여요</b>
      <div class="row">
        <input id="sh-pass" type="password" inputmode="numeric" autocomplete="off" placeholder="비밀번호" value="${esc(typed)}">
        <button class="btn small" type="submit">확인</button>
      </div>
      ${sh.lockMsg ? `<div class="msg err">${esc(sh.lockMsg)}</div>` : ''}
    </form>` : ''}
    <div class="rec-sum">
      <div><b>🎤 내 녹음 ${sh.recs.size} / ${n}</b>
        <span>${sh.recs.size === n ? '모두 녹음했어요! 🎉' : `${n - sh.recs.size}문장 남았어요`}</span></div>
      <button class="btn small block" data-act="shExport" ${sh.recs.size === n && !sh.exporting && !recording ? '' : 'disabled'}>
        ${sh.exporting ? '파일 만드는 중…' : '⬇️ 전체 녹음 내려받기'}</button>
      ${sh.recs.size ? '<button class="link" data-act="shRecClear">녹음 모두 지우기</button>' : ''}
    </div>
    <div class="info">문장을 누르면 그 문장만 계속 반복해요. 🎤를 누르면 녹음, 한 번 더 누르면 끝나요.</div>
    <div class="sent-list">${video.segments.map(([a], k) => {
      const looping = sh.loop && sh.playing && k === i;
      const recNow = recording && sh.recIndex === k;
      return `<div class="sent ${k === i ? 'on' : ''}">
        <button class="sent-main" data-act="shLoop" data-i="${k}">
          <span class="num">${looping ? '🔁' : k + 1}</span>
          <span class="txt">${text(k) ? esc(text(k)) : `<small>${fmtTime(a)}</small>`}</span>
        </button>
        ${sh.recs.has(k) && !recNow ? `<button class="mini play" data-act="shMine" data-i="${k}" aria-label="내 녹음 듣기">▶</button>` : ''}
        <button class="mini mic ${recNow ? 'rec-on' : sh.recs.has(k) ? 'done' : ''}" data-act="shRec" data-i="${k}"
          aria-label="${recNow ? '녹음 끝내기' : '녹음하기'}">${recNow ? '⏹' : '🎤'}</button>
      </div>`;
    }).join('')}</div>
  `;
}

// 자동으로 넘어간 문장이 목록에서 보이도록 스크롤한다
function scrollToSentence() {
  document.querySelector('.sent.on')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function toggleLoop(k) {
  if (sh.loop && sh.playing && sh.i === k) {
    pauseShadow();
    return;
  }
  playSentence(k, { loop: true });
}

// 문장 글자는 책 본문이라 비밀번호로 암호화해서 shadowing.json 에 넣어 두었다 (tools/encrypt-shadow.mjs)
const b64bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function decryptTexts(enc, pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64bytes(enc.salt), iterations: 200000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64bytes(enc.iv) }, key, b64bytes(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function unlockShadow(pass, { silent = false } = {}) {
  const video = sh.video;
  try {
    const texts = await decryptTexts(video.enc, pass.trim());
    if (sh?.video !== video) return;
    sh.texts = texts;
    sh.lockMsg = '';
    store.set('shadowPass', pass.trim()); // 다음부터는 묻지 않는다
  } catch {
    if (sh?.video !== video) return;
    if (silent) store.set('shadowPass', ''); // 비밀번호가 바뀌었으면 다시 묻는다
    else sh.lockMsg = '비밀번호가 맞지 않아요.';
  }
  renderShadowPanel();
}

function clearShadowTimers() {
  clearInterval(sh.timer);
  clearTimeout(sh.wait);
}

// i 번째 문장을 처음부터 (반복 횟수만큼) 들려준다
function playSentence(i, { loop = false } = {}) {
  if (!sh) return;
  const n = sh.video.segments.length;
  sh.i = Math.max(0, Math.min(n - 1, i));
  sh.left = sh.opts.repeat;
  sh.loop = loop;
  playSegment();
}

function playSegment() {
  clearShadowTimers();
  const p = sh.player;
  if (!p?.seekTo) { renderShadowPanel(); return; } // 영상이 아직 준비되지 않았다
  const [s, e] = sh.video.segments[sh.i];
  p.setPlaybackRate(sh.opts.rate);
  p.seekTo(s, true);
  p.playVideo();
  sh.playing = true;
  renderShadowPanel();
  sh.timer = setInterval(() => {
    if (p.getCurrentTime() < e - 0.05) return;
    p.pauseVideo();
    clearInterval(sh.timer);
    sh.left--;
    // 문장을 들은 만큼 따라 말할 시간을 준다
    const gap = Math.max(1500, ((e - s) / sh.opts.rate) * 1000 + 500);
    if (sh.loop || sh.left > 0) {
      sh.wait = setTimeout(playSegment, gap);
    } else if (sh.opts.auto && sh.i < sh.video.segments.length - 1) {
      sh.wait = setTimeout(() => { playSentence(sh.i + 1); scrollToSentence(); }, gap);
    } else {
      sh.playing = false;
      renderShadowPanel();
    }
  }, 50);
}

function pauseShadow() {
  clearShadowTimers();
  sh.player?.pauseVideo?.();
  sh.playing = false;
  renderShadowPanel();
}

function setShadowOption(key, value) {
  sh.opts[key] = value;
  store.set('shadowOpts', sh.opts);
  if (key === 'rate') sh.player?.setPlaybackRate?.(value);
  renderShadowPanel();
}

// ── 내 녹음: 문장마다 휴대폰(IndexedDB)에 저장해서 화면을 닫았다 열어도 남는다 ──
const recStore = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open('wordbook', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recordings');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', mode);
      const req = fn(tx.objectStore('recordings'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  };
  return {
    get: key => run('readonly', s => s.get(key)),
    put: (key, blob) => run('readwrite', s => s.put(blob, key)),
    del: key => run('readwrite', s => s.delete(key)),
    keys: () => run('readonly', s => s.getAllKeys()),
  };
})();

const recKey = (id, k) => `${id}:${k}`;

async function loadRecordings(video) {
  try {
    const keys = (await recStore.keys()).filter(key => String(key).startsWith(video.id + ':'));
    for (const key of keys) {
      const blob = await recStore.get(key);
      if (sh?.video !== video) return;
      if (blob) sh.recs.set(Number(String(key).split(':')[1]), blob);
    }
    renderShadowPanel();
  } catch {} // 사생활 보호 모드 등에서는 저장 없이 이 화면에서만 쓴다
}

// 한 번 누르면 녹음 시작, 한 번 더 누르면 끝
async function toggleRecord(k) {
  if (sh.recorder?.state === 'recording') {
    sh.recorder.stop();
    return;
  }
  pauseShadow();
  stopMine();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    alert('마이크를 쓸 수 없어요. 크롬에서 열고 마이크 사용을 허용해 주세요.');
    return;
  }
  const video = sh.video;
  const chunks = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: rec.mimeType });
    const empty = blob.size === 0;
    if (!empty) recStore.put(recKey(video.id, k), blob).catch(() => {});
    if (sh?.video !== video) return;
    sh.recorder = null;
    sh.recIndex = null;
    if (empty) alert('녹음이 안 됐어요. 조금 더 길게 말하고 다시 눌러 주세요.');
    else sh.recs.set(k, blob);
    renderShadowPanel();
  };
  sh.recorder = rec;
  sh.recIndex = k;
  sh.i = k;
  rec.start(250); // 0.25초마다 조각을 받아서 짧게 녹음해도 소리가 남게 한다
  renderShadowPanel();
  // 깜빡하고 안 끄면 30초 뒤 저절로 멈춘다
  setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 30000);
}

function stopMine() {
  if (!sh?.audio) return;
  sh.audio.pause();
  URL.revokeObjectURL(sh.audio.src);
  sh.audio = null;
}

function playMine(k) {
  const blob = sh?.recs.get(k);
  if (!blob) return;
  stopMine();
  pauseShadow();
  sh.audio = new Audio(URL.createObjectURL(blob));
  sh.audio.play();
}

async function clearRecordings() {
  if (!confirm('이 영상의 내 녹음을 모두 지울까요?')) return;
  const video = sh.video;
  await Promise.all([...sh.recs.keys()].map(k => recStore.del(recKey(video.id, k)).catch(() => {})));
  if (sh?.video !== video) return;
  sh.recs.clear();
  renderShadowPanel();
}

// ── 전체 녹음 내려받기: 문장 순서대로 이어 붙여 하나의 WAV 파일로 만든다 ──
const EXPORT_RATE = 22050;

// 휴대폰은 AudioContext 를 몇 개밖에 못 만들어서, 소리 장치를 쓰지 않는 OfflineAudioContext 하나로 모두 푼다.
// OfflineAudioContext 로 풀면 EXPORT_RATE 로 맞춰서 나온다.
let decoder = null;

async function toMono(blob) {
  decoder = decoder || new OfflineAudioContext(1, 1, EXPORT_RATE);
  const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / decoded.numberOfChannels;
  }
  return mono;
}

function encodeWav(samples, rate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return new Blob([view], { type: 'audio/wav' });
}

async function exportRecordings() {
  const video = sh.video;
  const n = video.segments.length;
  if (sh.recs.size < n) return;
  sh.exporting = true;
  renderShadowPanel();
  try {
    const parts = [];
    const bad = [];
    for (let k = 0; k < n; k++) {
      try {
        parts.push(await toMono(sh.recs.get(k)));
      } catch {
        // 너무 짧게 녹음하면 소리가 없어서 못 읽는다. 전체를 멈추지 않고 그 자리는 짧은 무음으로 채운다
        bad.push(k + 1);
        parts.push(new Float32Array(Math.round(EXPORT_RATE * 0.3)));
      }
    }
    const gap = Math.round(EXPORT_RATE * 0.5); // 문장 사이 0.5초 쉼
    const out = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0) + gap * (n - 1));
    let pos = 0;
    parts.forEach(p => { out.set(p, pos); pos += p.length + gap; });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(encodeWav(out, EXPORT_RATE));
    a.download = `${video.title} - 내 녹음.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    if (bad.length) alert(`파일을 만들었어요. 다만 ${bad.join(', ')}번 문장은 너무 짧아서 소리가 비어 있어요.`);
  } catch (e) {
    alert(`녹음 파일을 만들지 못했어요. (${e.message})`);
  }
  if (sh?.video !== video) return;
  sh.exporting = false;
  renderShadowPanel();
}

// 쉐도잉 화면을 떠날 때 영상과 녹음을 정리한다
function stopShadow() {
  if (!sh) return;
  clearShadowTimers();
  if (sh.recorder?.state === 'recording') sh.recorder.stop();
  stopMine();
  try { sh.player?.destroy?.(); } catch {}
  sh = null;
}

// ───────── 화면 이동 ─────────
function route() {
  const [, screen = '', src = 'all'] = location.hash.replace(/^#/, '').split('/');
  const s = LABEL[src] ? src : 'all';
  state.screen = screen || 'home';
  state.src = s;
  if (screen !== 'settings') settingsMsg = null;
  stopShadow();
  if (screen === 'shadow') {
    if (src && src !== 'all') startShadow(src); else renderShadowList();
  }
  else if (screen === 'cards') startCards(s);
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
  openChrome: () => openInChrome(),
  shPlay: () => (sh.playing ? pauseShadow() : playSentence(sh.i)),
  shReplay: () => playSentence(sh.i),
  shPrev: () => playSentence(sh.i - 1),
  shNext: () => playSentence(sh.i + 1),
  shLoop: el => toggleLoop(Number(el.dataset.i)),
  shRate: el => setShadowOption('rate', Number(el.dataset.v)),
  shRepeat: el => setShadowOption('repeat', Number(el.dataset.v)),
  shAuto: () => setShadowOption('auto', !sh.opts.auto),
  shRec: el => toggleRecord(Number(el.dataset.i)),
  shMine: el => playMine(Number(el.dataset.i)),
  shRecClear: () => clearRecordings(),
  shExport: () => exportRecordings(),
};

$app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) actions[el.dataset.act]?.(el, e);
});

$app.addEventListener('submit', e => {
  if (e.target.dataset.form !== 'unlock') return;
  e.preventDefault();
  const pass = document.getElementById('sh-pass').value;
  if (pass.trim()) unlockShadow(pass);
});

$app.addEventListener('change', e => {
  if (e.target.id === 'unit') setUnit(e.target.value || null);
});

window.addEventListener('hashchange', route);

// 다른 화면 주소로 바로 열어도 '뒤로'를 누르면 홈으로 가게 한다
if (location.hash && location.hash !== '#/') {
  const target = location.hash;
  history.replaceState(null, '', '#/');
  history.pushState(null, '', target);
}
route();

// 열 때마다 새 단어를 받아 온다 (시트가 연결돼 있으면 시트, 아니면 words.csv)
(state.sheetUrl ? importSheet(state.sheetUrl) : loadBuiltin())
  .then(refreshView)
  .catch(() => {
    // 시트를 못 받았는데 화면에 단어가 하나도 없으면 기본 단어라도 보여 준다
    if (!state.words.length) loadBuiltin().then(refreshView).catch(() => {});
  });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // 새 버전이 올라오면 바로 받아서, 새 서비스워커가 자리를 잡는 순간 한 번 새로고침한다
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded || sh?.recorder) return; // 처음 설치일 때와 녹음 중에는 새로고침하지 않는다
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => reg.update())
    .catch(() => {});
}
