/* ============================================================
   A&M QUIZZ MULTIJOUEUR — LOGIQUE DE JEU (Firebase Firestore)
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot,
  collection, query, where, increment, serverTimestamp, deleteDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ---------- Identité locale (pas d'auth, juste un id par onglet) ---------- */
function getMyUid(){
  let uid = sessionStorage.getItem('amquizz_uid');
  if(!uid){
    uid = crypto.randomUUID();
    sessionStorage.setItem('amquizz_uid', uid);
  }
  return uid;
}
const MY_UID = getMyUid();
let myName = '';
let isHost = false;
let lobbyCode = null;
let unsubLobby = null;
let unsubPlayers = null;
let unsubAnswers = null;
let currentQuestions = [];
let questionTimerInterval = null;

/* ---------- Helpers UI ---------- */
function show(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function setCodeBadge(code){
  const el = document.getElementById('lobby-code-badge');
  el.style.display = 'inline-block';
  el.textContent = `CODE ${code}`;
}

/* ---------- HOME : tabs ---------- */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-create').style.display = tab.dataset.tab === 'create' ? 'block' : 'none';
    document.getElementById('tab-join').style.display = tab.dataset.tab === 'join' ? 'block' : 'none';
  });
});

function randomCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caractères ambigus
  let code = '';
  for(let i=0;i<4;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

/* ---------- CREER UNE PARTIE ---------- */
document.getElementById('create-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('home-error');
  errEl.textContent = '';
  const name = document.getElementById('create-name').value.trim();
  if(!name){ errEl.textContent = "Entre ton prénom."; return; }
  myName = name;
  isHost = true;

  try{
    let code, exists = true, tries = 0;
    while(exists && tries < 8){
      code = randomCode();
      const snap = await getDoc(doc(db, 'lobbies', code));
      exists = snap.exists();
      tries++;
    }
    lobbyCode = code;

    await setDoc(doc(db, 'lobbies', lobbyCode), {
      hostId: MY_UID,
      status: 'lobby',
      config: { categories: Object.keys(QUESTION_BANK), numQuestions: 30, timeLimit: 20 },
      questions: [],
      currentIndex: 0,
      questionDeadline: null,
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'lobbies', lobbyCode, 'players', MY_UID), {
      name: myName, score: 0, joinedAt: serverTimestamp(),
    });

    enterLobby();
  } catch(e){
    console.error(e);
    errEl.textContent = "Impossible de créer la partie. Vérifie ta config Firebase (voir README).";
  }
});

/* ---------- REJOINDRE UNE PARTIE ---------- */
document.getElementById('join-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('home-error');
  errEl.textContent = '';
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if(!name){ errEl.textContent = "Entre ton prénom."; return; }
  if(!code){ errEl.textContent = "Entre le code de la partie."; return; }

  try{
    const lobbyRef = doc(db, 'lobbies', code);
    const snap = await getDoc(lobbyRef);
    if(!snap.exists()){ errEl.textContent = "Aucune partie avec ce code."; return; }

    myName = name;
    isHost = (snap.data().hostId === MY_UID);
    lobbyCode = code;

    await setDoc(doc(db, 'lobbies', lobbyCode, 'players', MY_UID), {
      name: myName, score: 0, joinedAt: serverTimestamp(),
    });

    enterLobby();
  } catch(e){
    console.error(e);
    errEl.textContent = "Impossible de rejoindre la partie. Vérifie ta config Firebase (voir README).";
  }
});

/* ---------- ECRAN LOBBY ---------- */
function enterLobby(){
  setCodeBadge(lobbyCode);
  show('screen-lobby');

  document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
  document.getElementById('guest-waiting').style.display = isHost ? 'none' : 'block';

  if(isHost) buildLobbyCatGrid();

  // Liste des joueurs en temps réel
  unsubPlayers = onSnapshot(collection(db, 'lobbies', lobbyCode, 'players'), (qs) => {
    const list = document.getElementById('lobby-players');
    list.innerHTML = '';
    qs.forEach(d => {
      const p = d.data();
      const row = document.createElement('div');
      row.className = 'player-row';
      const badges = (d.id === MY_UID ? '<span class="you-badge">(toi)</span>' : '') ;
      row.innerHTML = `<span>${p.name}${badges}</span><span class="mono">${p.score || 0} pts</span>`;
      list.appendChild(row);
    });
  });

  // Ecoute du doc lobby (statut de la partie)
  unsubLobby = onSnapshot(doc(db, 'lobbies', lobbyCode), (snap) => {
    if(!snap.exists()) return;
    const data = snap.data();
    currentQuestions = data.questions || [];

    if(data.status === 'question'){
      renderQuestionScreen(data);
    } else if(data.status === 'reveal'){
      renderRevealScreen(data);
    } else if(data.status === 'finished'){
      renderFinalScreen();
    }
  });
}

/* ---------- CONFIGURATION HOTE (catégories, nb questions, temps) ---------- */
function buildLobbyCatGrid(){
  const grid = document.getElementById('lobby-cat-grid');
  grid.innerHTML = '';
  Object.keys(QUESTION_BANK).forEach(key => {
    const card = document.createElement('div');
    card.className = 'cat-card selected';
    card.dataset.cat = key;
    card.innerHTML = `<div class="name">${CATEGORY_LABELS[key]}</div><span class="count mono">${QUESTION_BANK[key].length} dispo</span>`;
    card.addEventListener('click', () => card.classList.toggle('selected'));
    grid.appendChild(card);
  });
}

document.getElementById('num-questions').addEventListener('input', (e) => {
  document.getElementById('num-questions-value').textContent = e.target.value;
});
document.getElementById('time-limit').addEventListener('input', (e) => {
  document.getElementById('time-limit-value').textContent = e.target.value;
});

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

function buildQuestionSet(categories, numQuestions){
  const includesPetitBac = categories.includes('petit_bac');
  let petitBacRounds = [];
  let pool = [];

  categories.forEach(cat => {
    if(cat === 'petit_bac') return;
    QUESTION_BANK[cat].forEach(q => pool.push({ category: cat, ...q }));
  });
  pool = shuffle(pool);

  let petitBacSlots = 0;
  if(includesPetitBac){
    petitBacSlots = Math.min(3, Math.floor(numQuestions * 0.15) || 1, QUESTION_BANK.petit_bac.length);
    petitBacRounds = shuffle(QUESTION_BANK.petit_bac).slice(0, petitBacSlots).map(r => ({ category: 'petit_bac', ...r }));
  }

  const remaining = Math.max(0, numQuestions - petitBacRounds.length);
  const chosen = pool.slice(0, remaining);
  const finalSet = shuffle([...chosen, ...petitBacRounds]);
  return finalSet;
}

document.getElementById('start-game-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('lobby-error');
  errEl.textContent = '';
  const selectedCats = Array.from(document.querySelectorAll('#lobby-cat-grid .cat-card.selected')).map(c => c.dataset.cat);
  if(selectedCats.length === 0){ errEl.textContent = "Sélectionne au moins une catégorie."; return; }

  const numQuestions = parseInt(document.getElementById('num-questions').value, 10);
  const timeLimit = parseInt(document.getElementById('time-limit').value, 10);

  const questions = buildQuestionSet(selectedCats, numQuestions);
  if(questions.length < numQuestions){
    errEl.textContent = `Attention : seulement ${questions.length} questions disponibles dans ces catégories (sur ${numQuestions} demandées). La partie démarre quand même.`;
  }

  await updateDoc(doc(db, 'lobbies', lobbyCode), {
    status: 'question',
    config: { categories: selectedCats, numQuestions: questions.length, timeLimit },
    questions,
    currentIndex: 0,
    questionDeadline: Date.now() + timeLimit * 1000,
  });
});

/* ---------- ECRAN QUESTION ---------- */
let lastRenderedIndex = -1;
let hasAnsweredCurrent = false;

function renderQuestionScreen(data){
  show('screen-question');
  const idx = data.currentIndex;
  const total = data.questions.length;
  const q = data.questions[idx];

  if(idx !== lastRenderedIndex){
    lastRenderedIndex = idx;
    hasAnsweredCurrent = false;
    document.getElementById('answer-locked').style.display = 'none';
    document.getElementById('answer-input').value = '';
    document.getElementById('answer-input').disabled = false;
    document.getElementById('submit-answer-btn').disabled = false;
  }

  document.getElementById('q-counter').textContent = `Question ${idx+1} / ${total}`;
  document.getElementById('progress-fill').style.width = `${(idx/total)*100}%`;

  const isPetitBac = q.category === 'petit_bac';
  document.getElementById('question-standard').style.display = isPetitBac ? 'none' : 'block';
  document.getElementById('question-petit-bac').style.display = isPetitBac ? 'block' : 'none';

  if(isPetitBac){
    document.getElementById('pb-letter').textContent = q.letter;
    const catsDiv = document.getElementById('pb-cats');
    if(idx !== lastRenderedIndex || catsDiv.dataset.builtFor !== String(idx)){
      catsDiv.innerHTML = '';
      catsDiv.dataset.builtFor = String(idx);
      q.categories.forEach((catName, i) => {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<span class="pb-cat-label mono">${catName}</span><input type="text" class="pb-input" data-cat="${catName}" placeholder="${catName}...">`;
        catsDiv.appendChild(wrap);
      });
    }
  } else {
    document.getElementById('q-cat').textContent = CATEGORY_LABELS[q.category].toUpperCase();
    const imgEl = document.getElementById('q-image');
    if(q.image){
      imgEl.style.display = 'block';
      imgEl.textContent = q.image;
    } else {
      imgEl.style.display = 'none';
    }
    document.getElementById('q-text').textContent = q.prompt;
  }

  // Timer
  clearInterval(questionTimerInterval);
  const badge = document.getElementById('timer-badge');
  function tick(){
    const remainingMs = data.questionDeadline - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs/1000));
    badge.textContent = `${remaining}s`;
    badge.classList.toggle('low', remaining <= 5);
    if(remaining <= 0){
      clearInterval(questionTimerInterval);
      lockAnswerInputs();
      if(isHost) advanceToReveal(data);
    }
  }
  tick();
  questionTimerInterval = setInterval(tick, 300);
}

function lockAnswerInputs(){
  document.getElementById('answer-input').disabled = true;
  document.getElementById('submit-answer-btn').disabled = true;
  document.querySelectorAll('.pb-input').forEach(i => i.disabled = true);
  document.getElementById('submit-pb-btn').disabled = true;
  if(hasAnsweredCurrent){
    document.getElementById('answer-locked').style.display = 'block';
  }
}

async function submitAnswer(text){
  if(hasAnsweredCurrent) return;
  hasAnsweredCurrent = true;
  const idx = lastRenderedIndex;
  const answerId = `${idx}_${MY_UID}`;
  await setDoc(doc(db, 'lobbies', lobbyCode, 'answers', answerId), {
    uid: MY_UID, name: myName, questionIndex: idx, text: text || '(pas de réponse)',
    judged: false, correct: null, judgedAt: null,
  });
  document.getElementById('answer-locked').style.display = 'block';
}

document.getElementById('submit-answer-btn').addEventListener('click', () => {
  const val = document.getElementById('answer-input').value.trim();
  submitAnswer(val);
});

document.getElementById('submit-pb-btn').addEventListener('click', () => {
  const inputs = document.querySelectorAll('.pb-input');
  const parts = Array.from(inputs).map(i => `${i.dataset.cat}: ${i.value.trim() || '—'}`);
  submitAnswer(parts.join(' / '));
});

/* ---------- PASSAGE AUTOMATIQUE A LA CORRECTION (hôte uniquement) ---------- */
async function advanceToReveal(data){
  await updateDoc(doc(db, 'lobbies', lobbyCode), { status: 'reveal' });
}

/* ---------- ECRAN CORRECTION (REVEAL) ---------- */
function renderRevealScreen(data){
  show('screen-reveal');
  clearInterval(questionTimerInterval);
  const idx = data.currentIndex;
  const total = data.questions.length;
  const q = data.questions[idx];

  document.getElementById('reveal-counter').textContent = `Correction — Question ${idx+1} / ${total}`;

  const refBox = document.getElementById('reveal-reference');
  const refText = document.getElementById('reveal-reference-text');
  if(q.category === 'petit_bac'){
    refBox.style.display = 'block';
    const examples = Object.entries(q.reference).map(([k,v]) => `${k}: ${v}`).join(' · ');
    refText.textContent = `Exemples possibles pour la lettre ${q.letter} — ${examples}`;
  } else if(q.reference){
    refBox.style.display = 'block';
    refText.textContent = q.reference;
  } else {
    refBox.style.display = 'none';
  }

  document.getElementById('host-reveal-controls').style.display = isHost ? 'block' : 'none';
  document.getElementById('guest-reveal-waiting').style.display = isHost ? 'none' : 'block';

  if(unsubAnswers) unsubAnswers();
  const answersQuery = query(collection(db, 'lobbies', lobbyCode, 'answers'), where('questionIndex', '==', idx));
  unsubAnswers = onSnapshot(answersQuery, (qs) => {
    const container = document.getElementById('reveal-answers');
    container.innerHTML = '';
    const docs = [];
    qs.forEach(d => docs.push({ id: d.id, ...d.data() }));
    docs.sort((a,b) => a.name.localeCompare(b.name));

    docs.forEach(a => {
      const row = document.createElement('div');
      row.className = 'answer-row' + (a.judged ? (a.correct ? ' correct' : ' wrong') : '');
      const revealed = a.judged || isHost;
      const textClass = revealed ? '' : 'hidden-text';
      const textContent = revealed ? a.text : '••••••••';
      let controls = '';
      if(isHost){
        controls = `<div class="judge-btns">
          <button class="yes" data-id="${a.id}" data-val="true">✓ Vrai</button>
          <button class="no" data-id="${a.id}" data-val="false">✗ Faux</button>
        </div>`;
      } else if(a.judged){
        controls = `<span class="verdict-icon">${a.correct ? '✓' : '✗'}</span>`;
      } else {
        controls = `<span class="verdict-icon mono">...</span>`;
      }
      row.innerHTML = `<span class="who">${a.name}</span><span class="text ${textClass}">${textContent}</span>${controls}`;
      container.appendChild(row);
    });

    if(isHost){
      container.querySelectorAll('.judge-btns button').forEach(btn => {
        btn.addEventListener('click', async () => {
          const answerId = btn.dataset.id;
          const correct = btn.dataset.val === 'true';
          const ansRef = doc(db, 'lobbies', lobbyCode, 'answers', answerId);
          const ansSnap = await getDoc(ansRef);
          if(!ansSnap.exists() || ansSnap.data().judged) return; // évite double-clic
          await updateDoc(ansRef, { judged: true, correct, judgedAt: Date.now() });
          if(correct){
            await updateDoc(doc(db, 'lobbies', lobbyCode, 'players', ansSnap.data().uid), {
              score: increment(1)
            });
          }
        });
      });
    }
  });
}

document.getElementById('next-question-btn').addEventListener('click', async () => {
  const lobbySnap = await getDoc(doc(db, 'lobbies', lobbyCode));
  const data = lobbySnap.data();
  const nextIndex = data.currentIndex + 1;
  if(nextIndex >= data.questions.length){
    await updateDoc(doc(db, 'lobbies', lobbyCode), { status: 'finished' });
  } else {
    await updateDoc(doc(db, 'lobbies', lobbyCode), {
      status: 'question',
      currentIndex: nextIndex,
      questionDeadline: Date.now() + data.config.timeLimit * 1000,
    });
  }
});

/* ---------- ECRAN FINAL ---------- */
async function renderFinalScreen(){
  show('screen-final');
  if(unsubAnswers) unsubAnswers();
  const playersSnap = await getDocs(collection(db, 'lobbies', lobbyCode, 'players'));
  const players = [];
  playersSnap.forEach(d => players.push({ id: d.id, ...d.data() }));
  players.sort((a,b) => (b.score||0) - (a.score||0));

  const container = document.getElementById('final-leaderboard');
  container.innerHTML = '';
  players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'leaderboard-row' + (i === 0 ? ' first' : '');
    row.innerHTML = `<span class="rank mono">#${i+1}</span><span>${p.name}${p.id === MY_UID ? ' (toi)' : ''}</span><span class="score mono">${p.score || 0} pts</span>`;
    container.appendChild(row);
  });
}

document.getElementById('back-home-btn').addEventListener('click', () => {
  if(unsubLobby) unsubLobby();
  if(unsubPlayers) unsubPlayers();
  if(unsubAnswers) unsubAnswers();
  lobbyCode = null;
  lastRenderedIndex = -1;
  document.getElementById('lobby-code-badge').style.display = 'none';
  show('screen-home');
});
