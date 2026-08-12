import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, collection, query, where, addDoc, serverTimestamp, setDoc, updateDoc, onSnapshot, orderBy, limit, startAfter, getCountFromServer, deleteDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- FIREBASE CONFIGURATION ---
// USER: Replace this with your actual Firebase config from Firebase Console
const firebaseConfig = {
    apiKey: "AIzaSyCzfbotjRCNYM2j_wRwICU03cx6EbKjWfE",
    authDomain: "lionengine.firebaseapp.com",
    projectId: "lionengine",
    storageBucket: "lionengine.firebasestorage.app",
    messagingSenderId: "449107794375",
    appId: "1:449107794375:web:57124ecae474162b0de1e2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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

// Helper to handle delete key
async function handleDeleteKey(id) {
    if (!confirm("Are you sure you want to delete this key?")) return;
    try {
        await deleteDoc(doc(db, "keys", id));
        await loadKeys();
        await loadStats();
    } catch (e) {
        alert("Error: " + e.message);
    }
}

// --- AUTH LOGIC ---
loginBtn.addEventListener('click', async () => {
    const email = emailInput.value;
    const password = passwordInput.value;
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        loginError.innerText = "Invalid credentials!";
    }
});

logoutBtnNav.addEventListener('click', () => {
    signOut(auth);
    location.reload();
});

// --- AUTH LOGIC ---
onAuthStateChanged(auth, async (user) => {
    try {
        if (user) {
            console.log("User detected:", user.uid);
            
            // Show dashboard IMMEDIATELY
            loginScreen.classList.add('hidden');
            mainDashboard.classList.remove('hidden');

            // Hardcoded check for your specific UID
            if (user.uid === "FmPmcspzqzPHsYFlEToUgD2ATKj1") {
                currentUserData = { name: "Lion Admin", role: "admin" };
                setupDashboard();
                return;
            }

            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                currentUserData = userDoc.data();
                setupDashboard();
            } else {
                console.warn("User doc not found, but allowing basic access.");
                currentUserData = { name: "User", role: "reseller" };
                setupDashboard();
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

    // Attach delegation once
    const keysList = document.getElementById('keys-list');
    if (keysList) {
        keysList.onclick = (e) => {
            const id = e.target.getAttribute('data-id');
            if (id && (e.target.classList.contains('delete-btn') || e.target.parentElement.classList.contains('delete-btn'))) {
                handleDeleteKey(id);
            }
        };
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
            if (target === 'keys') loadKeys();
        });
    });
}

// --- KEY GENERATION LOGIC ---
const generateBtn = document.getElementById('generate-keys-btn');
generateBtn.addEventListener('click', async () => {
    const duration = parseInt(document.getElementById('key-duration').value);
    const count = parseInt(document.getElementById('key-count').value);
    const isTrial = document.getElementById('is-trial-checkbox')?.checked || false;
    
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
                activated_at: isTrial ? serverTimestamp() : null,
                expiry_date: isTrial ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000) : null,
                created_at: serverTimestamp(),
                sec_data: "0x4f06288,0x4e9feb8,0x4dde3e0,0x4dfe838,0x2d911e0,0x3068c94,0x0294879d,0x02948795,0x029487a5"
            });
        }

        await loadKeys();
        await loadStats();

        // Show result modal
        document.getElementById('result-duration').innerText = `${duration} Days Plan`;
        document.getElementById('generated-key-display').innerText = lastKey;
        document.getElementById('key-result-modal').classList.remove('hidden');

    } catch (error) {
        console.error("Generation failed:", error);
        alert("Error: " + error.message);
    } finally {
        generateBtn.disabled = false;
        generateBtn.innerText = "Generate";
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
    setTimeout(() => icon.classList.replace('fa-check', 'fa-copy'), 2000);
});

function generateKeyString() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const segment = () => {
        let s = "";
        for (let i = 0; i < 5; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
        return s;
    };
    return `LIONX-${segment()}-${segment()}-${segment()}`;
}

// --- DATA LOADING ---
async function loadStats() {
    try {
        const coll = collection(db, "keys");
        const totalSnap = await getDocs(coll);
        document.getElementById('stat-total-keys').innerText = totalSnap.size;

        const activeQuery = query(coll, where("status", "==", "active"));
        const activeSnap = await getDocs(activeQuery);
        document.getElementById('stat-active-keys').innerText = activeSnap.size;

        const unusedQuery = query(coll, where("status", "==", "unused"));
        const unusedSnap = await getDocs(unusedQuery);
        document.getElementById('stat-unused-keys').innerText = unusedSnap.size;
    } catch (e) {
        console.warn("Stats error:", e);
    }
}

let lastVisible = null;
let firstVisible = null;
let currentPage = 1;
const pageSize = 50;

async function loadKeys(direction = 'initial') {
    let q;
    const keysList = document.getElementById('keys-list');
    const baseColl = collection(db, "keys");
    const searchQuery = document.getElementById('search-key-input').value.trim();

    if (searchQuery) {
        // Search mode: ignores pagination
        q = query(baseColl, where("key", "==", searchQuery));
    } else {
        // Normal Paginated mode
        if (direction === 'next' && lastVisible) {
            q = query(baseColl, limit(pageSize), startAfter(lastVisible));
        } else {
            q = query(baseColl, limit(pageSize));
            currentPage = 1;
        }
    }

    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            keysList.innerHTML = "<tr><td colspan='6' style='text-align:center;'>No keys found.</td></tr>";
            return;
        }

        lastVisible = snapshot.docs[snapshot.docs.length - 1];
        firstVisible = snapshot.docs[0];

        keysList.innerHTML = "";
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="key-cell">${data.key}</td>
                <td>${data.duration} Days</td>
                <td><span class="status-pill ${data.status}">${data.status}</span></td>
                <td>${data.hwid || 'N/A'}</td>
                <td>${data.expiry_date ? new Date(data.expiry_date.seconds * 1000 || data.expiry_date).toLocaleDateString() : 'Not Active'}</td>
                <td><button class="delete-btn" data-id="${docSnap.id}"><i class="fas fa-trash" data-id="${docSnap.id}"></i></button></td>
            `;
            keysList.appendChild(row);
        });
        
        document.getElementById('page-number').innerText = `Page ${currentPage}`;
        document.getElementById('prev-page-btn').disabled = (currentPage === 1);
    } catch (e) {
        console.error("Load Keys Error:", e);
    }
}

// Search and Pagination Events
document.getElementById('search-btn').addEventListener('click', () => loadKeys());
document.getElementById('next-page-btn').addEventListener('click', () => {
    currentPage++;
    loadKeys('next');
});
document.getElementById('prev-page-btn').addEventListener('click', () => {
    loadKeys('prev');
});

async function loadResellers() {
    const q = query(collection(db, "users"), where("role", "==", "reseller"));
    const resellerList = document.getElementById('reseller-list');
    
    onSnapshot(q, (snapshot) => {
        resellerList.innerHTML = "";
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${data.name}</td>
                <td>${data.email}</td>
                <td><span id="count-${docSnap.id}">...</span></td>
                <td><button class="delete-btn" onclick="deleteReseller('${docSnap.id}')">Delete</button></td>
            `;
            resellerList.appendChild(row);
            updateResellerKeyCount(docSnap.id);
        });
    });
}

async function updateResellerKeyCount(uid) {
    const q = query(collection(db, "keys"), where("reseller_uid", "==", uid));
    const snap = await getDocs(q);
    const el = document.getElementById(`count-${uid}`);
    if (el) el.innerText = snap.size;
}

// --- ADMIN MODAL LOGIC ---
const modalOverlay = document.getElementById('modal-overlay');
const addResellerBtn = document.getElementById('add-reseller-btn');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');

addResellerBtn.addEventListener('click', () => {
    modalOverlay.classList.remove('hidden');
});

modalCancel.addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
});

modalConfirm.addEventListener('click', async () => {
    const name = document.getElementById('new-reseller-name').value;
    const email = document.getElementById('new-reseller-email').value;
    const pass = document.getElementById('new-reseller-password').value;

    if (!name || !email || !pass) return alert("Fill all fields");

    // Note: Creating user in Firebase requires special handling for Admin creating others.
    // Usually done via Firebase Cloud Functions or a custom API.
    // For now, we will just add the doc to 'users' collection. 
    // You will need to manually create the Auth account in Firebase Console or use a Function.
    
    try {
        // We simulate reseller creation by adding to Firestore.
        // User MUST manually add the email/pass in Firebase Auth for now, 
        // OR we'd use a Cloud Function (recommended for "Super Fast" panels).
        alert("Reseller data added to Firestore. Please create the Auth account in Firebase Console for this email.");
        await setDoc(doc(db, "users", "MANUAL_AUTH_REQUIRED_" + Date.now()), {
            name: name,
            email: email,
            role: "reseller",
            created_at: serverTimestamp()
        });
        modalOverlay.classList.add('hidden');
    } catch (e) {
        console.error(e);
    }
});

// Global helpers (exposed to window for onclick)
window.deleteKey = async (id) => {
    if (!confirm("Are you sure you want to delete this key?")) return;
    
    try {
        const keyRef = doc(db, "keys", id);
        await deleteDoc(keyRef);
        console.log("Key deleted successfully:", id);
        await loadKeys();
        await loadStats();
    } catch (e) {
        console.error("Delete Error:", e);
        alert("Delete failed: " + e.message);
    }
};
