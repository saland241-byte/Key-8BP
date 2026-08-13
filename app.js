import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import {
    getFirestore,
    doc, getDoc, getDocs, collection, query, where,
    addDoc, serverTimestamp, setDoc, updateDoc,
    onSnapshot, orderBy, limit, startAfter,
    getCountFromServer, deleteDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// ── FIREBASE CONFIGURATION ────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyDLfcXVkIklV34wDetT1qtrbNs096Jq-Bk",
    authDomain: "sahand-f9388.firebaseapp.com",
    projectId: "sahand-f9388",
    storageBucket: "sahand-f9388.firebasestorage.app",
    messagingSenderId: "327521733346",
    appId: "1:327521733346:web:eb4a97c5c64404a180ecbb",
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── UI ELEMENTS ───────────────────────────────────────────────────────────────
const loginScreen    = document.getElementById('login-screen');
const mainDashboard  = document.getElementById('main-dashboard');
const loginBtn       = document.getElementById('login-btn');
const logoutBtnNav   = document.getElementById('logout-btn-nav');
const emailInput     = document.getElementById('email');
const passwordInput  = document.getElementById('password');
const loginError     = document.getElementById('login-error');
const tabs           = document.querySelectorAll('.nav-links li[data-tab]');
const tabContents    = document.querySelectorAll('.tab-content');

// Modal elements — queried after DOM is ready, NOT at top-level
// (they exist in HTML, but we reference them inside handlers to be safe)

let currentUserData = null;

// ── AUTH ──────────────────────────────────────────────────────────────────────
loginBtn.addEventListener('click', async () => {
    loginError.textContent = '';
    try {
        await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
    } catch {
        loginError.textContent = 'Invalid credentials. Please try again.';
    }
});

logoutBtnNav.addEventListener('click', () => {
    signOut(auth);
    location.reload();
});

onAuthStateChanged(auth, async (user) => {
    try {
        if (user) {
            loginScreen.classList.add('hidden');
            mainDashboard.classList.remove('hidden');

            // Role resolved from Firestore; UID in Firestore doc determines admin.
            const userRef  = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                currentUserData = userSnap.data();
            } else {
                // No users/ doc → treat as reseller (mod-client anonymous logins
                // also have no users/ doc but they don't reach this dashboard)
                currentUserData = { name: user.email || "User", role: "reseller" };
            }

            setupDashboard();
        } else {
            loginScreen.classList.remove('hidden');
            mainDashboard.classList.add('hidden');
        }
    } catch (e) {
        console.error("Auth state error:", e);
    }
});

// ── DASHBOARD SETUP ───────────────────────────────────────────────────────────
function setupDashboard() {
    document.getElementById('welcome-user').textContent    = `Welcome, ${currentUserData.name}`;
    document.getElementById('user-role-badge').textContent = currentUserData.role;

    if (currentUserData.role === 'admin') {
        document.getElementById('resellers-tab-link').classList.remove('hidden');
        document.getElementById('trial-option-container').classList.remove('hidden');
        loadResellers();
    }

    loadStats();
    loadKeys();
    setupTabSwitching();
    setupKeysDelegation();
}

// ── TAB SWITCHING ─────────────────────────────────────────────────────────────
function setupTabSwitching() {
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tabContents.forEach(c => c.classList.remove('active'));
            document.getElementById(`${target}-tab`).classList.add('active');
            // Only reload keys when the tab is actually switched to
            if (target === 'keys') loadKeys();
        });
    });
}

// ── KEY GENERATION ────────────────────────────────────────────────────────────
document.getElementById('generate-keys-btn').addEventListener('click', async () => {
    const generateBtn = document.getElementById('generate-keys-btn');
    const duration    = parseInt(document.getElementById('key-duration').value);
    const count       = parseInt(document.getElementById('key-count').value);
    const isTrial     = document.getElementById('is-trial-checkbox')?.checked || false;

    generateBtn.disabled    = true;
    generateBtn.textContent = 'Generating…';

    try {
        let lastKey = '';
        for (let i = 0; i < count; i++) {
            lastKey = generateKeyString();

            // Trial keys activate immediately; expiry stored as a Firestore Timestamp.
            const expiryTs = isTrial
                ? Timestamp.fromDate(new Date(Date.now() + duration * 86400000))
                : null;

            await addDoc(collection(db, "keys"), {
                key:          lastKey,
                duration:     duration,
                status:       isTrial ? "active" : "unused",
                reseller_uid: auth.currentUser.uid,
                reseller_name: currentUserData.name,
                is_trial:     isTrial,
                hwid:         null,
                registered_devices: null,
                max_devices:  1,
                activated_at: isTrial ? serverTimestamp() : null,
                expiry_date:  expiryTs,
                created_at:   serverTimestamp(),
                sec_data:     "0x4f06288,0x4e9feb8,0x4dde3e0,0x4dfe838,0x2d911e0,0x3068c94,0x0294879d,0x02948795,0x029487a5"
            });
        }

        await loadKeys();
        await loadStats();

        document.getElementById('result-duration').textContent      = `${duration} Day${duration === 1 ? '' : 's'} Plan`;
        document.getElementById('generated-key-display').textContent = lastKey;
        document.getElementById('key-result-modal').classList.remove('hidden');

    } catch (error) {
        console.error("Generation failed:", error);
        alert("Error: " + error.message);
    } finally {
        generateBtn.disabled    = false;
        generateBtn.textContent = 'Generate';
    }
});

// Result modal close & copy
document.getElementById('close-result-btn').addEventListener('click', () => {
    document.getElementById('key-result-modal').classList.add('hidden');
});

document.getElementById('copy-key-btn').addEventListener('click', () => {
    const key  = document.getElementById('generated-key-display').textContent;
    navigator.clipboard.writeText(key);
    const icon = document.querySelector('#copy-key-btn i');
    icon.classList.replace('fa-copy', 'fa-check');
    setTimeout(() => icon.classList.replace('fa-check', 'fa-copy'), 2000);
});

function generateKeyString() {
    const chars   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const segment = () => Array.from({ length: 5 },
        () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${segment()}-${segment()}-${segment()}-${segment()}-${segment()}`;
}

// ── STATS ─────────────────────────────────────────────────────────────────────
async function loadStats() {
    try {
        const coll = collection(db, "keys");

        // Use getCountFromServer instead of fetching all docs
        const [totalSnap, activeSnap, unusedSnap] = await Promise.all([
            getCountFromServer(coll),
            getCountFromServer(query(coll, where("status", "==", "active"))),
            getCountFromServer(query(coll, where("status", "==", "unused")))
        ]);

        document.getElementById('stat-total-keys').textContent  = totalSnap.data().count;
        document.getElementById('stat-active-keys').textContent = activeSnap.data().count;
        document.getElementById('stat-unused-keys').textContent = unusedSnap.data().count;
    } catch (e) {
        console.warn("Stats error:", e);
    }
}

// ── KEYS TABLE ────────────────────────────────────────────────────────────────
let lastVisible    = null;
let pageStack      = [];   // Stack of first-docs per page for back navigation
let currentPage    = 1;
const PAGE_SIZE    = 50;

async function loadKeys(direction = 'initial') {
    const keysList    = document.getElementById('keys-list');
    const baseColl    = collection(db, "keys");
    const searchQuery = document.getElementById('search-key-input').value.trim();

    let q;
    if (searchQuery) {
        // Search mode: exact key match, no pagination
        q = query(baseColl, where("key", "==", searchQuery));
    } else if (direction === 'next' && lastVisible) {
        q = query(baseColl, orderBy("created_at", "desc"), startAfter(lastVisible), limit(PAGE_SIZE));
    } else if (direction === 'prev' && pageStack.length > 1) {
        pageStack.pop();                          // Remove current page's marker
        const prevFirst = pageStack[pageStack.length - 1];
        q = query(baseColl, orderBy("created_at", "desc"), startAfter(prevFirst), limit(PAGE_SIZE));
    } else {
        // Initial load
        q = query(baseColl, orderBy("created_at", "desc"), limit(PAGE_SIZE));
        currentPage = 1;
        pageStack   = [];
    }

    try {
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            keysList.innerHTML = "<tr><td colspan='6' style='text-align:center;color:var(--text-dim);padding:30px;'>No keys found.</td></tr>";
            document.getElementById('next-page-btn').disabled = true;
            return;
        }

        // Update pagination state
        if (!searchQuery) {
            if (direction === 'initial') {
                pageStack.push(snapshot.docs[0]);
            } else if (direction === 'next') {
                currentPage++;
                pageStack.push(snapshot.docs[0]);
            } else if (direction === 'prev') {
                currentPage = Math.max(1, currentPage - 1);
            }
            lastVisible = snapshot.docs[snapshot.docs.length - 1];
        }

        keysList.innerHTML = '';
        snapshot.forEach(docSnap => {
            const d = docSnap.data();

            // Safely read expiry whether it's a Firestore Timestamp or a raw JS Date
            let expiryText = 'Not Active';
            if (d.expiry_date) {
                const date = d.expiry_date instanceof Timestamp
                    ? d.expiry_date.toDate()
                    : new Date(d.expiry_date.seconds ? d.expiry_date.seconds * 1000 : d.expiry_date);
                if (!isNaN(date)) expiryText = date.toLocaleDateString();
            }

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="key-cell">${d.key}</td>
                <td>${d.duration} Day${d.duration === 1 ? '' : 's'}</td>
                <td><span class="status-pill ${d.status}">${d.status}</span></td>
                <td>${d.hwid || 'N/A'}</td>
                <td>${expiryText}</td>
                <td><button class="delete-btn" data-id="${docSnap.id}">
                    <i class="fas fa-trash"></i>
                </button></td>
            `;
            keysList.appendChild(row);
        });

        document.getElementById('page-number').textContent     = `Page ${currentPage}`;
        document.getElementById('prev-page-btn').disabled      = (currentPage === 1);
        document.getElementById('next-page-btn').disabled      = (snapshot.docs.length < PAGE_SIZE);

    } catch (e) {
        console.error("Load keys error:", e);
    }
}

// Event delegation for delete buttons in the keys table — set up once
function setupKeysDelegation() {
    document.getElementById('keys-list').addEventListener('click', async (e) => {
        const btn = e.target.closest('.delete-btn');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        if (!id) return;
        await handleDeleteKey(id);
    });
}

async function handleDeleteKey(id) {
    if (!confirm("Delete this key? This cannot be undone.")) return;
    try {
        await deleteDoc(doc(db, "keys", id));
        await loadKeys();
        await loadStats();
    } catch (e) {
        alert("Delete failed: " + e.message);
    }
}

// Search & pagination events
document.getElementById('search-btn').addEventListener('click', () => loadKeys('initial'));
document.getElementById('search-key-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadKeys('initial');
});
document.getElementById('next-page-btn').addEventListener('click', () => loadKeys('next'));
document.getElementById('prev-page-btn').addEventListener('click', () => loadKeys('prev'));

// ── RESELLERS ─────────────────────────────────────────────────────────────────
async function loadResellers() {
    const q           = query(collection(db, "users"), where("role", "==", "reseller"));
    const resellerList = document.getElementById('reseller-list');

    onSnapshot(q, (snapshot) => {
        resellerList.innerHTML = '';
        snapshot.forEach(docSnap => {
            const d = docSnap.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${d.name}</td>
                <td>${d.email || '—'}</td>
                <td id="count-${docSnap.id}">…</td>
                <td><button class="delete-btn reseller-del-btn" data-uid="${docSnap.id}">
                    <i class="fas fa-trash"></i>
                </button></td>
            `;
            resellerList.appendChild(row);
            loadResellerKeyCount(docSnap.id);
        });
    });

    // Event delegation for reseller delete
    resellerList.addEventListener('click', async (e) => {
        const btn = e.target.closest('.reseller-del-btn');
        if (!btn) return;
        await deleteReseller(btn.getAttribute('data-uid'));
    });
}

async function loadResellerKeyCount(uid) {
    try {
        const snap = await getCountFromServer(
            query(collection(db, "keys"), where("reseller_uid", "==", uid))
        );
        const el = document.getElementById(`count-${uid}`);
        if (el) el.textContent = snap.data().count;
    } catch {}
}

async function deleteReseller(uid) {
    if (!confirm("Delete this reseller? Their keys will remain but the account will be removed.")) return;
    try {
        await deleteDoc(doc(db, "users", uid));
    } catch (e) {
        alert("Error: " + e.message);
    }
}

// ── ADD RESELLER MODAL ────────────────────────────────────────────────────────
document.getElementById('add-reseller-btn').addEventListener('click', () => {
    document.getElementById('modal-overlay').classList.remove('hidden');
});

document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('modal-overlay').classList.add('hidden');
});

document.getElementById('modal-confirm').addEventListener('click', async () => {
    const name  = document.getElementById('new-reseller-name').value.trim();
    const email = document.getElementById('new-reseller-email').value.trim();
    const pass  = document.getElementById('new-reseller-password').value;

    if (!name || !email || !pass) {
        alert("Please fill all fields.");
        return;
    }

    try {
        // Store the reseller doc. The doc ID is set to a placeholder that the
        // admin must replace after manually creating the Auth account in Firebase
        // Console (or via a Cloud Function that calls Admin SDK createUser).
        // The doc uses the email as a unique key so it's findable later.
        const resellerRef = doc(collection(db, "users"));
        await setDoc(resellerRef, {
            name,
            email,
            role:       "reseller",
            created_at: serverTimestamp()
        });

        document.getElementById('modal-overlay').classList.add('hidden');

        // Clear fields
        document.getElementById('new-reseller-name').value     = '';
        document.getElementById('new-reseller-email').value    = '';
        document.getElementById('new-reseller-password').value = '';

        alert(
            `Reseller doc created.\n\n` +
            `⚠️ Action required: go to Firebase Console → Authentication → Add User\n` +
            `   Email: ${email}\n   Password: (the one you entered)\n\n` +
            `Then update the Firestore users/ doc with the new Auth UID so the role check works.`
        );
    } catch (e) {
        console.error(e);
        alert("Error: " + e.message);
    }
});

// Close result modal when clicking the backdrop
document.getElementById('key-result-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        e.currentTarget.classList.add('hidden');
    }
});

// Close add-reseller modal when clicking the backdrop
document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        e.currentTarget.classList.add('hidden');
    }
});
