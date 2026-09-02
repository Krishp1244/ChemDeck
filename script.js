import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
        import {
            getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut as fbSignOut
        } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
        import {
            getFirestore, collection, doc, setDoc, getDocs, deleteDoc, writeBatch, addDoc
        } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

        const firebaseConfig = {
            apiKey: "AIzaSyAVSmR8cr96SNal43ZDjBeSSE1muawNX_Y",
            authDomain: "flashcard-app-premed.firebaseapp.com",
            projectId: "flashcard-app-premed",
            storageBucket: "flashcard-app-premed.firebasestorage.app",
            messagingSenderId: "656284668396",
            appId: "1:656284668396:web:5a445da32381f18efbf0c9"
        };

        const fbApp = initializeApp(firebaseConfig);
        const auth = getAuth(fbApp);
        const db = getFirestore(fbApp);
        const provider = new GoogleAuthProvider();

        let currentUser = null;
        let cards = [];
        let currentIndex = 0;
        let drawMode = false;
        let isDrawing = false;
        let drawColor = "#7c5cfc";
        let eraserMode = false;
        let highlighterMode = false;
        let textMode = false;
        let drawSize = 3;
        let saveTimeout = null;
        let isSaving = false;
        let decks = [];
        let currentDeckId = null;
        let scratchpadOpen = false;

        // ── Pinch zoom state per canvas ──
        const canvasZoom = {};  // { canvasId: { scale, offsetX, offsetY } }

        const $ = id => document.getElementById(id);
        const loginScreen = $('login-screen');
        const appEl = $('app');
        const frontText = $('front-text');
        const backText = $('back-text');
        const cardContainer = $('card-container');
        const cardStage = $('card-stage');
        const emptyState = $('empty-state');
        const gridSection = $('grid-section');
        const cardGrid = $('card-grid');
        const counterEl = $('card-counter');
        const canvasFront = $('canvas-front');
        const canvasBack = $('canvas-back');
        const ctxFront = canvasFront.getContext('2d');
        const ctxBack = canvasBack.getContext('2d');
        const canvasScratchpad = $('canvas-scratchpad');
        const ctxScratchpad = canvasScratchpad.getContext('2d', { willReadFrequently: true });

        // ── Theme ──
        function getCurrentTheme() {
            const explicit = document.documentElement.getAttribute('data-theme');
            if (explicit === 'dark' || explicit === 'light') return explicit;
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        function syncThemeToggleIcons() {
            const label = getCurrentTheme() === 'dark' ? 'Light' : 'Dark';
            [$('theme-toggle'), $('theme-toggle-login')].forEach(btn => { if (btn) btn.textContent = label; });
        }
        function setTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            try { localStorage.setItem('chemdeck-theme', theme); } catch (e) { }
            syncThemeToggleIcons();
        }
        function toggleTheme() { setTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark'); }
        $('theme-toggle').addEventListener('click', toggleTheme);
        $('theme-toggle-login').addEventListener('click', toggleTheme);
        syncThemeToggleIcons();

        // ── Auth ──
        $('btn-login').addEventListener('click', async () => {
            const btn = $('btn-login');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Signing in…';
            try {
                await signInWithPopup(auth, provider);
            } catch (e) {
                if (e.code !== 'auth/popup-closed-by-user') showToast('Sign-in failed: ' + e.message, 'error');
            }
            btn.disabled = false;
            btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Sign in with Google';
        });

        $('btn-logout').addEventListener('click', async () => {
            await fbSignOut(auth);
            cards = []; currentIndex = 0; drawMode = false;
            decks = []; currentDeckId = null;
            document.body.classList.remove('draw-mode');
            $('btn-draw-toggle').textContent = 'Draw';
            $('btn-draw-toggle').classList.remove('btn-active');
            $('btn-clear-canvas').style.display = 'none';
            canvasFront.classList.remove('active');
            canvasBack.classList.remove('active');
            document.querySelectorAll('.draw-toolbar').forEach(t => t.classList.remove('active'));
            $('deck-bar').innerHTML = '';
        });

        onAuthStateChanged(auth, async user => {
            currentUser = user;
            if (user) {
                loginScreen.classList.add('hidden');
                appEl.classList.add('visible');
                $('user-avatar').src = user.photoURL || '';
                $('user-name').textContent = user.displayName || 'User';
                await loadDecks();
            } else {
                loginScreen.classList.remove('hidden');
                appEl.classList.remove('visible');
            }
        });

        function userDecksCol() { return collection(db, 'users', currentUser.uid, 'decks'); }
        function deckCardsCol(deckId) { return collection(db, 'users', currentUser.uid, 'decks', deckId, 'cards'); }

        async function loadDecks() {
            setSyncing(true);
            try {
                const oldCol = collection(db, 'users', currentUser.uid, 'flashcards');
                const oldSnap = await getDocs(oldCol);
                if (!oldSnap.empty) {
                    const deckRef = await addDoc(userDecksCol(), { name: 'General', order: 0, createdAt: Date.now() });
                    const batch = writeBatch(db);
                    let idx = 0;
                    oldSnap.forEach(d => {
                        const data = d.data();
                        const cardRef = doc(deckCardsCol(deckRef.id), d.id);
                        batch.set(cardRef, { ...data, order: idx++ });
                        batch.delete(d.ref);
                    });
                    await batch.commit();
                    showToast('Migrated existing cards to General deck', 'info');
                }

                const snap = await getDocs(userDecksCol());
                decks = [];
                snap.forEach(d => { decks.push({ id: d.id, ...d.data() }); });
                decks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

                if (decks.length === 0) {
                    const ref = await addDoc(userDecksCol(), { name: 'General', order: 0, createdAt: Date.now() });
                    decks.push({ id: ref.id, name: 'General', order: 0 });
                }

                currentDeckId = decks[0].id;
                renderDeckBar();
                await loadCards();
            } catch (e) {
                console.error('Load decks error:', e);
                showToast('Failed to load decks', 'error');
            }
            setSyncing(false);
        }

        async function createDeck(name) {
            if (!currentUser) return;
            try {
                const ref = await addDoc(userDecksCol(), { name, order: decks.length, createdAt: Date.now() });
                decks.push({ id: ref.id, name, order: decks.length });
                currentDeckId = ref.id;
                cards = []; currentIndex = 0;
                renderDeckBar();
                renderAll();
                showToast(`Created "${name}"`, 'success');
            } catch (e) { showToast('Failed to create deck', 'error'); }
        }

        async function renameDeck(deckId, newName) {
            if (!currentUser) return;
            try {
                await setDoc(doc(db, 'users', currentUser.uid, 'decks', deckId), { name: newName }, { merge: true });
                const d = decks.find(d => d.id === deckId);
                if (d) d.name = newName;
                renderDeckBar();
                showToast('Deck renamed', 'success');
            } catch (e) { console.error('Rename error:', e); }
        }

        async function deleteDeckConfirm(deckId) {
            const deck = decks.find(d => d.id === deckId);
            if (!deck || decks.length <= 1) { showToast('Cannot delete the only deck', 'error'); return; }
            showConfirm('Delete Deck', `Delete "${escHtml(deck.name)}" and all its cards? This cannot be undone.`, async () => {
                try {
                    const cardsSnap = await getDocs(deckCardsCol(deckId));
                    if (!cardsSnap.empty) {
                        const batch = writeBatch(db);
                        cardsSnap.forEach(d => batch.delete(d.ref));
                        await batch.commit();
                    }
                    await deleteDoc(doc(db, 'users', currentUser.uid, 'decks', deckId));
                    decks = decks.filter(d => d.id !== deckId);
                    if (currentDeckId === deckId) { currentDeckId = decks[0].id; await loadCards(); }
                    renderDeckBar();
                    showToast('Deck deleted', 'error');
                } catch (e) { console.error('Delete deck error:', e); }
            });
        }

        async function switchDeck(deckId) {
            if (deckId === currentDeckId) return;
            saveDrawingData();
            if (saveTimeout) { clearTimeout(saveTimeout); await saveAllCards(); }
            currentDeckId = deckId;
            renderDeckBar();
            await loadCards();
        }

        function showDeckModal(title, defaultVal, onSave) {
            const overlay = document.createElement('div');
            overlay.className = 'deck-modal-overlay';
            overlay.innerHTML = `<div class="deck-modal"><h3>${title}</h3><input type="text" id="deck-name-input" value="${escHtml(defaultVal)}" maxlength="40" placeholder="e.g. Chapter 1 - Reactions" /><div class="modal-actions"><button class="btn btn-sm" id="deck-modal-cancel">Cancel</button><button class="btn btn-sm btn-accent" id="deck-modal-save">Save</button></div></div>`;
            document.body.appendChild(overlay);
            const input = overlay.querySelector('#deck-name-input');
            input.focus(); input.select();
            overlay.querySelector('#deck-modal-cancel').addEventListener('click', () => overlay.remove());
            overlay.querySelector('#deck-modal-save').addEventListener('click', () => { const val = input.value.trim(); if (val) { onSave(val); overlay.remove(); } });
            input.addEventListener('keydown', e => { if (e.key === 'Enter') { const val = input.value.trim(); if (val) { onSave(val); overlay.remove(); } } if (e.key === 'Escape') overlay.remove(); });
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        }

        function renderDeckBar() {
            const bar = $('deck-bar');
            bar.innerHTML = '<span class="deck-bar-label">Sets</span>';
            decks.forEach(deck => {
                const chip = document.createElement('div');
                chip.className = 'deck-chip' + (deck.id === currentDeckId ? ' active' : '');
                chip.innerHTML = `<span>${escHtml(deck.name)}</span><span class="deck-actions"><button class="deck-action-btn" data-action="rename" title="Rename">✏</button><button class="deck-action-btn" data-action="delete" title="Delete">✕</button></span>`;
                chip.addEventListener('click', (e) => {
                    const action = e.target.closest('[data-action]');
                    if (action) {
                        e.stopPropagation();
                        if (action.dataset.action === 'rename') showDeckModal('Rename Deck', deck.name, (name) => renameDeck(deck.id, name));
                        else if (action.dataset.action === 'delete') deleteDeckConfirm(deck.id);
                    } else { switchDeck(deck.id); }
                });
                bar.appendChild(chip);
            });
            const addChip = document.createElement('div');
            addChip.className = 'deck-chip add-deck';
            addChip.innerHTML = '<span>＋</span> New Set';
            addChip.addEventListener('click', () => { showDeckModal('Create New Set', '', (name) => createDeck(name)); });
            bar.appendChild(addChip);
        }

        async function loadCards() {
            setSyncing(true);
            try {
                const snap = await getDocs(deckCardsCol(currentDeckId));
                cards = [];
                snap.forEach(d => {
                    const data = d.data();
                    cards.push({ id: d.id, front: data.front || '', back: data.back || '', drawFront: data.drawFront || '', drawBack: data.drawBack || '', scratchpad: data.scratchpad || '', order: data.order ?? 0 });
                });
                cards.sort((a, b) => a.order - b.order);
                currentIndex = 0;
                cardContainer.classList.remove('flipped');
                renderAll();
            } catch (e) { console.error('Load error:', e); showToast('Failed to load cards', 'error'); }
            setSyncing(false);
        }

        async function saveAllCards() {
            if (!currentUser || !currentDeckId || isSaving) return;
            isSaving = true; setSyncing(true);
            try {
                const batchSize = 450;
                for (let i = 0; i < cards.length; i += batchSize) {
                    const batch = writeBatch(db);
                    cards.slice(i, i + batchSize).forEach((c, j) => {
                        const ref = doc(db, 'users', currentUser.uid, 'decks', currentDeckId, 'cards', c.id);
                        batch.set(ref, { front: c.front || '', back: c.back || '', drawFront: c.drawFront || '', drawBack: c.drawBack || '', scratchpad: c.scratchpad || '', order: i + j });
                    });
                    await batch.commit();
                }
            } catch (e) { console.error('Save error:', e); showToast('Sync failed — will retry', 'error'); }
            isSaving = false; setSyncing(false);
        }

        function debouncedSave() { clearTimeout(saveTimeout); saveTimeout = setTimeout(saveAllCards, 1500); }

        async function deleteCardFromDB(id) {
            if (!currentUser || !currentDeckId) return;
            try { await deleteDoc(doc(db, 'users', currentUser.uid, 'decks', currentDeckId, 'cards', id)); } catch (e) { console.error('Delete error:', e); }
        }

        function addCard() {
            const id = 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            cards.push({ id, front: '', back: '', drawFront: '', drawBack: '', scratchpad: '', order: cards.length });
            currentIndex = cards.length - 1;
            cardContainer.classList.remove('flipped');
            renderAll();
            showToast('New card created', 'success');
            debouncedSave();
            setTimeout(() => frontText.focus(), 250);
        }

        function deleteCard(idx) {
            if (cards.length === 0 || idx < 0 || idx >= cards.length) return;
            const card = cards[idx];
            const preview = card.front ? escHtml(card.front.substring(0, 40)) : 'Empty card';
            showConfirm('Delete Card', `Delete "${preview}${card.front && card.front.length > 40 ? '…' : ''}"? This cannot be undone.`, () => {
                const removed = cards.splice(idx, 1)[0];
                deleteCardFromDB(removed.id);
                if (currentIndex >= cards.length) currentIndex = Math.max(0, cards.length - 1);
                renderAll(); showToast('Card deleted', 'error'); debouncedSave();
            });
        }

        function prevCard() {
            if (currentIndex > 0) { saveDrawingData(); currentIndex--; cardContainer.classList.remove('flipped'); renderCard(); }
        }

        function nextCard() {
            if (currentIndex < cards.length - 1) { saveDrawingData(); currentIndex++; cardContainer.classList.remove('flipped'); renderCard(); }
        }

        function goToCard(idx) {
            if (idx === currentIndex) return;
            saveDrawingData(); currentIndex = idx; cardContainer.classList.remove('flipped'); renderCard();
            cardStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        function shuffleCards() {
            if (cards.length < 2) return;
            saveDrawingData();
            for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[cards[i], cards[j]] = [cards[j], cards[i]]; }
            currentIndex = 0; cardContainer.classList.remove('flipped'); renderAll();
            showToast('Cards shuffled!', 'info'); debouncedSave();
        }

        function flipCard() { if (drawMode || cards.length === 0) return; cardContainer.classList.toggle('flipped'); }

        function saveCurrentCardText() {
            if (cards.length === 0) return;
            const card = cards[currentIndex];
            card.front = frontText.innerText.trim().slice(0, 5000);
            card.back = backText.innerText.trim().slice(0, 5000);
            renderGrid(); debouncedSave();
        }

        $('btn-add').addEventListener('click', addCard);
        $('btn-create-first').addEventListener('click', addCard);
        $('btn-shuffle').addEventListener('click', shuffleCards);
        $('btn-prev').addEventListener('click', prevCard);
        $('btn-next').addEventListener('click', nextCard);
        $('btn-mobile-prev').addEventListener('click', prevCard);
        $('btn-mobile-next').addEventListener('click', nextCard);
        $('btn-mobile-flip').addEventListener('click', flipCard);
        $('flip-front').addEventListener('click', flipCard);
        $('flip-back').addEventListener('click', flipCard);
        frontText.addEventListener('input', saveCurrentCardText);
        backText.addEventListener('input', saveCurrentCardText);

        frontText.addEventListener('pointerdown', e => e.stopPropagation());
        backText.addEventListener('pointerdown', e => e.stopPropagation());
        frontText.addEventListener('click', e => e.stopPropagation());
        backText.addEventListener('click', e => e.stopPropagation());

        document.querySelectorAll('.flip-zone').forEach(zone => { zone.style.zIndex = '1'; });
        document.querySelectorAll('.card-text').forEach(txt => { txt.style.zIndex = '3'; });
        document.querySelectorAll('.card-face-label').forEach(lbl => { lbl.style.zIndex = '3'; lbl.style.position = 'relative'; });
        document.querySelectorAll('.card-flip-hint').forEach(h => { h.style.zIndex = '3'; h.style.position = 'relative'; h.style.pointerEvents = 'none'; });

        function renderAll() { renderCard(); renderGrid(); updateVisibility(); }

        function updateVisibility() {
            if (cards.length === 0) { cardStage.style.display = 'none'; emptyState.style.display = 'flex'; gridSection.style.display = 'none'; }
            else { cardStage.style.display = 'flex'; emptyState.style.display = 'none'; gridSection.style.display = 'block'; }
        }

        function renderCard() {
            if (cards.length === 0) { counterEl.textContent = '0 / 0'; return; }
            const card = cards[currentIndex];
            frontText.innerText = card.front || '';
            backText.innerText = card.back || '';
            counterEl.textContent = `${currentIndex + 1} / ${cards.length}`;
            frontText.classList.toggle('has-drawing', !!card.drawFront);
            backText.classList.toggle('has-drawing', !!card.drawBack);
            $('btn-prev').disabled = currentIndex === 0;
            $('btn-next').disabled = currentIndex === cards.length - 1;
            $('btn-mobile-prev').disabled = currentIndex === 0;
            $('btn-mobile-next').disabled = currentIndex === cards.length - 1;
            requestAnimationFrame(() => {
                resizeCanvases();
                loadDrawingToCanvas(ctxFront, canvasFront, card.drawFront);
                loadDrawingToCanvas(ctxBack, canvasBack, card.drawBack);
                loadDrawingToCanvas(ctxScratchpad, canvasScratchpad, card.scratchpad);
            });
        }

        let draggedCardIdx = null;

        function renderGrid() {
            cardGrid.innerHTML = '';
            cards.forEach((card, idx) => {
                const el = document.createElement('div');
                el.className = 'grid-card' + (idx === currentIndex ? ' active' : '');

                el.draggable = true;
                el.addEventListener('dragstart', (e) => {
                    draggedCardIdx = idx;
                    el.style.opacity = '0.5';
                    e.dataTransfer.effectAllowed = 'move';
                });
                el.addEventListener('dragend', () => { el.style.opacity = '1'; document.querySelectorAll('.grid-card').forEach(c => c.style.borderColor = ''); });
                el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
                el.addEventListener('dragenter', (e) => { e.preventDefault(); if (idx !== draggedCardIdx) el.style.borderColor = 'var(--warning)'; });
                el.addEventListener('dragleave', (e) => { el.style.borderColor = ''; });
                el.addEventListener('drop', (e) => {
                    e.stopPropagation();
                    el.style.borderColor = '';
                    if (draggedCardIdx !== null && draggedCardIdx !== idx && draggedCardIdx < cards.length) {
                        const dragged = cards.splice(draggedCardIdx, 1)[0];
                        cards.splice(idx, 0, dragged);
                        cards.forEach((c, i) => c.order = i);
                        if (currentIndex === draggedCardIdx) currentIndex = idx;
                        else if (currentIndex > draggedCardIdx && currentIndex <= idx) currentIndex--;
                        else if (currentIndex < draggedCardIdx && currentIndex >= idx) currentIndex++;
                        renderGrid(); debouncedSave(); showToast('Card reordered', 'success');
                    }
                });

                let frontDesc = escHtml(card.front);
                let frontDrawingHtml = card.drawFront ? `<img src="${card.drawFront}" class="grid-card-drawing-preview" alt="Drawing" />` : '';
                if (!frontDesc && !card.drawFront) frontDesc = '<em style="color:var(--text-muted)">Empty</em>';
                let backDesc = escHtml(card.back);
                if (!backDesc && card.drawBack) backDesc = '<em style="color:var(--text-muted)">[Drawing]</em>';
                el.innerHTML = `<span class="gc-num">#${idx + 1}</span><div class="gc-front">${frontDrawingHtml}${frontDesc}</div><div class="gc-back">${backDesc}</div><button class="gc-delete" data-idx="${idx}" title="Delete card">✕</button>`;
                el.addEventListener('click', (e) => {
                    if (e.target.closest('.gc-delete')) deleteCard(parseInt(e.target.closest('.gc-delete').dataset.idx));
                    else goToCard(idx);
                });
                cardGrid.appendChild(el);
            });
            const addEl = document.createElement('div');
            addEl.className = 'grid-card add-card';
            addEl.innerHTML = '<span class="plus">＋</span>Add Card';
            addEl.addEventListener('click', addCard);
            cardGrid.appendChild(addEl);
        }

        function escHtml(s) {
            if (!s) return '';
            return String(s).replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }

        function resizeCanvases() {
            [canvasFront, canvasBack, canvasScratchpad].forEach(c => {
                const parent = c.parentElement;
                const width = Math.floor(parent.clientWidth);
                const height = Math.floor(parent.clientHeight);
                if (width === 0 || height === 0) return;
                if (c.width !== width || c.height !== height) {
                    c.width = width;
                    c.height = height;
                }
            });
        }

        // ── Draggable draw toolbar ──
        function makeDraggable(toolbar) {
            let dragStartX, dragStartY, origLeft, origTop;
            let isDragging = false;

            toolbar.addEventListener('pointerdown', (e) => {
                // Only drag on the toolbar itself, not buttons/swatches inside
                if (e.target !== toolbar && !e.target.classList.contains('drag-handle')) return;
                isDragging = true;
                toolbar.classList.add('dragging');
                toolbar.setPointerCapture(e.pointerId);
                dragStartX = e.clientX;
                dragStartY = e.clientY;

                // Convert current position to absolute left/top
                const rect = toolbar.getBoundingClientRect();
                const parentRect = toolbar.parentElement.getBoundingClientRect();
                origLeft = rect.left - parentRect.left;
                origTop = rect.top - parentRect.top;

                // Switch from transform-based to explicit left/top positioning
                toolbar.style.transform = 'none';
                toolbar.style.left = origLeft + 'px';
                toolbar.style.top = origTop + 'px';
                toolbar.style.bottom = 'auto';
            });

            toolbar.addEventListener('pointermove', (e) => {
                if (!isDragging) return;
                e.preventDefault();
                const dx = e.clientX - dragStartX;
                const dy = e.clientY - dragStartY;
                const parentRect = toolbar.parentElement.getBoundingClientRect();
                const toolbarRect = toolbar.getBoundingClientRect();

                let newLeft = origLeft + dx;
                let newTop = origTop + dy;

                // Clamp inside card
                newLeft = Math.max(0, Math.min(newLeft, parentRect.width - toolbarRect.width));
                newTop = Math.max(0, Math.min(newTop, parentRect.height - toolbarRect.height));

                toolbar.style.left = newLeft + 'px';
                toolbar.style.top = newTop + 'px';
            });

            toolbar.addEventListener('pointerup', () => { isDragging = false; toolbar.classList.remove('dragging'); });
            toolbar.addEventListener('pointercancel', () => { isDragging = false; toolbar.classList.remove('dragging'); });
        }

        $('btn-draw-toggle').addEventListener('click', () => {
            drawMode = !drawMode;
            document.body.classList.toggle('draw-mode', drawMode);
            $('btn-draw-toggle').classList.toggle('btn-active', drawMode);
            $('btn-clear-canvas').style.display = drawMode ? 'inline-flex' : 'none';
            canvasFront.classList.toggle('active', drawMode);
            canvasBack.classList.toggle('active', drawMode);
            frontText.contentEditable = drawMode ? 'false' : 'true';
            backText.contentEditable = drawMode ? 'false' : 'true';
            document.querySelectorAll('.flip-zone').forEach(z => z.style.display = drawMode ? 'none' : '');

            if (drawMode) {
                buildDrawToolbar('draw-toolbar-front');
                buildDrawToolbar('draw-toolbar-back');
                resizeCanvases();
                if (cards.length) {
                    loadDrawingToCanvas(ctxFront, canvasFront, cards[currentIndex].drawFront);
                    loadDrawingToCanvas(ctxBack, canvasBack, cards[currentIndex].drawBack);
                }
            }
            document.querySelectorAll('#draw-toolbar-front, #draw-toolbar-back').forEach(t => t.classList.toggle('active', drawMode));
            $('btn-draw-toggle').textContent = drawMode ? 'Draw: ON' : 'Draw';
        });

        $('btn-scratchpad-toggle').addEventListener('click', () => {
            scratchpadOpen = !scratchpadOpen;
            document.body.classList.toggle('scratchpad-open', scratchpadOpen);
            $('btn-scratchpad-toggle').classList.toggle('btn-active', scratchpadOpen);
            if (scratchpadOpen) {
                buildDrawToolbar('draw-toolbar-scratchpad');
                setTimeout(() => {
                    resizeCanvases();
                    if (cards.length) loadDrawingToCanvas(ctxScratchpad, canvasScratchpad, cards[currentIndex].scratchpad);
                }, 50);
            }
        });

        const swatchColors = ['#000000', '#7c5cfc', '#38bdf8', '#22c55e', '#f59e0b', '#f43f5e', '#e879f9', '#ffffff'];

        function buildDrawToolbar(id) {
            const toolbar = $(id);
            if (toolbar.children.length) return;

            // Add drag handle for card toolbars
            if (id !== 'draw-toolbar-scratchpad') {
                const handle = document.createElement('span');
                handle.className = 'drag-handle';
                handle.textContent = '⠿';
                handle.title = 'Drag toolbar';
                toolbar.appendChild(handle);
                makeDraggable(toolbar);
            }

            swatchColors.forEach(color => {
                const sw = document.createElement('div');
                sw.className = 'color-swatch' + (color === drawColor && !eraserMode ? ' active' : '');
                sw.style.background = color;
                sw.dataset.color = color;
                sw.addEventListener('click', (e) => { e.stopPropagation(); drawColor = color; eraserMode = false; highlighterMode = false; updateSwatchStates(); });
                toolbar.appendChild(sw);
            });

            const eraser = document.createElement('button');
            eraser.className = 'eraser-btn' + (eraserMode ? ' active' : '');
            eraser.title = 'Eraser';
            eraser.innerHTML = `<svg viewBox="0 0 24 24"><path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0M4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53l-4.95-4.95l-4.95 4.95z"/></svg> Erase`;
            eraser.addEventListener('click', (e) => { e.stopPropagation(); eraserMode = !eraserMode; highlighterMode = false; updateSwatchStates(); });
            toolbar.appendChild(eraser);

            const highlighter = document.createElement('button');
            highlighter.className = 'highlighter-btn' + (highlighterMode ? ' active' : '');
            highlighter.title = 'Highlighter';
            highlighter.innerHTML = `<svg viewBox="0 0 24 24"><path d="M18.5 1.15L23 5.65l-2.8 2.8L15.7 4l2.8-2.85M7 14.15l8.5-8.5 4.5 4.5-8.5 8.5H7v-4.5M3.5 19.15h5l-5 5v-5z"/></svg> Hi`;
            highlighter.addEventListener('click', (e) => { e.stopPropagation(); highlighterMode = !highlighterMode; eraserMode = false; textMode = false; updateSwatchStates(); });
            toolbar.appendChild(highlighter);

            const textBtn = document.createElement('button');
            textBtn.className = 'eraser-btn text-btn' + (textMode ? ' active' : '');
            textBtn.title = 'Text';
            textBtn.innerHTML = `T`;
            textBtn.style.padding = '3px 10px';
            textBtn.addEventListener('click', (e) => { e.stopPropagation(); textMode = !textMode; eraserMode = false; highlighterMode = false; updateSwatchStates(); });
            toolbar.appendChild(textBtn);

            const sep = document.createElement('div');
            sep.className = 'sep';
            toolbar.appendChild(sep);

            const range = document.createElement('input');
            range.type = 'range'; range.min = 1; range.max = 16; range.value = drawSize;
            range.className = 'draw-size';
            range.addEventListener('input', (e) => { e.stopPropagation(); drawSize = parseInt(e.target.value); });
            range.addEventListener('click', (e) => e.stopPropagation());
            toolbar.appendChild(range);

            const sep2 = document.createElement('div');
            sep2.className = 'sep';
            toolbar.appendChild(sep2);

            const canvasInfo = getCanvasForToolbar(id);
            const undoBtn = document.createElement('button');
            undoBtn.className = 'undo-redo-btn'; undoBtn.title = 'Undo'; undoBtn.dataset.action = 'undo';
            undoBtn.dataset.canvas = canvasInfo ? canvasInfo.canvas.id : ''; undoBtn.innerHTML = '↩'; undoBtn.disabled = true;
            undoBtn.addEventListener('click', (e) => { e.stopPropagation(); if (canvasInfo) undoCanvas(canvasInfo.canvas, canvasInfo.ctx); });
            toolbar.appendChild(undoBtn);

            const redoBtn = document.createElement('button');
            redoBtn.className = 'undo-redo-btn'; redoBtn.title = 'Redo'; redoBtn.dataset.action = 'redo';
            redoBtn.dataset.canvas = canvasInfo ? canvasInfo.canvas.id : ''; redoBtn.innerHTML = '↪'; redoBtn.disabled = true;
            redoBtn.addEventListener('click', (e) => { e.stopPropagation(); if (canvasInfo) redoCanvas(canvasInfo.canvas, canvasInfo.ctx); });
            toolbar.appendChild(redoBtn);

            // Reset zoom button
            if (canvasInfo) {
                const sep3 = document.createElement('div');
                sep3.className = 'sep';
                toolbar.appendChild(sep3);
                const resetZoomBtn = document.createElement('button');
                resetZoomBtn.className = 'undo-redo-btn';
                resetZoomBtn.title = 'Reset zoom';
                resetZoomBtn.innerHTML = '⊙';
                resetZoomBtn.style.fontSize = '13px';
                resetZoomBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    resetZoom(canvasInfo.canvas, canvasInfo.ctx);
                    showToast('Zoom reset', 'info');
                });
                toolbar.appendChild(resetZoomBtn);
            }
        }

        function updateSwatchStates() {
            document.querySelectorAll('.color-swatch').forEach(sw => { sw.classList.toggle('active', !eraserMode && !highlighterMode && sw.dataset.color === drawColor); });
            document.querySelectorAll('.eraser-btn:not(.text-btn)').forEach(eb => { eb.classList.toggle('active', eraserMode); });
            document.querySelectorAll('.highlighter-btn').forEach(hb => { hb.classList.toggle('active', highlighterMode); });
            document.querySelectorAll('.text-btn').forEach(tb => { tb.classList.toggle('active', textMode); });
        }

        let lastPoint = null;
        let penDetected = false;

        const canvasHistory = {};
        function getHistory(canvasId) { if (!canvasHistory[canvasId]) canvasHistory[canvasId] = { undo: [], redo: [] }; return canvasHistory[canvasId]; }
        function pushUndoSnapshot(canvas) {
            const hist = getHistory(canvas.id);
            hist.undo.push(canvas.toDataURL()); hist.redo = [];
            if (hist.undo.length > 30) hist.undo.shift();
            updateUndoRedoButtons();
        }
        function undoCanvas(canvas, ctx) {
            const hist = getHistory(canvas.id);
            if (hist.undo.length === 0) return;
            hist.redo.push(canvas.toDataURL());
            const prev = hist.undo.pop();
            const img = new Image();
            img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); saveDrawingData(); renderGrid(); debouncedSave(); updateUndoRedoButtons(); };
            img.src = prev;
        }
        function redoCanvas(canvas, ctx) {
            const hist = getHistory(canvas.id);
            if (hist.redo.length === 0) return;
            hist.undo.push(canvas.toDataURL());
            const next = hist.redo.pop();
            const img = new Image();
            img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); saveDrawingData(); renderGrid(); debouncedSave(); updateUndoRedoButtons(); };
            img.src = next;
        }
        function updateUndoRedoButtons() {
            document.querySelectorAll('.undo-redo-btn[data-action="undo"]').forEach(btn => { const id = btn.dataset.canvas; btn.disabled = !canvasHistory[id] || canvasHistory[id].undo.length === 0; });
            document.querySelectorAll('.undo-redo-btn[data-action="redo"]').forEach(btn => { const id = btn.dataset.canvas; btn.disabled = !canvasHistory[id] || canvasHistory[id].redo.length === 0; });
        }
        function getCanvasForToolbar(id) {
            if (id === 'draw-toolbar-front') return { canvas: canvasFront, ctx: ctxFront };
            if (id === 'draw-toolbar-back') return { canvas: canvasBack, ctx: ctxBack };
            if (id === 'draw-toolbar-scratchpad') return { canvas: canvasScratchpad, ctx: ctxScratchpad };
            return null;
        }

        function getPressureWidth(e, baseSize) {
            if (e.pointerType === 'pen' && e.pressure > 0) return Math.max(0.5, baseSize * (0.3 + e.pressure * 1.4));
            return baseSize;
        }

        // ── Zoom state per canvas (used by ctx.setTransform — coords stay accurate) ──
        function initZoom(canvas) {
            canvasZoom[canvas.id] = { scale: 1, offsetX: 0, offsetY: 0 };
        }
        initZoom(canvasFront);
        initZoom(canvasBack);
        initZoom(canvasScratchpad);

        // Apply zoom via CSS transform
        function applyZoom(canvas, ctx) {
            const z = canvasZoom[canvas.id];
            canvas.style.transform = `translate(${z.offsetX}px, ${z.offsetY}px) scale(${z.scale})`;
        }

        // Reset zoom for a canvas
        function resetZoom(canvas, ctx) {
            canvasZoom[canvas.id] = { scale: 1, offsetX: 0, offsetY: 0 };
            applyZoom(canvas, ctx);
        }

        // Convert screen point to canvas drawing coords
        function screenToCanvas(canvas, clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        }

        function setupCanvas(canvas, ctx, isScratchpad = false) {
            canvas.style.touchAction = 'none';

            canvas.addEventListener('pointerdown', e => {
                if (!isScratchpad && !drawMode) return;
                if (isScratchpad && !scratchpadOpen) return;

                if (textMode) {
                    e.stopPropagation(); e.preventDefault();
                    if (document.activeElement && document.activeElement.classList.contains('canvas-text-area')) return;
                    if (document.querySelector('.canvas-text-wrapper')) return; // Only one text box at a time

                    const parent = canvas.parentElement;
                    const parentRect = parent.getBoundingClientRect();
                    const fontSize = Math.max(14, drawSize * 4);

                    let startX = e.clientX;
                    let startY = e.clientY;
                    let isDraggingSize = true;

                    // Create wrapper
                    const wrapper = document.createElement('div');
                    wrapper.className = 'canvas-text-wrapper';
                    wrapper.style.position = 'absolute';
                    wrapper.style.left = (startX - parentRect.left) + 'px';
                    wrapper.style.top = (startY - parentRect.top) + 'px';
                    wrapper.style.border = '1px solid var(--accent)';
                    wrapper.style.background = 'rgba(0,0,0,0.5)';
                    wrapper.style.zIndex = '100';
                    wrapper.style.minWidth = '100px';
                    wrapper.style.minHeight = '40px';
                    wrapper.style.display = 'flex';
                    wrapper.style.flexDirection = 'column';

                    // Drag handle to move the box
                    const handle = document.createElement('div');
                    handle.style.height = '20px';
                    handle.style.background = 'var(--accent)';
                    handle.style.cursor = 'grab';
                    handle.style.display = 'flex';
                    handle.style.alignItems = 'center';
                    handle.style.justifyContent = 'center';
                    handle.style.color = '#fff';
                    handle.style.fontSize = '12px';
                    handle.style.userSelect = 'none';
                    handle.innerHTML = '⠿ Drag to move';
                    wrapper.appendChild(handle);

                    // Textarea
                    const input = document.createElement('textarea');
                    input.className = 'canvas-text-area';
                    input.style.flex = '1';
                    input.style.width = '100%';
                    input.style.color = drawColor;
                    input.style.fontSize = fontSize + 'px';
                    input.style.fontFamily = 'Inter, sans-serif';
                    input.style.fontWeight = '600';
                    input.style.background = 'transparent';
                    input.style.border = 'none';
                    input.style.outline = 'none';
                    input.style.resize = 'none';
                    input.style.padding = '4px 8px';
                    input.style.lineHeight = '1.4';
                    wrapper.appendChild(input);

                    parent.appendChild(wrapper);

                    // Initial drag to set width/height
                    const moveInit = (ev) => {
                        if (!isDraggingSize) return;
                        const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
                        const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
                        const w = Math.max(100, clientX - startX);
                        const h = Math.max(40, clientY - startY);
                        wrapper.style.width = w + 'px';
                        wrapper.style.height = h + 'px';
                    };
                    const upInit = () => {
                        isDraggingSize = false;
                        document.removeEventListener('pointermove', moveInit);
                        document.removeEventListener('pointerup', upInit);
                        document.removeEventListener('touchmove', moveInit);
                        document.removeEventListener('touchend', upInit);
                        input.focus();
                    };
                    document.addEventListener('pointermove', moveInit);
                    document.addEventListener('pointerup', upInit);
                    document.addEventListener('touchmove', moveInit, { passive: false });
                    document.addEventListener('touchend', upInit);

                    // Handle dragging the box
                    let isMovingBox = false;
                    let boxDragStartX = 0;
                    let boxDragStartY = 0;

                    const startBoxDrag = (ev) => {
                        ev.stopPropagation(); ev.preventDefault();
                        isMovingBox = true;
                        handle.style.cursor = 'grabbing';
                        const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
                        const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
                        boxDragStartX = clientX - wrapper.offsetLeft;
                        boxDragStartY = clientY - wrapper.offsetTop;
                    };

                    const moveBox = (ev) => {
                        if (!isMovingBox) return;
                        ev.preventDefault();
                        const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
                        const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
                        wrapper.style.left = (clientX - boxDragStartX) + 'px';
                        wrapper.style.top = (clientY - boxDragStartY) + 'px';
                    };

                    const endBoxDrag = () => {
                        if (isMovingBox) { isMovingBox = false; handle.style.cursor = 'grab'; input.focus(); }
                    };

                    handle.addEventListener('pointerdown', startBoxDrag);
                    handle.addEventListener('touchstart', startBoxDrag, { passive: false });
                    document.addEventListener('pointermove', moveBox);
                    document.addEventListener('touchmove', moveBox, { passive: false });
                    document.addEventListener('pointerup', endBoxDrag);
                    document.addEventListener('touchend', endBoxDrag);

                    const finishText = () => {
                        if (wrapper.dataset.processed) return;
                        wrapper.dataset.processed = 'true';
                        const val = input.value.trim();
                        if (val) {
                            pushUndoSnapshot(canvas);

                            // Calculate exact placement on canvas
                            const rect = wrapper.getBoundingClientRect();
                            const wrapperRectTopLeft = { x: rect.left, y: rect.top + 20 }; // +20 to account for handle height
                            const { x, y } = screenToCanvas(canvas, wrapperRectTopLeft.x, wrapperRectTopLeft.y);

                            const z = canvasZoom[canvas.id];
                            const scaleAdjustedFontSize = fontSize / z.scale;
                            ctx.font = `600 ${scaleAdjustedFontSize}px Inter, sans-serif`;
                            ctx.fillStyle = drawColor;
                            ctx.textBaseline = 'top';

                            const lineHeight = scaleAdjustedFontSize * 1.4;
                            const lines = val.split('\\n');
                            lines.forEach((line, i) => {
                                ctx.fillText(line, x + (8 / z.scale), y + (4 / z.scale) + (i * lineHeight));
                            });

                            saveDrawingData(); renderGrid(); debouncedSave(); updateUndoRedoButtons();
                        }
                        wrapper.remove();
                    };

                    input.addEventListener('blur', () => {
                        // Small timeout so dragging handle doesn't immediately blur and finish
                        setTimeout(() => { if (!isMovingBox && document.activeElement !== input) finishText(); }, 150);
                    });
                    input.addEventListener('keydown', ev => {
                        if (ev.key === 'Escape') { input.value = ''; finishText(); }
                        ev.stopPropagation(); // Allow newlines, block card shortcuts
                    });
                    return;
                }

                if (e.pointerType === 'pen') penDetected = true;
                if (penDetected && e.pointerType === 'touch') return;

                e.stopPropagation(); e.preventDefault();
                canvas.setPointerCapture(e.pointerId);
                isDrawing = true;
                pushUndoSnapshot(canvas);

                const { x, y } = screenToCanvas(canvas, e.clientX, e.clientY);
                lastPoint = { x, y };

                const baseSize = eraserMode ? drawSize * 3 : highlighterMode ? drawSize * 3 : drawSize;
                const pressureWidth = getPressureWidth(e, baseSize);

                if (eraserMode) { ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1; }
                else if (highlighterMode) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.3; ctx.strokeStyle = drawColor; }
                else { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.strokeStyle = drawColor; }

                // lineWidth is in canvas coords, so divide by scale to keep stroke visually consistent
                ctx.lineWidth = pressureWidth / canvasZoom[canvas.id].scale;
                ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                ctx.beginPath(); ctx.arc(x, y, pressureWidth / canvasZoom[canvas.id].scale / 2, 0, Math.PI * 2); ctx.fill();
            });

            canvas.addEventListener('pointermove', e => {
                if (!isDrawing) return;
                if (!isScratchpad && !drawMode) return;
                if (isScratchpad && !scratchpadOpen) return;
                if (penDetected && e.pointerType === 'touch') return;
                e.stopPropagation(); e.preventDefault();

                const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
                for (const pe of events) {
                    const { x, y } = screenToCanvas(canvas, pe.clientX, pe.clientY);
                    const baseSize = eraserMode ? drawSize * 3 : highlighterMode ? drawSize * 3 : drawSize;
                    ctx.lineWidth = getPressureWidth(pe, baseSize) / canvasZoom[canvas.id].scale;
                    if (lastPoint) {
                        const midX = (lastPoint.x + x) / 2;
                        const midY = (lastPoint.y + y) / 2;
                        ctx.beginPath(); ctx.moveTo(lastPoint.x, lastPoint.y);
                        ctx.quadraticCurveTo(lastPoint.x, lastPoint.y, midX, midY);
                        ctx.stroke();
                    }
                    lastPoint = { x, y };
                }
            });

            const endDraw = (e) => {
                if (!isDrawing) return;
                if (e) { e.stopPropagation(); e.preventDefault(); }
                isDrawing = false; lastPoint = null;
                ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
                setTimeout(() => { if (!isDrawing) penDetected = false; }, 800);
                saveDrawingData(); renderGrid(); debouncedSave(); updateUndoRedoButtons();
            };

            canvas.addEventListener('pointerup', endDraw);
            canvas.addEventListener('pointercancel', endDraw);
            canvas.addEventListener('click', e => { if (drawMode || isScratchpad) { e.stopPropagation(); e.preventDefault(); } });

            // ── Pinch to zoom ──
            let pinchStartDist = null;
            let pinchStartScale = 1;
            let pinchStartOffsetX = 0, pinchStartOffsetY = 0;
            let pinchStartMidX = 0, pinchStartMidY = 0;
            const touchMap = {};

            canvas.addEventListener('touchstart', (e) => {
                if (!drawMode && !isScratchpad) return;
                Array.from(e.changedTouches).forEach(t => { touchMap[t.identifier] = { x: t.clientX, y: t.clientY }; });
                const keys = Object.keys(touchMap);
                if (keys.length === 2) {
                    e.preventDefault();
                    isDrawing = false;
                    const t0 = touchMap[keys[0]], t1 = touchMap[keys[1]];
                    pinchStartDist = Math.hypot(t1.x - t0.x, t1.y - t0.y);
                    const z = canvasZoom[canvas.id];
                    pinchStartScale = z.scale;
                    pinchStartOffsetX = z.offsetX;
                    pinchStartOffsetY = z.offsetY;
                    const rect = canvas.getBoundingClientRect();
                    pinchStartMidX = (t0.x + t1.x) / 2 - rect.left;
                    pinchStartMidY = (t0.y + t1.y) / 2 - rect.top;
                }
            }, { passive: false });

            canvas.addEventListener('touchmove', (e) => {
                if (!drawMode && !isScratchpad) return;
                Array.from(e.changedTouches).forEach(t => { touchMap[t.identifier] = { x: t.clientX, y: t.clientY }; });
                const keys = Object.keys(touchMap);
                if (keys.length === 2 && pinchStartDist !== null) {
                    e.preventDefault();
                    const t0 = touchMap[keys[0]], t1 = touchMap[keys[1]];
                    const dist = Math.hypot(t1.x - t0.x, t1.y - t0.y);
                    const newScale = Math.max(0.5, Math.min(6, pinchStartScale * (dist / pinchStartDist)));
                    const z = canvasZoom[canvas.id];

                    // Keep the pinch midpoint fixed in canvas space
                    // midPoint in canvas coords at start: (pinchStartMidX - pinchStartOffsetX) / pinchStartScale
                    const canvasMidX = (pinchStartMidX - pinchStartOffsetX) / pinchStartScale;
                    const canvasMidY = (pinchStartMidY - pinchStartOffsetY) / pinchStartScale;

                    z.scale = newScale;
                    z.offsetX = pinchStartMidX - canvasMidX * newScale;
                    z.offsetY = pinchStartMidY - canvasMidY * newScale;

                    // Apply zoom via CSS
                    applyZoom(canvas, ctx);
                }
            }, { passive: false });

            canvas.addEventListener('touchend', (e) => {
                Array.from(e.changedTouches).forEach(t => { delete touchMap[t.identifier]; });
                if (Object.keys(touchMap).length < 2) pinchStartDist = null;
            });
        }

        setupCanvas(canvasFront, ctxFront);
        setupCanvas(canvasBack, ctxBack);
        setupCanvas(canvasScratchpad, ctxScratchpad, true);

        function isCanvasBlank(canvas) {
            const ctx = canvas.getContext('2d');
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < data.length; i += 4) { if (data[i] !== 0) return false; }
            return true;
        }

        function saveDrawingData() {
            if (cards.length === 0) return;
            const card = cards[currentIndex];
            card.drawFront = isCanvasBlank(canvasFront) ? '' : canvasFront.toDataURL('image/png');
            card.drawBack = isCanvasBlank(canvasBack) ? '' : canvasBack.toDataURL('image/png');
            card.scratchpad = isCanvasBlank(canvasScratchpad) ? '' : canvasScratchpad.toDataURL('image/png');
            frontText.classList.toggle('has-drawing', !!card.drawFront);
            backText.classList.toggle('has-drawing', !!card.drawBack);
        }

        function loadDrawingToCanvas(ctx, canvas, dataUrl) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            applyZoom(canvas, ctx);
            if (!dataUrl) return;
            const img = new Image();
            img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
            img.src = dataUrl;
        }

        $('btn-clear-canvas').addEventListener('click', () => {
            if (cards.length === 0) return;
            const isFlipped = cardContainer.classList.contains('flipped');
            if (isFlipped) { ctxBack.clearRect(0, 0, canvasBack.width, canvasBack.height); cards[currentIndex].drawBack = ''; backText.classList.remove('has-drawing'); }
            else { ctxFront.clearRect(0, 0, canvasFront.width, canvasFront.height); cards[currentIndex].drawFront = ''; frontText.classList.remove('has-drawing'); }
            renderGrid(); debouncedSave(); showToast('Drawing cleared', 'info');
        });

        $('btn-clear-scratchpad').addEventListener('click', () => {
            if (cards.length === 0) return;
            ctxScratchpad.clearRect(0, 0, canvasScratchpad.width, canvasScratchpad.height);
            cards[currentIndex].scratchpad = '';
            debouncedSave(); showToast('Scratchpad cleared', 'info');
        });

        function showConfirm(title, message, onConfirm) {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.innerHTML = `<div class="modal-box"><h3>${title}</h3><p>${message}</p><div class="modal-actions"><button class="btn btn-sm" id="modal-cancel">Cancel</button><button class="btn btn-sm btn-danger" id="modal-confirm">Delete</button></div></div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
            overlay.querySelector('#modal-confirm').addEventListener('click', () => { overlay.remove(); onConfirm(); });
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        }

        function setSyncing(syncing) { $('sync-dot').classList.toggle('syncing', syncing); $('sync-text').textContent = syncing ? 'Syncing…' : 'Synced'; }

        function showToast(msg, type = 'info') {
            const container = $('toast-container');
            const t = document.createElement('div');
            t.className = `toast ${type}`;
            t.textContent = msg;
            container.appendChild(t);
            setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(40px)'; t.style.transition = '0.3s ease'; setTimeout(() => t.remove(), 300); }, 2800);
        }

        document.addEventListener('keydown', e => {
            if (document.activeElement?.getAttribute('contenteditable') === 'true') return;
            if (document.querySelector('.modal-overlay')) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); prevCard(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); nextCard(); }
            if (e.key === ' ') { e.preventDefault(); flipCard(); }
            if (e.key === 'n' || e.key === 'N') { if (!e.ctrlKey && !e.metaKey) addCard(); }
            if (e.key === 'd' || e.key === 'D') { if (!e.ctrlKey && !e.metaKey) $('btn-draw-toggle').click(); }
        });

        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (cards.length) {
                    resizeCanvases();
                    loadDrawingToCanvas(ctxFront, canvasFront, cards[currentIndex].drawFront);
                    loadDrawingToCanvas(ctxBack, canvasBack, cards[currentIndex].drawBack);
                    if (scratchpadOpen) loadDrawingToCanvas(ctxScratchpad, canvasScratchpad, cards[currentIndex].scratchpad);
                }
            }, 150);
        });

        window.addEventListener('beforeunload', () => { if (saveTimeout) { clearTimeout(saveTimeout); saveAllCards(); } });

        // ── Swipe (single finger only, not pinch) ──
        let touchStartX = 0, touchStartY = 0, touchTarget = null, touchCount = 0;
        cardContainer.addEventListener('touchstart', (e) => {
            if (drawMode) return;
            touchCount = e.touches.length;
            if (touchCount > 1) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchTarget = e.target;
        }, { passive: true });
        cardContainer.addEventListener('touchend', (e) => {
            if (drawMode || touchCount > 1) return;
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            const absDx = Math.abs(dx), absDy = Math.abs(dy);
            if (absDx > 50 && absDx > absDy * 1.5) { if (dx > 0) prevCard(); else nextCard(); }
            else if (absDx < 10 && absDy < 10) { if (!touchTarget?.closest('.card-text')) flipCard(); }
        }, { passive: true });
