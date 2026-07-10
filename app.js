/* ============================================================
   A&M QUIZZ MULTIJOUEUR — LOGIQUE DE JEU (Firebase Firestore)
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, increment, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let MY_UID = null;
let myName = '';
let isHost = false;
let isAdmin = false;
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

/* ---------- AUTHENTIFICATION ---------- */
onAuthStateChanged(auth, (user) => {
  if (user) {
    MY_UID = user.uid;
    myName = user.displayName || user.email.split('@')[0];
    isAdmin = (user.email === 'admin@amquizz.fr'); // Change cet email par le tien si besoin
    document.getElementById('welcome-msg').textContent = `Bienvenue ${myName} ! Crée une partie ou rejoins tes amis.`;
    if(!lobbyCode) show('screen-home');
  } else {
    MY_UID = null;
    myName = '';
    isAdmin = false;
    show('screen-login');
  }
});

document.getElementById('login-btn').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value.trim();
  const pass = document.getElementById('auth-pass').value.trim();
  const err = document.getElementById('auth-error');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    err.textContent = "";
  } catch (error) { err.textContent = "Erreur de connexion. Vérifie tes identifiants."; }
});

document.getElementById('register-btn').addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value.trim();
  const pass = document.getElementById('auth-pass').value.trim();
  const err = document.getElementById('auth-error');
  if(pass.length < 6) { err.textContent = "Le mot de passe doit faire au moins 6 caractères."; return; }
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
    err.textContent = "";
  } catch (error) { err.textContent = "Erreur d'inscription. Email peut-être déjà utilisé."; }
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

/* ---------- MENU PRINCIPAL ---------- */
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
  } catch(e){ errEl.textContent = "Erreur création de partie."; }
});

document.getElementById('join-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('home-error');
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if(!code){ errEl.textContent = "Entre le code de la partie."; return; }
  try{
    const snap = await getDoc(doc(db, 'lobbies', code));
    if(!snap.exists()){ errEl.textContent = "Aucune partie avec ce code."; return; }
    isHost = (snap.data().hostId === MY_UID);
    lobbyCode = code;
    await setDoc(doc(db, 'lobbies', lobbyCode, 'players', MY_UID), { name: myName, score: 0, joinedAt: serverTimestamp() }, {merge: true});
    enterLobby();
  } catch(e){ errEl.textContent = "Erreur pour rejoindre."; }
});

/* ---------- LOBBY & DECONNEXION ---------- */
function enterLobby(){
  document.getElementById('lobby-code-badge').style.display = 'inline-block';
  document.getElementById('lobby-code-badge').textContent = lobbyCode;
  show('screen-lobby');
  document.getElementById('host-controls').style.display = (isHost || isAdmin) ? 'block' : 'none';
  document.getElementById('guest-waiting').style.display = (isHost || isAdmin) ? 'none' : 'block';
  if(isHost || isAdmin) buildLobbyCatGrid();

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
    else if(data.status === 'lobby') show('screen-lobby'); // Pour le replay
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
  let pbRounds = [];
  selectedCats.forEach(cat => {
    if(cat === 'petit_bac') pbRounds = shuffle(QUESTION_BANK.petit_bac).slice(0, Math.min(3, Math.floor(numQ*0.15)||1));
    else QUESTION_BANK[cat].forEach(q => pool.push({ category: cat, ...q }));
  });
  
  const finalSet = shuffle([...shuffle(pool).slice(0, Math.max(0, numQ - pbRounds.length)), ...pbRounds]);
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

  if(idx !== lastRenderedIndex){
    lastRenderedIndex = idx; advancingLock = false;
    document.getElementById('answer-locked').style.display = 'none';
    document.getElementById('answer-input').value = '';
    document.getElementById('answer-input').disabled = false;
    document.getElementById('submit-answer-btn').disabled = false;
    document.getElementById('submit-pb-btn').disabled = false;
    document.querySelectorAll('.hint-msg').forEach(e => e.style.display = 'none');
  }

  document.getElementById('q-counter').textContent = `Question ${idx+1} / ${data.questions.length}`;
  document.getElementById('progress-fill').style.width = `${(idx/data.questions.length)*100}%`;

  if(q.category === 'petit_bac'){
    document.getElementById('question-standard').style.display = 'none';
    document.getElementById('question-petit-bac').style.display = 'block';
    document.getElementById('pb-letter').textContent = q.letter;
    const catsDiv = document.getElementById('pb-cats');
    if(catsDiv.dataset.builtFor !== String(idx)){
      catsDiv.innerHTML = ''; catsDiv.dataset.builtFor = String(idx);
      q.categories.forEach((c) => {
        catsDiv.innerHTML += `<div><span class="pb-cat-label">${escapeHtml(c)}</span><input type="text" class="field-input pb-input" data-cat="${escapeHtml(c)}"></div>`;
      });
      document.querySelectorAll('.pb-input').forEach(i => i.addEventListener('input', () => { clearTimeout(pbAutosaveTimer); pbAutosaveTimer = setTimeout(submitPb, 800); }));
    }
  } else {
    document.getElementById('question-petit-bac').style.display = 'none';
    document.getElementById('question-standard').style.display = 'block';
    document.getElementById('q-cat').textContent = CATEGORY_LABELS[q.category];
    document.getElementById('q-text').textContent = q.prompt;
    const imgEl = document.getElementById('q-image');
    if(q.image){ imgEl.style.display='flex'; imgEl.innerHTML=`<img src="${q.image}">`; } else { imgEl.style.display='none'; }
  }

  clearInterval(questionTimerInterval);
  const badge = document.getElementById('timer-badge');
  questionTimerInterval = setInterval(() => {
    const rem = Math.max(0, Math.ceil((data.questionDeadline - Date.now())/1000));
    badge.textContent = `${rem}s`; badge.classList.toggle('low', rem <= 5);
    if(rem <= 0){
      clearInterval(questionTimerInterval);
      document.getElementById('answer-input').disabled = true;
      document.querySelectorAll('.pb-input').forEach(i => i.disabled = true);
      document.getElementById('answer-locked').style.display = 'block';
      if(isHost && !advancingLock){ advancingLock = true; advanceQuestion(data, idx); }
    }
  }, 300);
}

async function submitAnswer(payload, hintId){
  try {
    await setDoc(doc(db, 'lobbies', lobbyCode, 'answers', `${lastRenderedIndex}_${MY_UID}`), {
      uid: MY_UID, name: myName, questionIndex: lastRenderedIndex, judged: false, correct: null, ...payload
    }, { merge: true });
    document.getElementById(hintId).style.display = 'block';
  } catch(e) {}
}

let answerAutosaveTimer = null;
document.getElementById('answer-input').addEventListener('input', () => {
  clearTimeout(answerAutosaveTimer);
  answerAutosaveTimer = setTimeout(() => submitAnswer({ text: document.getElementById('answer-input').value.trim() || '—', isPetitBac: false }, 'answer-hint'), 700);
});
document.getElementById('submit-answer-btn').addEventListener('click', () => submitAnswer({ text: document.getElementById('answer-input').value.trim() || '—', isPetitBac: false }, 'answer-hint'));

let pbAutosaveTimer = null;
function submitPb() {
  let pbData = {};
  document.querySelectorAll('.pb-input').forEach(i => pbData[i.dataset.cat] = { text: i.value.trim() || '—', correct: null });
  submitAnswer({ pbData, isPetitBac: true }, 'pb-hint');
}
document.getElementById('submit-pb-btn').addEventListener('click', submitPb);

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
  document.getElementById('reveal-question-text').textContent = q.prompt || `Petit Bac : Lettre ${q.letter}`;
  
  const refBox = document.getElementById('reveal-reference');
  if(q.category === 'petit_bac'){
    refBox.style.display = 'block';
    document.getElementById('reveal-reference-text').innerHTML = Object.entries(q.reference).map(([k,v]) => `<div class="pb-ref-line"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('');
  } else if (q.reference) {
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
      row.className = 'answer-row' + (!a.isPetitBac && a.judged ? (a.correct ? ' correct' : ' wrong') : '');
      
      if(a.isPetitBac){
        let pbHtml = `<div class="pb-correction-wrap"><span class="who">${escapeHtml(a.name)}</span>`;
        Object.entries(a.pbData).forEach(([cat, catData]) => {
          let btnClassYes = catData.correct === true ? 'active' : '';
          let btnClassNo = catData.correct === false ? 'active' : '';
          pbHtml += `<div class="pb-item"><strong>${escapeHtml(cat)}:</strong> ${escapeHtml(catData.text)}
            ${isHost ? `<div class="judge-btns"><button class="yes pb-judge ${btnClassYes}" data-id="${a.id}" data-cat="${cat}" data-val="true">Vrai</button><button class="no pb-judge ${btnClassNo}" data-id="${a.id}" data-cat="${cat}" data-val="false">Faux</button></div>` 
            : `<span class="verdict-icon">${catData.correct === true ? '✓' : (catData.correct === false ? '✗' : '…')}</span>`}</div>`;
        });
        row.innerHTML = pbHtml + '</div>';
      } else {
        row.innerHTML = `<span class="who">${escapeHtml(a.name)}</span><span class="text">${escapeHtml(a.text)}</span>
          ${isHost ? `<div class="judge-btns"><button class="yes" data-id="${a.id}" data-val="true">Vrai</button><button class="no" data-id="${a.id}" data-val="false">Faux</button></div>` 
          : `<span class="verdict-icon">${a.judged ? (a.correct?'✓':'✗') : '…'}</span>`}`;
      }
      container.appendChild(row);
    });

    if(isHost){
      // Boutons Standards
      container.querySelectorAll('.judge-btns > button:not(.pb-judge)').forEach(btn => btn.addEventListener('click', async () => {
        const correct = btn.dataset.val === 'true';
        const ref = doc(db, 'lobbies', lobbyCode, 'answers', btn.dataset.id);
        const snap = await getDoc(ref);
        const wasCorrect = snap.data().correct === true;
        await updateDoc(ref, { judged: true, correct });
        if(wasCorrect && !correct) updateDoc(doc(db, 'lobbies', lobbyCode, 'players', snap.data().uid), { score: increment(-1) });
        else if(!wasCorrect && correct) updateDoc(doc(db, 'lobbies', lobbyCode, 'players', snap.data().uid), { score: increment(1) });
      }));
      // Boutons Petit Bac
      container.querySelectorAll('.pb-judge').forEach(btn => btn.addEventListener('click', async () => {
        const correct = btn.dataset.val === 'true'; const cat = btn.dataset.cat;
        const ref = doc(db, 'lobbies', lobbyCode, 'answers', btn.dataset.id);
        const snap = await getDoc(ref);
        let pbData = snap.data().pbData;
        const wasCorrect = pbData[cat].correct === true;
        pbData[cat].correct = correct;
        await updateDoc(ref, { pbData });
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
  document.getElementById('final-leaderboard').innerHTML = players.map((p, i) => `<div class="leaderboard-row${i===0?' first':''}"><span>#${i+1} ${escapeHtml(p.name)}</span><strong>${p.score} pts</strong></div>`).join('');
}

document.getElementById('replay-btn').addEventListener('click', async () => {
  const playersSnap = await getDocs(collection(db, 'lobbies', lobbyCode, 'players'));
  playersSnap.forEach(d => updateDoc(doc(db, 'lobbies', lobbyCode, 'players', d.id), { score: 0 }));
  await updateDoc(doc(db, 'lobbies', lobbyCode), { status: 'lobby', questions: [], currentIndex: 0, correctionIndex: 0 });
});

document.getElementById('back-home-btn').addEventListener('click', resetToHome);

function resetToHome() {
  if(unsubLobby) unsubLobby(); if(unsubPlayers) unsubPlayers(); if(unsubAnswers) unsubAnswers();
  lobbyCode = null; document.getElementById('lobby-code-badge').style.display = 'none';
  show('screen-home');
}
