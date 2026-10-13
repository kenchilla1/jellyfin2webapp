const authForm = document.getElementById('auth-form');
const statusMessage = document.getElementById('connection-status');
const serverSelect = document.getElementById('jellyfin-server');
const serverAddressPreview = document.getElementById('server-address-preview');
const localModeButton = document.getElementById('local-mode');
const remoteModeButton = document.getElementById('remote-mode');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const rememberLoginInput = document.getElementById('remember-login');
const loginStorageKey = 'jellyfinRememberedLogin';
const manualLoginRequested = new URLSearchParams(window.location.search).get('manual') === '1';
let rememberedLogin = readRememberedLogin();
let connectionMode = ['local', 'remote'].includes(rememberedLogin?.mode) ? rememberedLogin.mode : 'local';
let defaultUsername = 'kenny';

const jellyfinServers = {
    local: {
        film: 'http://192.168.1.155:8096/',
        porn: 'http://192.168.1.155:6961/'
    },
    remote: {
        film: 'https://film.1zero.org',
        porn: 'https://xcode.1zero.org'
    }
};

if (manualLoginRequested && rememberedLogin?.password) {
    delete rememberedLogin.password;
    try {
        localStorage.setItem(loginStorageKey, JSON.stringify(rememberedLogin));
    } catch {
        localStorage.removeItem(loginStorageKey);
    }
}

if (jellyfinServers[connectionMode][rememberedLogin?.server]) serverSelect.value = rememberedLogin.server;
if (rememberedLogin?.username) {
    usernameInput.value = rememberedLogin.username;
    defaultUsername = rememberedLogin.username;
}
if (!manualLoginRequested && rememberedLogin?.password) {
    passwordInput.value = rememberedLogin.password;
    rememberLoginInput.checked = true;
}

// Jellyfin tracks sessions and transcodes per device, so each browser needs its own ID.
function getDeviceId() {
    const storageKey = 'jellyfinDeviceId';
    let deviceId = localStorage.getItem(storageKey);
    if (!deviceId) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        deviceId = `JellyfinViewer-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
        localStorage.setItem(storageKey, deviceId);
    }
    return deviceId;
}

function getDeviceName() {
    const userAgent = navigator.userAgent;
    if (/Android/i.test(userAgent)) return 'Android Browser';
    if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS Browser';
    if (/Windows/i.test(userAgent)) return 'Windows Browser';
    if (/Macintosh/i.test(userAgent)) return 'Mac Browser';
    if (/Linux/i.test(userAgent)) return 'Linux Browser';
    return 'Browser';
}

function readRememberedLogin() {
    try {
        return JSON.parse(localStorage.getItem(loginStorageKey) || 'null');
    } catch {
        return null;
    }
}

function persistLoginPreferences(savePassword = rememberLoginInput.checked) {
    const storedLogin = {
        mode: connectionMode,
        server: serverSelect.value,
        username: usernameInput.value.trim()
    };
    if (savePassword && passwordInput.value) storedLogin.password = passwordInput.value;
    try {
        localStorage.setItem(loginStorageKey, JSON.stringify(storedLogin));
        rememberedLogin = storedLogin;
    } catch {
        statusMessage.textContent = 'Could not save login details in this browser.';
        statusMessage.classList.add('error');
    }
}

function updateServerSelection(mode = connectionMode) {
    connectionMode = mode;
    localModeButton.setAttribute('aria-pressed', String(mode === 'local'));
    remoteModeButton.setAttribute('aria-pressed', String(mode === 'remote'));
    serverAddressPreview.textContent = jellyfinServers[mode][serverSelect.value];
    const nextDefaultUsername = mode === 'local' && serverSelect.value === 'porn' ? 'kenny' : 'admin';
    if (usernameInput.value === defaultUsername) usernameInput.value = nextDefaultUsername;
    defaultUsername = nextDefaultUsername;
    persistLoginPreferences();
}

serverSelect.addEventListener('change', () => updateServerSelection());
localModeButton.addEventListener('click', () => updateServerSelection('local'));
remoteModeButton.addEventListener('click', () => updateServerSelection('remote'));
usernameInput.addEventListener('change', () => persistLoginPreferences());
rememberLoginInput.addEventListener('change', () => {
    if (!rememberLoginInput.checked) persistLoginPreferences(false);
    else persistLoginPreferences(true);
});
updateServerSelection();

authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await connect(false);
});

async function connect(isAutomatic) {
    const jellyfinUrl = jellyfinServers[connectionMode][serverSelect.value].replace(/\/+$/, '');
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const submitButton = authForm.querySelector('button[type="submit"]');

    submitButton.disabled = true;
    statusMessage.textContent = isAutomatic ? 'Signing in...' : 'Connecting to Jellyfin...';
    statusMessage.classList.remove('error');
    try {
        const session = await authenticateUser(jellyfinUrl, username, password);
        persistLoginPreferences(rememberLoginInput.checked);
        sessionStorage.setItem('jellyfinConnection', JSON.stringify({
            server: jellyfinUrl,
            username,
            userId: session.User.Id,
            accessToken: session.AccessToken,
            deviceId: getDeviceId(),
            deviceName: getDeviceName()
        }));
        window.location.href = 'library.html';
    } catch (error) {
        if (isAutomatic) {
            passwordInput.value = '';
            persistLoginPreferences(false);
            rememberLoginInput.checked = false;
            statusMessage.textContent = 'Saved sign-in failed. Check your credentials and connect again.';
        } else {
            statusMessage.textContent = error.message;
        }
        statusMessage.classList.add('error');
        submitButton.disabled = false;
    }
}

if (!manualLoginRequested && rememberedLogin?.password && rememberedLogin?.username && jellyfinServers[connectionMode][serverSelect.value]) {
    connect(true);
}

async function authenticateUser(server, username, password) {
    let response;
    try {
        response = await fetch(`${server}/Users/AuthenticateByName`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `MediaBrowser Client="Jellyfin Viewer", Device="${getDeviceName()}", DeviceId="${getDeviceId()}", Version="1.0.0"`
            },
            body: JSON.stringify({ Username: username, Pw: password })
        });
    } catch {
        throw new Error('Could not reach the server. Check the address and browser network access.');
    }

    if (!response.ok) {
        throw new Error(`Jellyfin sign-in failed (HTTP ${response.status}). Check your username and password.`);
    }

    const result = await response.json();
    if (!result.User?.Id || !result.AccessToken) {
        throw new Error('Jellyfin signed in but did not return a user session.');
    }
    return result;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
