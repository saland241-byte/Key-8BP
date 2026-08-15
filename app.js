import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, collection, query, where, addDoc, serverTimestamp, setDoc, updateDoc, onSnapshot, orderBy, limit, startAfter, getCountFromServer, deleteDoc, arrayUnion, Timestamp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyDWSQnWBTGKdtcrOpcBhxaeWatdNQTdD_o",
  authDomain: "vampiric-engine-1ab68.firebaseapp.com",
  projectId: "vampiric-engine-1ab68",
  storageBucket: "vampiric-engine-1ab68.firebasestorage.app",
  messagingSenderId: "814988461613",
  appId: "1:814988461613:web:a9d52d91cab7e3307a5aa4",
  measurementId: "G-M5E9DYEVFF"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- ADMIN UID ---
// Single source of truth for the hardcoded admin account. This MUST match
// the UID hardcoded in firestore.rules' isAdmin() function — if the two
// ever drift apart, the person with this UID will see the admin UI here
// but every write will still be rejected server-side by Firestore rules
// (or vice-versa). Keep them in sync.
const ADMIN_UID = "3tHHc71lJ2b30li41W4BKStMRiw2";

// --- EMAIL NORMALIZATION ---
// One canonical normalization used everywhere an email touches the system:
// reseller creation, duplicate checks, Firestore storage, and Auth lookup.
// Firebase Auth itself is case-preserving-but-case-insensitive for email
// sign-in, but Firestore queries (e.g. our duplicate check) are NOT
// case-insensitive, so without this, "Reseller@Gmail.com" and
// "reseller@gmail.com" could both be added as "different" resellers while
// Firebase Auth would treat them as the same login.
function normalizeEmail(raw) {
    return (raw || "").trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
    return EMAIL_RE.test(email);
}

// --- RESET POLICY (mirrored server-side in firestore.rules — see that file) ---
const RESET_COOLDOWN_HOURS = 24;   // minimum time between resets on the same key
const RESET_MAX_COUNT = 3;         // lifetime resets allowed before a key needs manual admin override

// --- UI ELEMENTS ---
const loginScreen = document.getElementById('login-screen');
const mainDashboard = document.getElementById('main-dashboard');
const loginBtn = document.getElementById('login-btn');
const logoutBtnNav = document.getElementById('logout-btn-nav');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');

const tabs = document.querySelectorAll('.nav-links li[data-tab]');
const tabContents = document.querySelectorAll('.tab-content');

let currentUserData = null;
let keysCache = new Map(); // id -> key data, populated on each loadKeys() render, used by the reset/detail modals

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function toast(message, type = 'info') {
    const host = document.getElementById('toast-host');
    if (!host) { console.log(`[${type}] ${message}`); return; }

    const icons = {
        success: 'fa-circle-check',
        error: 'fa-circle-exclamation',
        info: 'fa-circle-info',
        warning: 'fa-triangle-exclamation'
    };

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
    host.appendChild(el);

    requestAnimationFrame(() => el.classList.add('toast-in'));

    setTimeout(() => {
        el.classList.remove('toast-in');
        el.classList.add('toast-out');
        setTimeout(() => el.remove(), 250);
    }, 4200);
}

// ============================================================
// CONFIRM DIALOG (generic, reused for delete + reset)
// ============================================================
function confirmDialog({ title, body, confirmLabel = 'Confirm', tone = 'default', icon = 'fa-triangle-exclamation' }) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-overlay');
        const box = document.getElementById('confirm-box');
        document.getElementById('confirm-icon').innerHTML = `<i class="fas ${icon}"></i>`;
        document.getElementById('confirm-title').innerText = title;
        document.getElementById('confirm-body').innerHTML = body;
        const confirmBtn = document.getElementById('confirm-action-btn');
        confirmBtn.innerText = confirmLabel;
        confirmBtn.className = `primary-btn small ${tone === 'danger' ? 'btn-danger' : ''}`;
        box.classList.toggle('confirm-danger', tone === 'danger');

        overlay.classList.remove('hidden');
        requestAnimationFrame(() => overlay.classList.add('overlay-in'));

        const cleanup = (result) => {
            overlay.classList.remove('overlay-in');
            setTimeout(() => overlay.classList.add('hidden'), 180);
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onOverlayClick);
            resolve(result);
        };
        const onConfirm = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onOverlayClick = (e) => { if (e.target === overlay) cleanup(false); };

        const cancelBtn = document.getElementById('confirm-cancel-btn');
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onOverlayClick);
    });
}

// ============================================================
// DELETE KEY
// ============================================================
async function handleDeleteKey(id) {
    const ok = await confirmDialog({
        title: 'Delete license key',
        body: 'This permanently deletes the key and its activation history. This cannot be undone.',
        confirmLabel: 'Delete key',
        tone: 'danger',
        icon: 'fa-trash'
    });
    if (!ok) return;

    try {
        await deleteDoc(doc(db, "keys", id));
        toast('Key deleted.', 'success');
        await loadKeys();
        await loadStats();
    } catch (e) {
        toast('Delete failed: ' + e.message, 'error');
    }
}

// ============================================================
// DEVICE RESET
// ============================================================
function msSince(tsLike) {
    if (!tsLike) return Infinity;
    const ms = tsLike.seconds ? tsLike.seconds * 1000 : new Date(tsLike).getTime();
    return Date.now() - ms;
}

function resetEligibility(data) {
    if (!data.hwid) {
        return { eligible: false, reason: 'No device is currently linked to this key.' };
    }
    const resetCount = data.reset_count || 0;
    if (resetCount >= RESET_MAX_COUNT) {
        return { eligible: false, reason: `Lifetime reset limit reached (${RESET_MAX_COUNT}). Contact an administrator to override.` };
    }
    const cooldownMs = RESET_COOLDOWN_HOURS * 60 * 60 * 1000;
    const sinceLast = msSince(data.last_reset_at);
    if (sinceLast < cooldownMs) {
        const hoursLeft = Math.ceil((cooldownMs - sinceLast) / (60 * 60 * 1000));
        return { eligible: false, reason: `Reset cooldown active. Available again in ~${hoursLeft}h.` };
    }
    return { eligible: true, reason: null };
}

async function handleResetDevice(id) {
    const data = keysCache.get(id);
    if (!data) { toast('Key data not loaded — refresh and try again.', 'error'); return; }

    const check = resetEligibility(data);
    if (!check.eligible) {
        toast(check.reason, 'warning');
        return;
    }

    const resetsUsed = data.reset_count || 0;
    const ok = await confirmDialog({
        title: 'Reset device binding?',
        body: `This clears the device currently linked to <strong>${data.key}</strong>. The next device to activate this key will be bound as the new device.<br><br>
               Resets used: <strong>${resetsUsed} / ${RESET_MAX_COUNT}</strong><br>
               Cooldown after reset: <strong>${RESET_COOLDOWN_HOURS}h</strong>`,
        confirmLabel: 'Reset device',
        tone: 'danger',
        icon: 'fa-arrows-rotate'
    });
    if (!ok) return;

    const btn = document.querySelector(`.reset-btn[data-id="${id}"]`);
    const originalHTML = btn ? btn.innerHTML : null;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
    }

    try {
        const keyRef = doc(db, "keys", id);
        // Re-read immediately before writing to reduce race conditions with concurrent resets/activations.
        const freshSnap = await getDoc(keyRef);
        if (!freshSnap.exists()) throw new Error('Key no longer exists.');
        const fresh = freshSnap.data();

        const freshCheck = resetEligibility(fresh);
        if (!freshCheck.eligible) {
            toast(freshCheck.reason, 'warning');
            return;
        }

        const previousHwid = fresh.hwid;
        const historyEntry = {
            reset_at: Timestamp.now(),
            reset_by: currentUserData?.name || auth.currentUser?.uid || 'unknown',
            previous_hwid: previousHwid
        };

        await updateDoc(keyRef, {
            hwid: null,
            device_bound_at: null,
            last_reset_at: serverTimestamp(),
            reset_count: (fresh.reset_count || 0) + 1,
            reset_history: arrayUnion(historyEntry),
            // If the key was active purely because a device was bound, drop it back to unused
            // so the panel reflects reality; expired keys stay expired.
            status: fresh.status === 'active' ? 'unused' : fresh.status
        });

        toast('Device reset. The key can now be activated on a new device.', 'success');
        await loadKeys();
        await loadStats();
    } catch (e) {
        console.error('Reset failed:', e);
        toast('Reset failed: ' + e.message, 'error');
    } finally {
        if (btn && originalHTML) {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    }
}

// ============================================================
// KEY DETAIL DRAWER
// ============================================================
function fmtDate(tsLike) {
    if (!tsLike) return '—';
    const ms = tsLike.seconds ? tsLike.seconds * 1000 : new Date(tsLike).getTime();
    if (Number.isNaN(ms)) return '—';
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function openKeyDetail(id) {
    const data = keysCache.get(id);
    if (!data) return;

    const overlay = document.getElementById('detail-overlay');
    document.getElementById('detail-key').innerText = data.key;
    document.getElementById('detail-status').innerHTML = `<span class="status-pill ${data.status}">${data.status}</span>`;
    document.getElementById('detail-hwid').innerText = data.hwid || 'Not linked';
    document.getElementById('detail-bound-at').innerText = fmtDate(data.device_bound_at);
    document.getElementById('detail-last-seen').innerText = fmtDate(data.last_seen_at);
    document.getElementById('detail-created').innerText = fmtDate(data.created_at);
    document.getElementById('detail-activated').innerText = fmtDate(data.activated_at);
    document.getElementById('detail-expiry').innerText = data.expiry_date ? fmtDate(data.expiry_date) : 'Not active';
    document.getElementById('detail-reset-count').innerText = `${data.reset_count || 0} / ${RESET_MAX_COUNT}`;
    document.getElementById('detail-last-reset').innerText = fmtDate(data.last_reset_at);

    const check = resetEligibility(data);
    const resetBtn = document.getElementById('detail-reset-btn');
    resetBtn.disabled = !check.eligible;
    resetBtn.title = check.eligible ? '' : check.reason;
    resetBtn.onclick = () => handleResetDevice(id);

    const historyList = document.getElementById('detail-history-list');
    const history = (data.reset_history || []).slice().reverse().slice(0, 10);
    if (history.length === 0) {
        historyList.innerHTML = `<li class="history-empty">No resets yet.</li>`;
    } else {
        historyList.innerHTML = history.map(h => `
            <li>
                <i class="fas fa-arrows-rotate"></i>
                <div>
                    <div class="history-line">${fmtDate(h.reset_at)}</div>
                    <div class="history-sub">by ${h.reset_by || 'unknown'} · was ${h.previous_hwid ? h.previous_hwid.slice(0, 18) + (h.previous_hwid.length > 18 ? '…' : '') : 'N/A'}</div>
                </div>
            </li>
        `).join('');
    }

    overlay.classList.remove('hidden');
    requestAnimationFrame(() => overlay.classList.add('overlay-in'));
}

document.getElementById('detail-close-btn')?.addEventListener('click', closeKeyDetail);
document.getElementById('detail-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'detail-overlay') closeKeyDetail();
});
function closeKeyDetail() {
    const overlay = document.getElementById('detail-overlay');
    overlay.classList.remove('overlay-in');
    setTimeout(() => overlay.classList.add('hidden'), 180);
}

// --- AUTH LOGIC ---
loginBtn.addEventListener('click', async () => {
    const email = normalizeEmail(emailInput.value);
    const password = passwordInput.value;
    loginError.innerText = '';

    if (!isValidEmail(email)) {
        loginError.innerText = "Please enter a valid email address.";
        return;
    }
    if (!password) {
        loginError.innerText = "Please enter your password.";
        return;
    }

    loginBtn.disabled = true;
    loginBtn.classList.add('btn-loading');
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        // Firebase Auth error codes -> user-friendly messages. We don't
        // surface raw error.message here (see error-handling notes below).
        switch (error.code) {
            case 'auth/user-not-found':
            case 'auth/invalid-credential':
            case 'auth/wrong-password':
                loginError.innerText = "Invalid email or password.";
                break;
            case 'auth/too-many-requests':
                loginError.innerText = "Too many attempts. Please wait a moment and try again.";
                break;
            case 'auth/user-disabled':
                loginError.innerText = "This account has been disabled. Contact your admin.";
                break;
            default:
                loginError.innerText = "Unable to sign in. Please try again.";
        }
    } finally {
        loginBtn.disabled = false;
        loginBtn.classList.remove('btn-loading');
    }
});

// Allow Enter key to submit login from either field
[emailInput, passwordInput].forEach(input => {
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loginBtn.click();
    });
});

logoutBtnNav.addEventListener('click', () => {
    signOut(auth);
    location.reload();
});

// --- AUTH STATE ---
onAuthStateChanged(auth, async (user) => {
    try {
        if (user) {
            console.log("User detected:", user.uid);

            loginScreen.classList.add('hidden');
            mainDashboard.classList.remove('hidden');

            // Hardcoded admin account (see ADMIN_UID above).
            if (user.uid === ADMIN_UID) {
                currentUserData = { name: "TEAM 18-81 Admin", role: "admin" };
                setupDashboard();
                return;
            }

            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                // Reseller docs are now written with the real Auth UID as the
                // doc ID (see the Add Reseller handler below), so this is a
                // real, reliable lookup rather than a coincidental miss.
                currentUserData = userDoc.data();
                setupDashboard();
            } else {
                // A signed-in Auth user with no matching Firestore doc is not
                // a normal reseller state anymore (it used to be the default
                // outcome for every reseller, due to the UID mismatch bug).
                // Treat it as unprovisioned rather than silently granting
                // reseller access, and sign them out so they don't sit in a
                // half-authenticated limbo.
                console.warn("Signed-in user has no matching Firestore profile:", user.uid);
                loginError.innerText = "Your account has no reseller profile. Contact your admin.";
                await signOut(auth);
                currentUserData = null;
            }
        } else {
            loginScreen.classList.remove('hidden');
            mainDashboard.classList.add('hidden');
        }
    } catch (e) {
        console.error("Auth State Error:", e);
    }
});

function setupDashboard() {
    document.getElementById('welcome-user').innerText = `Welcome, ${currentUserData.name}`;
    document.getElementById('user-role-badge').innerText = currentUserData.role;

    if (currentUserData.role === 'admin') {
        document.getElementById('resellers-tab-link').classList.remove('hidden');
        document.getElementById('trial-option-container').classList.remove('hidden');
        loadResellers();
    }

    loadStats();
    loadKeys();
    setupTabSwitching();

    const keysList = document.getElementById('keys-list');
    if (keysList) {
        keysList.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-btn');
            const resetBtn = e.target.closest('.reset-btn');
            const keyCell = e.target.closest('.key-cell');

            if (deleteBtn) {
                handleDeleteKey(deleteBtn.getAttribute('data-id'));
            } else if (resetBtn) {
                handleResetDevice(resetBtn.getAttribute('data-id'));
            } else if (keyCell) {
                openKeyDetail(keyCell.getAttribute('data-id'));
            }
        });
    }
}

// --- TAB SWITCHING ---
function setupTabSwitching() {
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tabContents.forEach(c => c.classList.remove('active'));
            document.getElementById(`${target}-tab`).classList.add('active');
            const eyebrow = document.getElementById('topbar-eyebrow');
            if (eyebrow) eyebrow.innerText = tab.innerText.trim();
            if (target === 'keys') loadKeys();
        });
    });
}

// --- KEY GENERATION ---
const generateBtn = document.getElementById('generate-keys-btn');
generateBtn.addEventListener('click', async () => {
    const duration = parseInt(document.getElementById('key-duration').value);
    const count = parseInt(document.getElementById('key-count').value);
    const isTrial = document.getElementById('is-trial-checkbox')?.checked || false;

    if (!count || count < 1) { toast('Enter a valid number of keys.', 'warning'); return; }

    const originalHTML = generateBtn.innerHTML;
    generateBtn.disabled = true;
    generateBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Generating…`;

    try {
        let lastKey = "";
        for (let i = 0; i < count; i++) {
            const keyVal = generateKeyString();
            lastKey = keyVal;
            await addDoc(collection(db, "keys"), {
                key: keyVal,
                duration: duration,
                status: isTrial ? "active" : "unused",
                reseller_uid: auth.currentUser.uid,
                reseller_name: currentUserData.name,
                is_trial: isTrial,
                hwid: null,
                device_bound_at: null,
                last_seen_at: null,
                reset_count: 0,
                reset_history: [],
                last_reset_at: null,
                activated_at: isTrial ? serverTimestamp() : null,
                expiry_date: isTrial ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000) : null,
                created_at: serverTimestamp(),
                sec_data: "0x4f06288,0x4e9feb8,0x4dde3e0,0x4dfe838,0x2d911e0,0x3068c94,0x0294879d,0x02948795,0x029487a5"
            });
        }

        await loadKeys();
        await loadStats();

        document.getElementById('result-duration').innerText = `${duration} Days Plan`;
        document.getElementById('generated-key-display').innerText = lastKey;
        document.getElementById('key-result-modal').classList.remove('hidden');
        toast(count > 1 ? `${count} keys generated.` : 'Key generated.', 'success');

    } catch (error) {
        console.error("Generation failed:", error);
        toast('Generation failed: ' + error.message, 'error');
    } finally {
        generateBtn.disabled = false;
        generateBtn.innerHTML = originalHTML;
    }
});

// Close Result Modal
document.getElementById('close-result-btn').addEventListener('click', () => {
    document.getElementById('key-result-modal').classList.add('hidden');
});

// Copy Result Key
document.getElementById('copy-key-btn').addEventListener('click', () => {
    const key = document.getElementById('generated-key-display').innerText;
    navigator.clipboard.writeText(key);
    const icon = document.querySelector('#copy-key-btn i');
    icon.classList.replace('fa-copy', 'fa-check');
    toast('Key copied to clipboard.', 'success');
    setTimeout(() => icon.classList.replace('fa-check', 'fa-copy'), 2000);
});

// --- KEY FORMAT: TEAM18-81-XXXXX-XXXXX ---
function generateKeyString() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const segment = (len) => {
        let s = "";
        for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
        return s;
    };
    return `TEAM18-81-${segment(5)}-${segment(5)}`;
}

// --- DATA LOADING ---
async function loadStats() {
    try {
        const coll = collection(db, "keys");
        const totalSnap = await getCountFromServer(coll);
        document.getElementById('stat-total-keys').innerText = totalSnap.data().count;

        const activeSnap = await getCountFromServer(query(coll, where("status", "==", "active")));
        document.getElementById('stat-active-keys').innerText = activeSnap.data().count;

        const unusedSnap = await getCountFromServer(query(coll, where("status", "==", "unused")));
        document.getElementById('stat-unused-keys').innerText = unusedSnap.data().count;
    } catch (e) {
        console.warn("Stats error:", e);
    }
}

let lastVisible = null;
let currentPage = 1;
const pageSize = 50;
// Stack of "first doc snapshot" cursors for each page we've visited, so the
// Prev button can actually step backward (Firestore cursors are forward-only
// by default). pageStartStack[0] is always null (page 1 has no start cursor).
let pageStartStack = [null];

function skeletonRows(n = 6) {
    return Array.from({ length: n }).map(() => `
        <tr class="skeleton-row">
            <td><div class="skel skel-key"></div></td>
            <td><div class="skel skel-sm"></div></td>
            <td><div class="skel skel-pill"></div></td>
            <td><div class="skel skel-sm"></div></td>
            <td><div class="skel skel-sm"></div></td>
            <td><div class="skel skel-actions"></div></td>
        </tr>
    `).join('');
}

async function loadKeys(direction = 'initial') {
    let q;
    const keysList = document.getElementById('keys-list');
    const baseColl = collection(db, "keys");
    const searchQuery = document.getElementById('search-key-input').value.trim();

    keysList.innerHTML = skeletonRows();

    if (searchQuery) {
        q = query(baseColl, where("key", "==", searchQuery));
    } else {
        if (direction === 'next' && lastVisible) {
            q = query(baseColl, orderBy('created_at', 'desc'), limit(pageSize), startAfter(lastVisible));
        } else if (direction === 'prev' && currentPage > 1) {
            currentPage--;
            // pageStartStack[i] holds the cursor to reach page (i + 1).
            const cursor = pageStartStack[currentPage - 1];
            q = cursor
                ? query(baseColl, orderBy('created_at', 'desc'), limit(pageSize), startAfter(cursor))
                : query(baseColl, orderBy('created_at', 'desc'), limit(pageSize));
        } else {
            q = query(baseColl, orderBy('created_at', 'desc'), limit(pageSize));
            currentPage = 1;
            pageStartStack = [null];
        }
    }

    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            keysList.innerHTML = `
                <tr class="empty-row">
                    <td colspan="6">
                        <div class="empty-state">
                            <i class="fas fa-key empty-icon"></i>
                            <p>${searchQuery ? 'No key matches that search.' : 'No keys generated yet.'}</p>
                        </div>
                    </td>
                </tr>`;
            return;
        }

        const previousLastVisible = lastVisible;
        lastVisible = snapshot.docs[snapshot.docs.length - 1];

        // pageStartStack[i] = the cursor needed to reach page (i + 1).
        // pageStartStack[0] is always null (page 1 needs no cursor).
        if (!searchQuery) {
            if (direction === 'next') {
                pageStartStack[currentPage - 1] = previousLastVisible;
            } else if (direction !== 'prev') {
                pageStartStack = [null];
            }
        }

        keysCache.clear();

        keysList.innerHTML = "";
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            keysCache.set(docSnap.id, data);

            const check = resetEligibility(data);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="key-cell" data-id="${docSnap.id}" title="Click for details">${data.key}</td>
                <td>${data.duration} Days</td>
                <td><span class="status-pill ${data.status}">${data.status}</span></td>
                <td class="hwid-cell">${data.hwid ? `<i class="fas fa-mobile-screen-button hwid-icon"></i> ${data.hwid.slice(0, 14)}${data.hwid.length > 14 ? '…' : ''}` : '<span class="muted">Not linked</span>'}</td>
                <td>${data.expiry_date ? new Date(data.expiry_date.seconds * 1000 || data.expiry_date).toLocaleDateString() : 'Not Active'}</td>
                <td class="actions-cell">
                    <button class="icon-action-btn reset-btn" data-id="${docSnap.id}" title="${check.eligible ? 'Reset device' : check.reason}" ${check.eligible ? '' : 'disabled'}>
                        <i class="fas fa-arrows-rotate"></i>
                    </button>
                    <button class="icon-action-btn delete-btn" data-id="${docSnap.id}" title="Delete key">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            keysList.appendChild(row);
        });

        document.getElementById('page-number').innerText = `Page ${currentPage}`;
        document.getElementById('prev-page-btn').disabled = (currentPage === 1);
    } catch (e) {
        console.error("Load Keys Error:", e);
        keysList.innerHTML = `
            <tr class="empty-row">
                <td colspan="6">
                    <div class="empty-state empty-state-error">
                        <i class="fas fa-triangle-exclamation"></i>
                        <p>Couldn't load keys. ${e.message}</p>
                    </div>
                </td>
            </tr>`;
    }
}

document.getElementById('search-btn').addEventListener('click', () => loadKeys());
document.getElementById('search-key-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadKeys();
});
document.getElementById('next-page-btn').addEventListener('click', () => {
    currentPage++;
    loadKeys('next');
});
document.getElementById('prev-page-btn').addEventListener('click', () => {
    loadKeys('prev');
});
document.getElementById('search-key-input').addEventListener('input', (e) => {
    if (e.target.value.trim() === '') loadKeys(); // restore full paginated list once search is cleared
});

// --- RESELLERS ---
async function loadResellers() {
    const q = query(collection(db, "users"), where("role", "==", "reseller"));
    const resellerList = document.getElementById('reseller-list');

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            resellerList.innerHTML = `
                <tr class="empty-row">
                    <td colspan="4">
                        <div class="empty-state">
                            <i class="fas fa-users empty-icon"></i>
                            <p>No resellers yet. Add one to get started.</p>
                        </div>
                    </td>
                </tr>`;
            return;
        }
        resellerList.innerHTML = "";
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${data.name}</td>
                <td>${data.email}</td>
                <td><span id="count-${docSnap.id}">…</span></td>
                <td class="actions-cell"><button class="icon-action-btn delete-btn" data-reseller-id="${docSnap.id}" title="Delete reseller"><i class="fas fa-trash"></i></button></td>
            `;
            resellerList.appendChild(row);
            updateResellerKeyCount(docSnap.id);
        });
    });
}

document.getElementById('reseller-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.delete-btn[data-reseller-id]');
    if (btn) handleDeleteReseller(btn.getAttribute('data-reseller-id'));
});

async function handleDeleteReseller(id) {
    const ok = await confirmDialog({
        title: 'Delete reseller',
        body: 'This removes the reseller record from Firestore. Their existing keys remain, but they will lose panel access once their Auth account is also removed.',
        confirmLabel: 'Delete reseller',
        tone: 'danger',
        icon: 'fa-user-slash'
    });
    if (!ok) return;
    try {
        await deleteDoc(doc(db, "users", id));
        toast('Reseller deleted.', 'success');
    } catch (e) {
        toast('Delete failed: ' + e.message, 'error');
    }
}

async function updateResellerKeyCount(uid) {
    const q = query(collection(db, "keys"), where("reseller_uid", "==", uid));
    const snap = await getCountFromServer(q);
    const el = document.getElementById(`count-${uid}`);
    if (el) el.innerText = snap.data().count;
}

// --- ADD RESELLER MODAL ---
const modalOverlay = document.getElementById('modal-overlay');
document.getElementById('add-reseller-btn').addEventListener('click', () => {
    modalOverlay.classList.remove('hidden');
    requestAnimationFrame(() => modalOverlay.classList.add('overlay-in'));
});
function closeAddResellerModal() {
    modalOverlay.classList.remove('overlay-in');
    setTimeout(() => modalOverlay.classList.add('hidden'), 180);
}
document.getElementById('modal-cancel').addEventListener('click', closeAddResellerModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeAddResellerModal(); });

// Creates a Firebase Auth account for a new reseller WITHOUT signing the
// admin out of their own session. The Firebase client SDK always signs in
// as whichever user was just created on a given Auth instance, so we spin
// up a short-lived, isolated secondary App + Auth instance, create the user
// there, capture the resulting UID, then tear the secondary app down. The
// admin's real `auth` instance (declared at the top of this file) is never
// touched, so their session is untouched throughout.
async function createResellerAuthAccount(email, password) {
    const secondaryApp = initializeApp(firebaseConfig, "reseller-creation-" + Date.now());
    const secondaryAuth = getAuth(secondaryApp);
    try {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        return cred.user.uid;
    } finally {
        // Sign out on the secondary instance and discard the app entirely.
        // This never affects the admin's session on the primary `auth`.
        try { await signOut(secondaryAuth); } catch (_) { /* best-effort */ }
        try { await deleteApp(secondaryApp); } catch (_) { /* best-effort */ }
    }
}

document.getElementById('modal-confirm').addEventListener('click', async () => {
    const name = document.getElementById('new-reseller-name').value.trim();
    const email = normalizeEmail(document.getElementById('new-reseller-email').value);
    const pass = document.getElementById('new-reseller-password').value;

    if (!name || !email || !pass) { toast('Please fill in all fields.', 'warning'); return; }
    if (!isValidEmail(email)) { toast('Please enter a valid email address.', 'warning'); return; }
    if (pass.length < 6) { toast('Password must be at least 6 characters.', 'warning'); return; }

    const confirmBtn = document.getElementById('modal-confirm');
    const originalHTML = confirmBtn.innerHTML;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Adding…`;

    try {
        // Duplicate check first: query by normalized email rather than
        // relying only on Auth's own "email already in use" error, so we
        // can show a clear message before attempting account creation.
        const dupQuery = query(collection(db, "users"), where("email", "==", email));
        const dupSnap = await getDocs(dupQuery);
        if (!dupSnap.empty) {
            toast('This reseller email already exists.', 'error');
            return;
        }

        // Step 1: create the real Firebase Auth account and get its real UID.
        let uid;
        try {
            uid = await createResellerAuthAccount(email, pass);
        } catch (authError) {
            if (authError.code === 'auth/email-already-in-use') {
                toast('This reseller email already exists.', 'error');
            } else if (authError.code === 'auth/invalid-email') {
                toast('Please enter a valid email address.', 'error');
            } else if (authError.code === 'auth/weak-password') {
                toast('Password is too weak. Use at least 6 characters.', 'error');
            } else {
                console.error(authError);
                toast('Unable to create the authentication account.', 'error');
            }
            return;
        }

        // Step 2: create the Firestore profile using the REAL Auth UID as
        // the doc ID. This is the key fix — the reseller's login (in
        // onAuthStateChanged above) looks up doc(db, "users", user.uid),
        // so the doc ID must equal the Auth UID for the lookup to ever
        // succeed.
        try {
            await setDoc(doc(db, "users", uid), {
                name: name,
                email: email,
                role: "reseller",
                created_at: serverTimestamp()
            });
        } catch (dbError) {
            // Partial failure: the Auth account now exists but has no
            // matching Firestore profile. We can't delete another user's
            // Auth account from a client (that requires the Admin SDK /
            // Cloud Function), so we surface this clearly instead of
            // pretending it fully succeeded or leaving it silently broken.
            console.error(dbError);
            toast('Reseller account was created, but profile setup failed. Contact support with this email: ' + email, 'error');
            return;
        }

        toast(`Reseller "${name}" created successfully. They can log in immediately.`, 'success');
        closeAddResellerModal();
        document.getElementById('new-reseller-name').value = '';
        document.getElementById('new-reseller-email').value = '';
        document.getElementById('new-reseller-password').value = '';
    } catch (e) {
        console.error(e);
        toast('Something went wrong while adding the reseller. Please try again.', 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalHTML;
    }
});
