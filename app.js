/* ============================================================
   A&M QUIZZ MULTIJOUEUR — LOGIQUE DE JEU (Firebase Firestore)
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, increment, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ---------- Identité locale (pas de compte, juste un id par onglet) ---------- */
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
let questionTimerInterval = null;

function show(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/* ---------- MENU PRINCIPAL ---------- */
show('screen-home');

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-create').style.display = tab.dataset.tab === 'create' ? 'block' : 'none';
    document.getElementById('tab-join').style.display = tab.dataset.tab === 'join' ? 'block' : 'none';
  });
});

function randomCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for(let i=0;i<4;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

document.getElementById('create-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('home-error');
  errEl.textContent = '';
  const name = document.getElementById('create-name').value.trim();
  if(!name){ errEl.textContent = "Entre ton prénom."; return; }
  myName = name;
  isHost = true;
  try{
    let code, exists = true;
    while(exists){
      code = randomCode();
      const snap = await getDoc(doc(db, 'lobbies', code));
      exists = snap.exists();
    }
    lobbyCode = code;
    await setDoc(doc(db, 'lobbies', lobbyCode), {
      hostId: MY_UID, status: 'lobby',
      config: { categories: Object.keys(QUESTION_BANK), numQuestions: 25, timeLimit: 20 },
      questions: [], currentIndex: 0, correctionIndex: 0,
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'lobbies', lobbyCode, 'players', MY_UID), { name: myName, score: 0, joinedAt: serverTimestamp() });
    enterLobby();
  } catch(e){ console.error(e); errEl.textContent = "Erreur : " + (e.code || e.message || e); }
});

document.getElementById('join-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('home-error');
  errEl.textContent = '';
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if(!name){ errEl.textContent = "Entre ton prénom."; return; }
  if(!code){ errEl.textContent = "Entre le code de la partie."; return; }
  myName = name;
  try{
    const snap = await getDoc(doc(db, 'lobbies', code));
    if(!snap.exists()){ errEl.textContent = "Aucune partie avec ce code."; return; }
    isHost = (snap.data().hostId === MY_UID);
    lobbyCode = code;
    await setDoc(doc(db, 'lobbies', lobbyCode, 'players', MY_UID), { name: myName, score: 0, joinedAt: serverTimestamp() }, {merge: true});
    enterLobby();
  } catch(e){ console.error(e); errEl.textContent = "Erreur : " + (e.code || e.message || e); }
});

/* ---------- LOBBY & DECONNEXION ---------- */
function enterLobby(){
  document.getElementById('lobby-code-badge').style.display = 'inline-block';
  document.getElementById('lobby-code-badge').textContent = lobbyCode;
  show('screen-lobby');
  document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
  document.getElementById('guest-waiting').style.display = isHost ? 'none' : 'block';
  if(isHost) buildLobbyCatGrid();

  unsubPlayers = onSnapshot(collection(db, 'lobbies', lobbyCode, 'players'), (qs) => {
    const list = document.getElementById('lobby-players');
    list.innerHTML = '';
    qs.forEach(d => {
      const p = d.data();
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<span>${escapeHtml(p.name)}${d.id === MY_UID ? '<span class="you-badge">TOI</span>' : ''}</span><span class="mono">${p.score || 0} pts</span>`;
      list.appendChild(row);
    });
  });

  unsubLobby = onSnapshot(doc(db, 'lobbies', lobbyCode), (snap) => {
    if(!snap.exists()) {
      alert("L'hôte a fermé ou supprimé le lobby.");
      resetToHome();
      return;
    }
    const data = snap.data();
    if(data.status === 'question') renderQuestionScreen(data);
    else if(data.status === 'correction') renderCorrectionScreen(data);
    else if(data.status === 'finished') renderFinalScreen();
    else if(data.status === 'lobby'){
      // Réinitialisation complète pour éviter que d'anciennes réponses/états ne persistent
      lastRenderedIndex = -1;
      advancingLock = false;
      clearInterval(questionTimerInterval);
      document.getElementById('answer-locked').style.display = 'none';
      document.getElementById('answer-input').value = '';
      document.getElementById('answer-input').disabled = false;
      document.getElementById('submit-answer-btn').disabled = false;
      document.querySelectorAll('.hint-msg').forEach(e => e.style.display = 'none');
      show('screen-lobby');
    }
  });
}

// Supprimer le lobby si l'hôte ferme l'onglet
window.addEventListener('beforeunload', () => {
  if (isHost && lobbyCode) { deleteDoc(doc(db, 'lobbies', lobbyCode)); }
});

function buildLobbyCatGrid(){
  const grid = document.getElementById('lobby-cat-grid');
  grid.innerHTML = '';
  Object.keys(QUESTION_BANK).forEach(key => {
    const card = document.createElement('div');
    card.className = 'cat-card selected'; card.dataset.cat = key;
    card.innerHTML = `<div class="name">${CATEGORY_LABELS[key]}</div><span class="count mono">${QUESTION_BANK[key].length} dispo</span>`;
    card.addEventListener('click', () => card.classList.toggle('selected'));
    grid.appendChild(card);
  });
}

document.getElementById('num-questions').addEventListener('input', (e) => document.getElementById('num-questions-value').textContent = e.target.value);
document.getElementById('time-limit').addEventListener('input', (e) => document.getElementById('time-limit-value').textContent = e.target.value);

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

document.getElementById('start-game-btn').addEventListener('click', async () => {
  const selectedCats = Array.from(document.querySelectorAll('#lobby-cat-grid .cat-card.selected')).map(c => c.dataset.cat);
  if(selectedCats.length === 0) return;
  const numQ = parseInt(document.getElementById('num-questions').value, 10);
  
  let pool = [];
  selectedCats.forEach(cat => {
    QUESTION_BANK[cat].forEach(q => pool.push({ category: cat, ...q }));
  });

  const finalSet = shuffle(pool).slice(0, numQ);
  await updateDoc(doc(db, 'lobbies', lobbyCode), {
    status: 'question', config: { timeLimit: parseInt(document.getElementById('time-limit').value, 10) },
    questions: finalSet, currentIndex: 0, correctionIndex: 0, questionDeadline: Date.now() + (parseInt(document.getElementById('time-limit').value, 10) * 1000)
  });
});

/* ---------- QUESTION ---------- */
let lastRenderedIndex = -1;
let advancingLock = false;

function renderQuestionScreen(data){
  show('screen-question');
  const idx = data.currentIndex;
  const q = data.questions[idx];

  const isNew = idx !== lastRenderedIndex;
  if(isNew){
    lastRenderedIndex = idx; advancingLock = false;
    document.getElementById('answer-locked').style.display = 'none';
    document.getElementById('answer-input').value = '';
    document.getElementById('answer-input').disabled = false;
    document.getElementById('submit-answer-btn').disabled = false;
    document.querySelectorAll('.hint-msg').forEach(e => e.style.display = 'none');
  }

  document.getElementById('q-counter').textContent = `Question ${idx+1} / ${data.questions.length}`;
  document.getElementById('progress-fill').style.width = `${(idx/data.questions.length)*100}%`;

  document.getElementById('q-cat').textContent = CATEGORY_LABELS[q.category];
  document.getElementById('q-text').textContent = q.prompt;
  const imgEl = document.getElementById('q-image');
  if(q.image){ imgEl.style.display='flex'; imgEl.innerHTML=`<img src="${q.image}" onerror="this.parentElement.style.display='none'">`; } else { imgEl.style.display='none'; }

  clearInterval(questionTimerInterval);
  const badge = document.getElementById('timer-badge');
  questionTimerInterval = setInterval(() => {
    const rem = Math.max(0, Math.ceil((data.questionDeadline - Date.now())/1000));
    badge.textContent = `${rem}s`; badge.classList.toggle('low', rem <= 5);
    if(rem <= 0){
      clearInterval(questionTimerInterval);
      document.getElementById('answer-input').disabled = true;
      document.getElementById('answer-locked').style.display = 'block';
      if(isHost && !advancingLock){ advancingLock = true; advanceQuestion(data, idx); }
    }
  }, 300);
}

async function submitAnswer(text){
  try {
    await setDoc(doc(db, 'lobbies', lobbyCode, 'answers', `${lastRenderedIndex}_${MY_UID}`), {
      uid: MY_UID, name: myName, questionIndex: lastRenderedIndex, judged: false, correct: null,
      text: text || '—',
    }, { merge: true });
    document.getElementById('answer-hint').style.display = 'block';
  } catch(e) {}
}

let answerAutosaveTimer = null;
document.getElementById('answer-input').addEventListener('input', () => {
  clearTimeout(answerAutosaveTimer);
  answerAutosaveTimer = setTimeout(() => submitAnswer(document.getElementById('answer-input').value.trim()), 700);
});
document.getElementById('submit-answer-btn').addEventListener('click', () => submitAnswer(document.getElementById('answer-input').value.trim()));

async function advanceQuestion(data, idx){
  const next = idx + 1;
  if(next >= data.questions.length) await updateDoc(doc(db, 'lobbies', lobbyCode), { status: 'correction', correctionIndex: 0 });
  else await updateDoc(doc(db, 'lobbies', lobbyCode), { currentIndex: next, questionDeadline: Date.now() + data.config.timeLimit * 1000 });
}

/* ---------- CORRECTION ---------- */
function renderCorrectionScreen(data){
  show('screen-correction');
  clearInterval(questionTimerInterval);
  const idx = data.correctionIndex || 0;
  const q = data.questions[idx];

  document.getElementById('correction-counter').textContent = `Correction — Question ${idx+1} / ${data.questions.length}`;
  document.getElementById('reveal-question-text').textContent = q.prompt;
  
  const refBox = document.getElementById('reveal-reference');
  if (q.reference) {
    refBox.style.display = 'block'; document.getElementById('reveal-reference-text').textContent = q.reference;
  } else { refBox.style.display = 'none'; }

  document.getElementById('host-reveal-controls').style.display = isHost ? 'flex' : 'none';
  document.getElementById('guest-reveal-waiting').style.display = isHost ? 'none' : 'block';
  document.getElementById('prev-question-btn').disabled = idx === 0;
  document.getElementById('next-question-btn').textContent = (idx === data.questions.length - 1) ? 'Classement' : 'Suivante →';

  if(unsubAnswers) unsubAnswers();
  unsubAnswers = onSnapshot(query(collection(db, 'lobbies', lobbyCode, 'answers'), where('questionIndex', '==', idx)), (qs) => {
    const container = document.getElementById('reveal-answers'); container.innerHTML = '';
    qs.forEach(d => {
      const a = { id: d.id, ...d.data() };
      const row = document.createElement('div');
      row.className = 'answer-row' + (a.judged ? (a.correct ? ' correct' : ' wrong') : '');
      row.innerHTML = `<div class="answer-head"><span class="avatar">${escapeHtml((a.name||'?').charAt(0).toUpperCase())}</span><span class="who">${escapeHtml(a.name)}</span>${!isHost ? `<span class="verdict-icon">${a.judged ? (a.correct?'✓':'✗') : '···'}</span>` : ''}</div>
        <div class="text-bubble">${escapeHtml(a.text)}</div>
        ${isHost ? `<div class="judge-btns"><button class="yes${a.judged && a.correct ? ' active' : ''}" data-id="${a.id}" data-val="true">✓ Vrai</button><button class="no${a.judged && a.correct === false ? ' active' : ''}" data-id="${a.id}" data-val="false">✗ Faux</button></div>` : ''}`;
      container.appendChild(row);
    });

    if(isHost){
      container.querySelectorAll('.judge-btns button').forEach(btn => btn.addEventListener('click', async () => {
        const correct = btn.dataset.val === 'true';
        const ref = doc(db, 'lobbies', lobbyCode, 'answers', btn.dataset.id);
        const snap = await getDoc(ref);
        const wasCorrect = snap.data().correct === true;
        await updateDoc(ref, { judged: true, correct });
        if(wasCorrect && !correct) updateDoc(doc(db, 'lobbies', lobbyCode, 'players', snap.data().uid), { score: increment(-1) });
        else if(!wasCorrect && correct) updateDoc(doc(db, 'lobbies', lobbyCode, 'players', snap.data().uid), { score: increment(1) });
      }));
    }
  });
}

document.getElementById('prev-question-btn').addEventListener('click', async () => {
  const d = (await getDoc(doc(db, 'lobbies', lobbyCode))).data();
  await updateDoc(doc(db, 'lobbies', lobbyCode), { correctionIndex: Math.max(0, d.correctionIndex - 1) });
});
document.getElementById('next-question-btn').addEventListener('click', async () => {
  const d = (await getDoc(doc(db, 'lobbies', lobbyCode))).data();
  if(d.correctionIndex + 1 >= d.questions.length) await updateDoc(doc(db, 'lobbies', lobbyCode), { status: 'finished' });
  else await updateDoc(doc(db, 'lobbies', lobbyCode), { correctionIndex: d.correctionIndex + 1 });
});

/* ---------- FINAL ---------- */
async function renderFinalScreen(){
  show('screen-final');
  if(unsubAnswers) unsubAnswers();
  document.getElementById('replay-btn').style.display = isHost ? 'block' : 'none';
  const playersSnap = await getDocs(collection(db, 'lobbies', lobbyCode, 'players'));
  const players = []; playersSnap.forEach(d => players.push(d.data()));
  players.sort((a,b) => (b.score||0) - (a.score||0));
  const medals = ['🥇','🥈','🥉'];
  document.getElementById('final-leaderboard').innerHTML = players.map((p, i) => `<div class="leaderboard-row${i===0?' first':''}" style="animation-delay:${i*0.06}s"><span>${medals[i] || ('#'+(i+1))} ${escapeHtml(p.name)}</span><strong>${p.score} pts</strong></div>`).join('');
}

document.getElementById('replay-btn').addEventListener('click', async () => {
  const playersSnap = await getDocs(collection(db, 'lobbies', lobbyCode, 'players'));
  playersSnap.forEach(d => updateDoc(doc(db, 'lobbies', lobbyCode, 'players', d.id), { score: 0 }));
  const answersSnap = await getDocs(collection(db, 'lobbies', lobbyCode, 'answers'));
  await Promise.all(answersSnap.docs.map(d => deleteDoc(d.ref)));
  await updateDoc(doc(db, 'lobbies', lobbyCode), { status: 'lobby', questions: [], currentIndex: 0, correctionIndex: 0 });
});

document.getElementById('back-home-btn').addEventListener('click', resetToHome);

function resetToHome() {
  if(unsubLobby) unsubLobby(); if(unsubPlayers) unsubPlayers(); if(unsubAnswers) unsubAnswers();
  lobbyCode = null; document.getElementById('lobby-code-badge').style.display = 'none';
  show('screen-home');
}
