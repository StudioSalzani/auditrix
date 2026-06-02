/**
 * AUDITRIX — Application principale
 * ===================================
 * Architecture modulaire :
 *  1. AudioEngine    — synthèse, ADSR, reverb, notes, intervalles, accords
 *  2. Visualizer     — canvas FFT réactif au son
 *  3. Particles      — système de particules ambiantes
 *  4. GameState      — XP, streak, niveaux, progression
 *  5. GameLogic      — modes de jeu, génération d'exercices
 *  6. UI             — gestion des écrans, animations, interactions
 */

'use strict';

/* ============================================================
   1. AUDIO ENGINE
   Synthèse procédurale — piano électrique chaud avec reverb
   ============================================================ */
const AudioEngine = (() => {

  let ctx = null;
  let masterGain, reverbGain, dryGain;
  let convolver; // reverb

  // Analyser pour le visualiseur
  let analyser, analyserData;

  /**
   * Initialisation du contexte audio (doit être déclenché par interaction utilisateur)
   */
  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Chaîne de signal :
    //   source → dryGain ──→ masterGain → destination
    //           └─→ convolver → reverbGain ─┘
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.72;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    analyserData = new Uint8Array(analyser.frequencyBinCount);

    dryGain = ctx.createGain();
    dryGain.gain.value = 0.65;

    reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.42;

    // Reverb convolutif synthétisé (impulse response)
    convolver = ctx.createConvolver();
    convolver.buffer = buildReverbIR(ctx, 2.5, 3, false);

    dryGain.connect(masterGain);
    convolver.connect(reverbGain);
    reverbGain.connect(masterGain);
    masterGain.connect(analyser);
    analyser.connect(ctx.destination);
  }

  /**
   * Génère une impulsion de reverb artificielle
   * @param {AudioContext} c
   * @param {number} duration  — durée en secondes
   * @param {number} decay     — facteur de déclin
   * @param {boolean} reverse  — reverb inversé
   */
  function buildReverbIR(c, duration, decay, reverse) {
    const sr = c.sampleRate;
    const len = sr * duration;
    const buf = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /**
   * Convertit un numéro de demi-ton (MIDI) en fréquence Hz
   * Référence : La4 = 440 Hz = MIDI 69
   * @param {number} midi
   */
  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /**
   * Joue une note unique — synthèse de type piano électrique
   * Combine plusieurs oscillateurs pour un son chaud et harmonique
   * @param {number} midi   — numéro MIDI de la note
   * @param {number} time   — temps de départ AudioContext (ctx.currentTime + délai)
   * @param {number} dur    — durée en secondes
   * @param {number} vel    — vélocité [0-1]
   */
  function playNote(midi, time, dur = 1.6, vel = 0.75) {
    if (!ctx) init();
    const freq = midiToHz(midi);
    const now = time || ctx.currentTime;

    // ── Enveloppe ADSR ──
    const attack  = 0.008;
    const decay   = 0.18;
    const sustain = 0.52;
    const release = 1.2;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(vel, now + attack);
    env.gain.exponentialRampToValueAtTime(vel * sustain, now + attack + decay);
    env.gain.setValueAtTime(vel * sustain, now + dur);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur + release);
    env.connect(dryGain);
    env.connect(convolver);

    // ── Fondamentale (sine douce) ──
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    const g1 = ctx.createGain();
    g1.gain.value = 0.6;
    osc1.connect(g1); g1.connect(env);

    // ── 2e harmonique (triangle doux) pour corps ──
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    osc2.connect(g2); g2.connect(env);

    // ── Octave supérieure (sine atténué) pour brillance ──
    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.value = freq * 2;
    const g3 = ctx.createGain();
    g3.gain.value = 0.07;
    osc3.connect(g3); g3.connect(env);

    // ── Harmonique 5e (très doux) pour chaleur ──
    const osc4 = ctx.createOscillator();
    osc4.type = 'sine';
    osc4.frequency.value = freq * 3;
    const g4 = ctx.createGain();
    g4.gain.value = 0.025;
    osc4.connect(g4); g4.connect(env);

    // ── Filtre passe-bas pour adoucir ──
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3800;
    filter.Q.value = 0.7;
    g1.disconnect(); g2.disconnect(); g3.disconnect(); g4.disconnect();
    osc1.connect(filter); osc2.connect(filter);
    osc3.connect(filter); osc4.connect(filter);
    filter.connect(g1);
    // Simplifié : on connecte filter directement à env
    filter.disconnect();
    const gFinal = ctx.createGain();
    gFinal.gain.value = vel;
    osc1.connect(filter); osc2.connect(filter);
    osc3.connect(filter); osc4.connect(filter);
    filter.connect(env);

    // Démarrage et arrêt
    [osc1,osc2,osc3,osc4].forEach(o => {
      o.start(now);
      o.stop(now + dur + release + 0.1);
    });
  }

  /**
   * Joue un intervalle (deux notes) — séquentiel ou harmonique
   * @param {number} rootMidi
   * @param {number} semitones  — demi-tons de l'intervalle
   * @param {boolean} harmonic  — simultané si true
   */
  function playInterval(rootMidi, semitones, harmonic = false) {
    if (!ctx) init();
    const now = ctx.currentTime + 0.05;
    if (harmonic) {
      playNote(rootMidi, now);
      playNote(rootMidi + semitones, now);
    } else {
      playNote(rootMidi, now, 1.4);
      playNote(rootMidi + semitones, now + 0.62);
    }
  }

  /**
   * Joue un accord (chord)
   * @param {number} rootMidi
   * @param {number[]} intervals  — tableau de demi-tons
   */
  function playChord(rootMidi, intervals, startTime) {
    if (!ctx) init();
    const now = startTime !== undefined ? startTime : ctx.currentTime + 0.05;
    // Léger arpège pour rendre le son plus naturel
    intervals.forEach((semi, i) => {
      playNote(rootMidi + semi, now + i * 0.022, 1.8, 0.62);
    });
  }

  /**
   * Accès à l'analyser pour le visualiseur
   */
  function getAnalyserData() {
    if (!analyser) return null;
    analyser.getByteFrequencyData(analyserData);
    return analyserData;
  }

  function getWaveformData() {
    if (!analyser) return null;
    const waveform = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(waveform);
    return waveform;
  }

  function getCtx() { return ctx; }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  return { init, playNote, playInterval, playChord, getAnalyserData, getWaveformData, getCtx, resume, midiToHz };
})();

/* ============================================================
   2. DONNÉES MUSICALES
   Intervalles, accords, noms français
   ============================================================ */
const MusicData = (() => {

  // Notes françaises
  const NOTE_NAMES = ['Do','Do♯','Ré','Ré♯','Mi','Fa','Fa♯','Sol','Sol♯','La','La♯','Si'];

  // Intervalles — nom, demi-tons, exemple célèbre, consonance
  const INTERVALS = [
    { id:'unison',   semitones:0,  name:'Unisson',         example:'même note',          consonance:1.0 },
    { id:'min2',     semitones:1,  name:'2nde mineure',     example:'Jaws (Les Dents de la Mer)', consonance:0.1 },
    { id:'maj2',     semitones:2,  name:'2nde majeure',     example:'Happy Birthday',     consonance:0.5 },
    { id:'min3',     semitones:3,  name:'3ce mineure',      example:'Smoke on the Water', consonance:0.75 },
    { id:'maj3',     semitones:4,  name:'3ce majeure',      example:'When the Saints',    consonance:0.8 },
    { id:'perf4',    semitones:5,  name:'4te juste',        example:'Amazing Grace',      consonance:0.85 },
    { id:'tritone',  semitones:6,  name:'Triton',           example:'The Simpsons',       consonance:0.05 },
    { id:'perf5',    semitones:7,  name:'5te juste',        example:'Star Wars',          consonance:0.95 },
    { id:'min6',     semitones:8,  name:'6te mineure',      example:'The Entertainer',    consonance:0.7 },
    { id:'maj6',     semitones:9,  name:'6te majeure',      example:'My Bonnie',          consonance:0.72 },
    { id:'min7',     semitones:10, name:'7ème mineure',     example:'Somewhere',          consonance:0.55 },
    { id:'maj7',     semitones:11, name:'7ème majeure',     example:'Take On Me',         consonance:0.45 },
    { id:'octave',   semitones:12, name:'Octave',           example:'Somewhere Over the Rainbow', consonance:1.0 },
  ];

  // Accords — intervals en demi-tons depuis la fondamentale
  const CHORDS = [
    { id:'major',  name:'Majeur',      shortName:'MAJ',  intervals:[0,4,7],    description:'Lumineux, joyeux' },
    { id:'minor',  name:'Mineur',      shortName:'min',  intervals:[0,3,7],    description:'Sombre, mélancolique' },
    { id:'dom7',   name:'7ème dom.',   shortName:'7',    intervals:[0,4,7,10], description:'Tension, blues' },
    { id:'maj7',   name:'Maj 7ème',    shortName:'Maj7', intervals:[0,4,7,11], description:'Doux, jazz' },
    { id:'min7',   name:'Min 7ème',    shortName:'m7',   intervals:[0,3,7,10], description:'Cool, soul' },
    { id:'dim',    name:'Diminué',     shortName:'dim',  intervals:[0,3,6],    description:'Instable, dramatique' },
    { id:'aug',    name:'Augmenté',    shortName:'aug',  intervals:[0,4,8],    description:'Mystérieux, ambigu' },
  ];

  function getNoteName(midi) {
    return NOTE_NAMES[midi % 12];
  }

  function getIntervalById(id) {
    return INTERVALS.find(i => i.id === id);
  }

  function getChordById(id) {
    return CHORDS.find(c => c.id === id);
  }

  return { NOTE_NAMES, INTERVALS, CHORDS, getNoteName, getIntervalById, getChordById };
})();

/* ============================================================
   3. GAME STATE
   XP, streak, niveaux, persistance localStorage
   ============================================================ */
const GameState = (() => {

  const WORLD_UNLOCK_XP = [0, 0, 50, 150, 300, 500];

  let state = {
    xp: 0,
    bestStreak: 0,
    currentStreak: 0,
    combo: 0,
    totalPlayed: 0,
    totalCorrect: 0,
  };

  function load() {
    try {
      const s = localStorage.getItem('auditrix_state');
      if (s) state = { ...state, ...JSON.parse(s) };
    } catch(e) {}
  }

  function save() {
    try { localStorage.setItem('auditrix_state', JSON.stringify(state)); } catch(e) {}
  }

  function addXP(amount) {
    state.xp += amount;
    if (state.currentStreak > state.bestStreak) state.bestStreak = state.currentStreak;
    save();
  }

  function onCorrect() {
    state.currentStreak++;
    state.combo++;
    state.totalCorrect++;
    state.totalPlayed++;
    if (state.currentStreak > state.bestStreak) state.bestStreak = state.currentStreak;
    save();
    // XP avec bonus combo
    let xpGain = 10;
    if (state.combo >= 10) xpGain = 25;
    else if (state.combo >= 5) xpGain = 17;
    return xpGain;
  }

  function onWrong() {
    state.currentStreak = 0;
    state.combo = 0;
    state.totalPlayed++;
    save();
  }

  function isWorldUnlocked(worldNum) {
    return state.xp >= WORLD_UNLOCK_XP[worldNum];
  }

  function getWorldXPProgress(worldNum) {
    const needed = WORLD_UNLOCK_XP[worldNum + 1] || WORLD_UNLOCK_XP[worldNum] + 200;
    const base = WORLD_UNLOCK_XP[worldNum];
    return Math.min(1, (state.xp - base) / (needed - base));
  }

  function getComboLabel() {
    if (state.combo >= 20) return '✦ LEGENDAIRE ✦';
    if (state.combo >= 15) return '⚡ INCROYABLE';
    if (state.combo >= 10) return '🔥 EN FEU';
    if (state.combo >= 7)  return '⭐ SUPER COMBO';
    if (state.combo >= 5)  return '× ' + state.combo + ' COMBO';
    return null;
  }

  return { load, save, addXP, onCorrect, onWrong, isWorldUnlocked, getWorldXPProgress, getComboLabel,
    get: () => state };
})();

/* ============================================================
   4. GAME LOGIC
   Génération d'exercices par monde
   ============================================================ */
const GameLogic = (() => {

  // Exercice courant
  let current = null;

  // Plage de notes de base (Do3 à La4 pour sonnorité agréable)
  const ROOT_MIN = 48; // C3
  const ROOT_MAX = 69; // A4

  function randomRoot() {
    return ROOT_MIN + Math.floor(Math.random() * (ROOT_MAX - ROOT_MIN + 1));
  }

  /* ── Monde 1 : Montée / Descente / Même note ── */
  function generateWorld1() {
    const root = randomRoot();
    // Intervalle aléatoire entre 1 et 9 demi-tons
    const interval = 1 + Math.floor(Math.random() * 9);
    const type = Math.random();
    let note1, note2, answer;
    if (type < 0.1) { note1 = root; note2 = root; answer = 'same'; }
    else if (type < 0.55) { note1 = root; note2 = root + interval; answer = 'up'; }
    else { note1 = root + interval; note2 = root; answer = 'down'; }
    return {
      world: 1,
      note1, note2,
      answer,
      play: () => {
        AudioEngine.init();
        const now = AudioEngine.getCtx().currentTime + 0.05;
        AudioEngine.playNote(note1, now, 1.2);
        AudioEngine.playNote(note2, now + 0.7);
      },
      choices: [
        { id:'up',   label:'↑ MONTÉE' },
        { id:'same', label:'= MÊME' },
        { id:'down', label:'↓ DESCENTE' },
      ]
    };
  }

  /* ── Monde 2 : Intervalles simples ── */
  const W2_INTERVALS = ['min2','maj2','min3','maj3','perf4','perf5','octave'];
  function generateWorld2() {
    const id = W2_INTERVALS[Math.floor(Math.random() * W2_INTERVALS.length)];
    const idata = MusicData.getIntervalById(id);
    const root = randomRoot();
    return {
      world: 2,
      intervalId: id,
      root,
      semitones: idata.semitones,
      answer: id,
      play: () => AudioEngine.playInterval(root, idata.semitones, false),
      choices: W2_INTERVALS.map(iid => ({
        id: iid,
        label: MusicData.getIntervalById(iid).name
      }))
    };
  }

  /* ── Monde 3 : Tous les intervalles ── */
  const W3_INTERVALS = ['min2','maj2','min3','maj3','perf4','tritone','perf5','min6','maj6','min7','maj7','octave'];
  function generateWorld3() {
    const id = W3_INTERVALS[Math.floor(Math.random() * W3_INTERVALS.length)];
    const idata = MusicData.getIntervalById(id);
    const root = randomRoot();
    return {
      world: 3,
      intervalId: id,
      root,
      semitones: idata.semitones,
      answer: id,
      play: () => AudioEngine.playInterval(root, idata.semitones, false),
      choices: W3_INTERVALS.map(iid => ({
        id: iid,
        label: MusicData.getIntervalById(iid).name
      }))
    };
  }

  /* ── Monde 4 : Accords ── */
  const W4_CHORDS = ['major','minor','dom7','maj7','min7'];
  function generateWorld4() {
    const id = W4_CHORDS[Math.floor(Math.random() * W4_CHORDS.length)];
    const cdata = MusicData.getChordById(id);
    const root = randomRoot();
    return {
      world: 4,
      chordId: id,
      root,
      rootName: MusicData.getNoteName(root),
      answer: id,
      play: () => AudioEngine.playChord(root, cdata.intervals),
      choices: W4_CHORDS.map(cid => ({
        id: cid,
        label: MusicData.getChordById(cid).name
      }))
    };
  }

  /* ── Monde 5 : Progressions d'accords ──
   *
   * On joue une progression de 4 accords dans une tonalité aléatoire.
   * L'utilisateur doit identifier quelle progression parmi 4 proposées
   * correspond à ce qu'il vient d'entendre.
   *
   * Chaque degré romain est traduit en demi-tons depuis la tonique.
   * Intervalles de la gamme majeure : 0,2,4,5,7,9,11
   *
   * Pour chaque degré :
   *   I   → majeur  (0,4,7)
   *   II  → mineur  (0,3,7)   [2 demi-tons]
   *   III → mineur  (0,3,7)   [4 demi-tons]
   *   IV  → majeur  (0,4,7)   [5 demi-tons]
   *   V   → majeur  (0,4,7)   [7 demi-tons]
   *   VI  → mineur  (0,3,7)   [9 demi-tons]
   *   VII → dim     (0,3,6)   [11 demi-tons]
   */
  const SCALE_DEGREES = {
    //  [demi-ton depuis tonique, qualité d'accord]
    'I':   [0,  'major'],
    'II':  [2,  'minor'],
    'III': [4,  'minor'],
    'IV':  [5,  'major'],
    'V':   [7,  'major'],
    'vi':  [9,  'minor'],
    'vii': [11, 'dim'],
  };

  // Intervalles pour chaque qualité d'accord (même que MusicData.CHORDS)
  const CHORD_SHAPES = {
    major: [0,4,7],
    minor: [0,3,7],
    dom7:  [0,4,7,10],
    dim:   [0,3,6],
  };

  // Catalogue de progressions — nom affiché + degrés
  const PROGRESSIONS = [
    { id:'I-IV-V-I',     label:'I – IV – V – I',     degrees:['I','IV','V','I'],    description:'Cadence parfaite classique' },
    { id:'I-V-vi-IV',    label:'I – V – vi – IV',    degrees:['I','V','vi','IV'],   description:'La progression pop par excellence' },
    { id:'I-vi-IV-V',    label:'I – vi – IV – V',    degrees:['I','vi','IV','V'],   description:'Années 50 / doo-wop' },
    { id:'vi-IV-I-V',    label:'vi – IV – I – V',    degrees:['vi','IV','I','V'],   description:'Mineur relatif — mélancolique' },
    { id:'I-V-iv-I',     label:'I – V – iv – I',     degrees:['I','V','II','I'],    description:'Emprunt au mode mineur' },
    { id:'I-ii-V-I',     label:'I – II – V – I',     degrees:['I','II','V','I'],    description:'Cadence jazz II-V-I' },
    { id:'I-vi-ii-V',    label:'I – vi – II – V',    degrees:['I','vi','II','V'],   description:'Tournante jazz' },
    { id:'I-IV-vi-V',    label:'I – IV – vi – V',    degrees:['I','IV','vi','V'],   description:'Variante pop moderne' },
    { id:'vi-V-IV-III',  label:'vi – V – IV – III',  degrees:['vi','V','IV','III'], description:'Descente chromatique' },
    { id:'I-III-IV-iv',  label:'I – III – IV – iv',  degrees:['I','III','IV','II'], description:'Changement modal' },
  ];

  /**
   * Joue une progression dans la tonalité `rootMidi`
   * Chaque accord est arpeggé légèrement, espacés de `spacing` secondes
   */
  function playProgression(rootMidi, degrees, spacing = 1.15) {
    AudioEngine.init();
    const now = AudioEngine.getCtx().currentTime + 0.05;
    degrees.forEach((deg, i) => {
      const [semitone, quality] = SCALE_DEGREES[deg];
      const shape = CHORD_SHAPES[quality] || CHORD_SHAPES.major;
      const chordRoot = rootMidi + semitone;
      AudioEngine.playChord(chordRoot, shape, now + i * spacing);
    });
  }

  function generateWorld5() {
    // Tonique dans une plage grave-médium pour sonner plein
    const root = 48 + Math.floor(Math.random() * 10); // C3 à A3
    const tonique = MusicData.getNoteName(root);

    // Choisir la progression cible aléatoirement
    const shuffled = [...PROGRESSIONS].sort(() => Math.random() - 0.5);
    const target = shuffled[0];

    // Générer 3 distracteurs proches (partagent 2 degrés avec la cible)
    const distractors = shuffled.slice(1, 4);

    // Mélanger les 4 options et mémoriser l'index de la bonne réponse
    const options = [target, ...distractors].sort(() => Math.random() - 0.5);
    const answerIdx = options.findIndex(p => p.id === target.id);

    // Durée totale de la progression (4 accords × spacing + queue)
    const spacing = 1.15;
    const totalDuration = 4 * spacing * 1000 + 800;

    return {
      world: 5,
      root,
      tonique,
      progressionId: target.id,
      answer: String(answerIdx),
      totalDuration,
      play: () => playProgression(root, target.degrees, spacing),
      choices: options.map((p, i) => ({
        id: String(i),
        label: p.label,
      }))
    };
  }

  function generate(worldNum) {
    switch(worldNum) {
      case 1: current = generateWorld1(); break;
      case 2: current = generateWorld2(); break;
      case 3: current = generateWorld3(); break;
      case 4: current = generateWorld4(); break;
      case 5: current = generateWorld5(); break;
      default: current = generateWorld1();
    }
    return current;
  }

  function getCurrent() { return current; }

  return { generate, getCurrent };
})();

/* ============================================================
   5. VISUALIZER
   Canvas réactif au FFT audio — style ambient/oscilloscope
   ============================================================ */
const Visualizer = (() => {

  let canvas, ctx;
  let W, H;
  let frame = 0;
  let lastAnswer = null; // 'correct' | 'wrong' | null
  let answerTime = 0;

  // Historique FFT pour les trails
  let fftHistory = [];
  const FFT_HISTORY_LEN = 8;

  function init() {
    canvas = document.getElementById('visualizer');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    render();
  }

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function onAnswer(type) {
    lastAnswer = type;
    answerTime = performance.now();
  }

  function render() {
    requestAnimationFrame(render);
    frame++;

    const fftData = AudioEngine.getAnalyserData();
    const waveData = AudioEngine.getWaveformData();

    // Fond — trail effect (persist partiel)
    ctx.fillStyle = 'rgba(8,10,15,0.18)';
    ctx.fillRect(0, 0, W, H);

    if (!fftData) {
      drawIdle();
      return;
    }

    // ── Calcul niveau global ──
    let sum = 0;
    for (let i = 0; i < fftData.length; i++) sum += fftData[i];
    const avg = sum / fftData.length;
    const level = avg / 255;

    // ── Niveau basses (< 200Hz) ──
    let bassSum = 0;
    const bassEnd = Math.floor(fftData.length * 0.06);
    for (let i = 0; i < bassEnd; i++) bassSum += fftData[i];
    const bass = (bassSum / bassEnd) / 255;

    // ── Couleur en fonction de la réponse ──
    const elapsed = (performance.now() - answerTime) / 1000;
    let accentColor = [76, 243, 200]; // vert-cyan par défaut
    if (lastAnswer === 'correct' && elapsed < 1.5) {
      const t = elapsed / 1.5;
      accentColor = lerpColor([76,243,200], [76,243,200], t);
    } else if (lastAnswer === 'wrong' && elapsed < 1.5) {
      const t = elapsed / 1.5;
      accentColor = lerpColor([255,68,102], [76,243,200], t);
    }

    // ── Cercles harmoniques ──
    drawCircularFFT(fftData, accentColor, level, bass);

    // ── Oscilloscope annulaire ──
    if (waveData) drawOscilloscope(waveData, accentColor, level);

    // ── Explosion de réponse ──
    if (elapsed < 0.8 && lastAnswer) {
      drawAnswerBurst(lastAnswer, elapsed);
    }
  }

  function drawIdle() {
    // Vague douce au repos
    const t = frame * 0.012;
    ctx.strokeStyle = 'rgba(76,243,200,0.06)';
    ctx.lineWidth = 1;
    for (let ring = 0; ring < 3; ring++) {
      const r = 80 + ring * 50 + Math.sin(t + ring) * 8;
      ctx.beginPath();
      ctx.arc(W/2, H/2, r, 0, Math.PI*2);
      ctx.stroke();
    }
  }

  /**
   * Visualiseur FFT circulaire
   * Les fréquences sont mappées sur un cercle
   * Les intervals consonants → formes douces, dissonants → chaos
   */
  function drawCircularFFT(data, color, level, bass) {
    const cx = W / 2, cy = H / 2;
    const baseRadius = Math.min(W, H) * 0.18 + bass * 40;
    const maxRadius = Math.min(W, H) * 0.32;
    const points = 128;
    const step = Math.floor(data.length / points);

    // Couche 1 — forme principale remplie
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
      const val = data[i * step] / 255;
      const r = baseRadius + val * (maxRadius - baseRadius);
      const wobble = Math.sin(frame * 0.02 + i * 0.3) * 2;
      const rx = cx + Math.cos(angle) * (r + wobble);
      const ry = cy + Math.sin(angle) * (r + wobble);
      i === 0 ? ctx.moveTo(rx, ry) : ctx.lineTo(rx, ry);
    }
    ctx.closePath();
    const grad = ctx.createRadialGradient(cx, cy, baseRadius * 0.5, cx, cy, maxRadius);
    grad.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},0.04)`);
    grad.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0.01)`);
    ctx.fillStyle = grad;
    ctx.fill();

    // Couche 2 — contour lumineux
    ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.35 + level * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Couche 3 — cercle miroir inversé (effet symétrie)
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
      const val = data[i * step] / 255;
      const r = baseRadius * 0.6 - val * 20;
      const rx = cx + Math.cos(angle) * r;
      const ry = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(rx, ry) : ctx.lineTo(rx, ry);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.1)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Couche 4 — rayon glow central
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 0.8);
    glow.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${bass * 0.12})`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Oscilloscope annulaire — forme d'onde en cercle
   */
  function drawOscilloscope(data, color, level) {
    const cx = W / 2, cy = H / 2;
    const radius = Math.min(W, H) * 0.12;
    const step = Math.floor(data.length / 256);

    ctx.beginPath();
    ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.25 + level * 0.3})`;
    ctx.lineWidth = 1;

    for (let i = 0; i <= 256; i++) {
      const angle = (i / 256) * Math.PI * 2 - Math.PI / 2;
      const val = (data[i * step] / 128) - 1; // [-1, 1]
      const r = radius + val * 18;
      const rx = cx + Math.cos(angle) * r;
      const ry = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(rx, ry) : ctx.lineTo(rx, ry);
    }
    ctx.closePath();
    ctx.stroke();
  }

  /**
   * Explosion visuelle lors d'une réponse
   */
  function drawAnswerBurst(type, elapsed) {
    const cx = W / 2, cy = H / 2;
    const t = elapsed / 0.8; // [0, 1]
    const maxR = Math.min(W, H) * 0.5;
    const r = t * maxR;
    const alpha = (1 - t) * 0.5;

    if (type === 'correct') {
      ctx.strokeStyle = `rgba(76,243,200,${alpha})`;
    } else {
      ctx.strokeStyle = `rgba(255,68,102,${alpha})`;
    }
    ctx.lineWidth = 3 * (1 - t);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Deuxième anneau décalé
    const r2 = t * maxR * 0.6;
    ctx.lineWidth = 2 * (1 - t);
    ctx.beginPath();
    ctx.arc(cx, cy, r2, 0, Math.PI * 2);
    ctx.stroke();
  }

  function lerpColor(a, b, t) {
    return [
      Math.round(a[0] + (b[0]-a[0])*t),
      Math.round(a[1] + (b[1]-a[1])*t),
      Math.round(a[2] + (b[2]-a[2])*t),
    ];
  }

  return { init, onAnswer };
})();

/* ============================================================
   6. PARTICLES — Système de particules ambiantes
   Fond étoilé réactif au son
   ============================================================ */
const Particles = (() => {

  let canvas, ctx;
  let W, H;
  let particles = [];
  const COUNT = 60;

  class Particle {
    constructor() { this.reset(true); }
    reset(initial = false) {
      this.x = Math.random() * W;
      this.y = initial ? Math.random() * H : H + 5;
      this.size = 0.5 + Math.random() * 1.5;
      this.speedY = -(0.1 + Math.random() * 0.3);
      this.speedX = (Math.random() - 0.5) * 0.15;
      this.alpha = 0;
      this.targetAlpha = 0.1 + Math.random() * 0.25;
      this.twinkle = Math.random() * Math.PI * 2;
      this.hue = 150 + Math.random() * 80; // vert-cyan-bleu
    }
    update(level) {
      this.y += this.speedY * (1 + level * 2);
      this.x += this.speedX;
      this.twinkle += 0.025;
      this.alpha += (this.targetAlpha - this.alpha) * 0.04;
      if (this.y < -10) this.reset();
    }
    draw(c) {
      const a = this.alpha * (0.7 + 0.3 * Math.sin(this.twinkle));
      c.beginPath();
      c.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      c.fillStyle = `hsla(${this.hue},80%,75%,${a})`;
      c.fill();
    }
  }

  function init() {
    canvas = document.getElementById('particles');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    for (let i = 0; i < COUNT; i++) particles.push(new Particle());
    render();
  }

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function render() {
    requestAnimationFrame(render);
    ctx.clearRect(0, 0, W, H);
    const fftData = AudioEngine.getAnalyserData();
    let level = 0;
    if (fftData) {
      let s = 0; for (let i of fftData) s += i;
      level = (s / fftData.length) / 255;
    }
    particles.forEach(p => { p.update(level); p.draw(ctx); });
  }

  return { init };
})();

/* ============================================================
   7. UI CONTROLLER
   Navigation entre écrans, rendu des boutons, feedback
   ============================================================ */
const UI = (() => {

  let currentScreen = 'menu';
  let currentWorld = null;
  let waitingForPlay = true;
  let answered = false;
  let feedbackTimer = null;
  let transitioning = false; // verrou entre deux exercices

  // Éléments DOM
  const screens = {
    menu: document.getElementById('screen-menu'),
    game: document.getElementById('screen-game'),
    discover: document.getElementById('screen-discover'),
  };

  /* ── Navigation ── */
  function showScreen(name) {
    Object.entries(screens).forEach(([k, el]) => {
      el.classList.toggle('active', k === name);
    });
    currentScreen = name;
  }

  /* ── Mise à jour des stats du menu ── */
  function updateMenuStats() {
    const s = GameState.get();
    document.getElementById('total-xp').textContent = s.xp;
    document.getElementById('best-streak').textContent = s.bestStreak;
    document.getElementById('total-played').textContent = s.totalPlayed;

    // Unlock des mondes
    for (let w = 2; w <= 5; w++) {
      const card = document.getElementById(`world-${w}`);
      const unlocked = GameState.isWorldUnlocked(w);
      card.classList.toggle('locked', !unlocked);
      card.classList.toggle('unlocked', unlocked);
    }

    // Barres XP
    for (let w = 1; w <= 5; w++) {
      const bar = document.getElementById(`xp-bar-${w}`);
      if (bar) bar.style.width = (GameState.getWorldXPProgress(w) * 100) + '%';
    }
  }

  /* ── Démarrer un monde ── */
  function startWorld(worldNum) {
    currentWorld = worldNum;
    AudioEngine.init();
    document.getElementById('game-world-name').textContent = getWorldLabel(worldNum);
    updateGameStats();
    showScreen('game');
    nextExercise();
  }

  function getWorldLabel(w) {
    const labels = ['','MONTÉE / DESCENTE','INTERVALLES','INTERVALLES+','ACCORDS','MÉMOIRE'];
    return labels[w] || '';
  }

  /* ── Prochain exercice ── */
  function nextExercise() {
    answered = false;
    waitingForPlay = true;
    transitioning = false; // exercice prêt, on déverrouille
    clearTimeout(feedbackTimer);

    const ex = GameLogic.generate(currentWorld);

    // Masquer le feedback
    const overlay = document.getElementById('feedback-overlay');
    overlay.classList.remove('show');

    // Bouton play
    const playBtn = document.getElementById('btn-play');
    playBtn.classList.remove('playing');
    const hint = document.getElementById('play-hint');
    hint.textContent = 'appuie pour écouter';
    playBtn.style.opacity = '';

    // Root note (pour monde 4 et 5)
    const rootDisplay = document.getElementById('root-note-display');
    const rootLabel = document.getElementById('root-note-label');
    if (ex.world === 4) {
      rootDisplay.style.display = '';
      rootLabel.className = '';
      rootLabel.textContent = ex.rootName;
    } else if (ex.world === 5) {
      rootDisplay.style.display = '';
      rootLabel.className = 'small';
      rootLabel.textContent = 'tonique : ' + ex.tonique;
    } else {
      rootDisplay.style.display = 'none';
    }

    // Rendre les boutons de réponse
    renderAnswerButtons(ex);

    // Masquer combo
    updateComboDisplay();
  }

  /* ── Rendu des boutons de réponse ── */
  function renderAnswerButtons(ex) {
    const zone = document.getElementById('answers-zone');
    zone.innerHTML = '';
    zone.className = 'answers-zone' + (ex.world === 5 ? ' progression-mode' : '');

    const shortcuts = ['1','2','3','4','5','6','7','8'];

    ex.choices.forEach((choice, i) => {
      const btn = document.createElement('button');
      btn.className = 'answer-btn disabled';
      btn.dataset.id = choice.id;
      btn.innerHTML = `${choice.label}<span class="answer-shortcut">${shortcuts[i] || ''}</span>`;
      btn.addEventListener('click', () => handleAnswer(choice.id));
      zone.appendChild(btn);
    });
  }

  /* ── Jouer le son + activer boutons ── */
  function playCurrentExercise() {
    const ex = GameLogic.getCurrent();
    if (!ex || transitioning) return; // bloqué pendant la transition

    AudioEngine.resume();
    ex.play();

    const playBtn = document.getElementById('btn-play');
    playBtn.classList.add('playing');
    document.getElementById('play-hint').textContent = '...';

    // Durée du son avant d'activer les boutons
    const delay = ex.world === 5 ? ex.totalDuration : 1600;
    setTimeout(() => {
      if (!answered) {
        playBtn.classList.remove('playing');
        document.getElementById('play-hint').textContent = 'rejouer ↺';
        enableAnswerButtons();
      }
    }, delay);
  }

  function enableAnswerButtons() {
    document.querySelectorAll('.answer-btn').forEach(btn => {
      btn.classList.remove('disabled');
    });
  }

  /* ── Traitement de la réponse ── */
  function handleAnswer(choiceId) {
    if (answered) return;
    answered = true;
    transitioning = true; // verrou : on bloque le bouton play jusqu'au prochain exercice

    const ex = GameLogic.getCurrent();
    const isCorrect = choiceId === ex.answer;

    // Feedback visuel sur les boutons
    document.querySelectorAll('.answer-btn').forEach(btn => {
      btn.classList.add('disabled');
      if (btn.dataset.id === ex.answer) btn.classList.add('correct');
      else if (btn.dataset.id === choiceId && !isCorrect) btn.classList.add('wrong');
    });

    // Feedback sonore
    playFeedbackSound(isCorrect);

    // Feedback visuel central
    showFeedback(isCorrect);

    // Réponse visuelle
    Visualizer.onAnswer(isCorrect ? 'correct' : 'wrong');

    // Mise à jour XP
    let xpGain = 0;
    if (isCorrect) {
      xpGain = GameState.onCorrect();
      GameState.addXP(xpGain);
      showXPPopup('+' + xpGain + ' XP');
    } else {
      GameState.onWrong();
    }
    updateGameStats();

    // Griser le bouton play pendant la transition
    const playBtn = document.getElementById('btn-play');
    playBtn.classList.remove('playing');
    document.getElementById('play-hint').textContent = '···';
    playBtn.style.opacity = '0.35';

    // Prochain exercice automatique
    feedbackTimer = setTimeout(() => {
      nextExercise();
    }, isCorrect ? 950 : 1400);
  }

  function playFeedbackSound(isCorrect) {
    try {
      const c = AudioEngine.getCtx();
      if (!c) return;
      const now = c.currentTime + 0.01;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.connect(g); g.connect(c.destination);
      if (isCorrect) {
        osc.frequency.value = 880;
        g.gain.setValueAtTime(0.08, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
        osc.type = 'sine';
      } else {
        osc.frequency.value = 200;
        g.gain.setValueAtTime(0.06, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        osc.type = 'square';
      }
      osc.start(now); osc.stop(now + 0.3);
    } catch(e) {}
  }

  function showFeedback(isCorrect) {
    const overlay = document.getElementById('feedback-overlay');
    const content = document.getElementById('feedback-content');
    content.className = 'feedback-content ' + (isCorrect ? 'correct' : 'wrong');
    content.textContent = isCorrect ? '✓' : '✗';
    overlay.classList.remove('show');
    void overlay.offsetWidth; // force reflow
    overlay.classList.add('show');
    setTimeout(() => overlay.classList.remove('show'), isCorrect ? 900 : 1300);
  }

  function updateGameStats() {
    const s = GameState.get();
    document.getElementById('streak-count').textContent = s.currentStreak;
    const fire = document.getElementById('streak-fire');
    fire.textContent = s.currentStreak >= 5 ? '🔥' : '';
    document.getElementById('xp-display').textContent = s.xp + ' XP';
  }

  function updateComboDisplay() {
    const label = GameState.getComboLabel();
    const el = document.getElementById('combo-display');
    if (label) {
      el.style.display = '';
      document.getElementById('combo-text').textContent = label;
    } else {
      el.style.display = 'none';
    }
  }

  /* ── Popup XP ── */
  function showXPPopup(text) {
    const el = document.getElementById('xp-popup');
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /* ── Mode Découverte ── */
  let discoverType = 'interval';
  let discoverSelA = null;
  let discoverSelB = null;
  let discoverComparing = false;
  let compareInterval = null;

  function initDiscover() {
    renderDiscoverItems();
    updateDiscoverInfo();

    document.getElementById('discover-play-a').addEventListener('click', () => {
      if (!discoverSelA) return;
      AudioEngine.resume();
      playDiscoverItem(discoverSelA);
    });
    document.getElementById('discover-play-b').addEventListener('click', () => {
      if (!discoverSelB) return;
      AudioEngine.resume();
      playDiscoverItem(discoverSelB);
    });
    document.getElementById('discover-compare').addEventListener('click', () => {
      if (!discoverSelA || !discoverSelB) return;
      AudioEngine.resume();
      discoverComparing = !discoverComparing;
      document.getElementById('discover-compare').classList.toggle('active', discoverComparing);
      if (discoverComparing) {
        runCompare();
      } else {
        clearInterval(compareInterval);
      }
    });

    document.querySelectorAll('.dtab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.dtab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        discoverType = tab.dataset.type;
        discoverSelA = null; discoverSelB = null;
        renderDiscoverItems();
        updateDiscoverInfo();
      });
    });
  }

  function renderDiscoverItems() {
    const container = document.getElementById('discover-items');
    container.innerHTML = '';
    const items = discoverType === 'interval' ? MusicData.INTERVALS : MusicData.CHORDS;
    items.forEach(item => {
      const btn = document.createElement('div');
      btn.className = 'discover-item';
      btn.dataset.id = item.id;
      btn.textContent = item.name || item.shortName;
      btn.title = item.name;
      btn.addEventListener('click', () => selectDiscoverItem(item.id, btn));
      container.appendChild(btn);
    });
  }

  function selectDiscoverItem(id, btn) {
    // Clic 1 → sélection A, clic 2 → sélection B
    document.querySelectorAll('.discover-item').forEach(b => {
      b.classList.remove('selected-a', 'selected-b');
    });
    if (!discoverSelA || discoverSelA === id) {
      discoverSelA = id;
      btn.classList.add('selected-a');
      if (discoverSelB) {
        const bBtn = document.querySelector(`.discover-item[data-id="${discoverSelB}"]`);
        if (bBtn) bBtn.classList.add('selected-b');
      }
    } else {
      discoverSelB = id;
      btn.classList.add('selected-b');
      const aBtn = document.querySelector(`.discover-item[data-id="${discoverSelA}"]`);
      if (aBtn) aBtn.classList.add('selected-a');
    }
    // Jouer immédiatement
    AudioEngine.resume();
    playDiscoverItem(id);
    updateDiscoverInfo();
  }

  function playDiscoverItem(id) {
    const root = 60; // Do4
    if (discoverType === 'interval') {
      const item = MusicData.getIntervalById(id);
      if (item) AudioEngine.playInterval(root, item.semitones, false);
    } else {
      const item = MusicData.getChordById(id);
      if (item) AudioEngine.playChord(root, item.intervals);
    }
  }

  function runCompare() {
    let toggle = true;
    clearInterval(compareInterval);
    playDiscoverItem(discoverSelA);
    compareInterval = setInterval(() => {
      const id = toggle ? discoverSelB : discoverSelA;
      playDiscoverItem(id);
      toggle = !toggle;
    }, 2200);
  }

  function updateDiscoverInfo() {
    const el = document.getElementById('discover-info');
    if (!discoverSelA) {
      el.innerHTML = '<span style="color:var(--text-muted);font-size:10px;letter-spacing:.1em">Sélectionne un élément pour l\'écouter</span>';
      return;
    }
    const item = discoverType === 'interval'
      ? MusicData.getIntervalById(discoverSelA)
      : MusicData.getChordById(discoverSelA);
    if (!item) return;
    el.innerHTML = `
      <span class="di-name">${item.name}</span>
      <span class="di-example">${item.example || item.description || ''}</span>
    `;
  }

  /* ── Clavier ── */
  function initKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.repeat) return;
      const key = e.key;

      // Espace → jouer
      if (key === ' ' || key === 'Enter') {
        e.preventDefault();
        if (currentScreen === 'game') {
          const ex = GameLogic.getCurrent();
          if (ex) playCurrentExercise();
        }
        return;
      }

      // Echap → menu
      if (key === 'Escape') {
        if (currentScreen !== 'menu') goToMenu();
        return;
      }

      // Chiffres → réponses
      if (currentScreen === 'game' && !answered) {
        const n = parseInt(key) - 1;
        const btns = document.querySelectorAll('.answer-btn:not(.disabled)');
        if (!isNaN(n) && n >= 0 && n < btns.length) {
          btns[n].click();
        }
      }
    });
  }

  function goToMenu() {
    GameState.save();
    updateMenuStats();
    showScreen('menu');
  }

  /* ── Initialisation principale ── */
  function init() {
    GameState.load();
    updateMenuStats();

    // Listener mondes
    document.querySelectorAll('.world-card').forEach(card => {
      card.addEventListener('click', () => {
        const w = card.dataset.world;
        if (w === 'discover') {
          AudioEngine.init();
          initDiscover();
          showScreen('discover');
          return;
        }
        const worldNum = parseInt(w);
        if (!GameState.isWorldUnlocked(worldNum)) {
          shakeCard(card);
          return;
        }
        startWorld(worldNum);
      });
    });

    // Bouton play
    document.getElementById('btn-play').addEventListener('click', () => {
      const ex = GameLogic.getCurrent();
      if (ex) playCurrentExercise();
    });

    // Retour
    document.getElementById('btn-back').addEventListener('click', goToMenu);
    document.getElementById('btn-back-discover').addEventListener('click', () => {
      clearInterval(compareInterval);
      discoverComparing = false;
      goToMenu();
    });

    // Fullscreen
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    });

    initKeyboard();
  }

  function shakeCard(card) {
    card.style.animation = 'wrong-shake 0.35s ease';
    setTimeout(() => card.style.animation = '', 400);
  }

  return { init };
})();

/* ============================================================
   8. BOOTSTRAP
   ============================================================ */
window.addEventListener('DOMContentLoaded', () => {
  Visualizer.init();
  Particles.init();
  UI.init();

  // Démarrer le contexte audio dès la première interaction
  document.addEventListener('pointerdown', () => AudioEngine.resume(), { once: false });
});
