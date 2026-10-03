const authForm = document.getElementById('auth-form');
const statusMessage = document.getElementById('connection-status');
const serverSelect = document.getElementById('jellyfin-server');
const serverAddressPreview = document.getElementById('server-address-preview');
const localModeButton = document.getElementById('local-mode');
const remoteModeButton = document.getElementById('remote-mode');
const usernameInput = document.getElementById('username');
let connectionMode = 'local';
let defaultUsername = 'kenny';

const jellyfinServers = {
    local: {
        film: 'http://192.168.1.155:8096/',
        porn: 'http://192.168.1.155:6961/'
    },
    remote: {
        film: 'https://film.1zero.org',
        porn: 'https://xxx.1zero.org'
    }
};

function updateServerSelection(mode = connectionMode) {
    connectionMode = mode;
    localModeButton.setAttribute('aria-pressed', String(mode === 'local'));
    remoteModeButton.setAttribute('aria-pressed', String(mode === 'remote'));
    serverAddressPreview.textContent = jellyfinServers[mode][serverSelect.value];
    const nextDefaultUsername = mode === 'local' && serverSelect.value === 'porn' ? 'kenny' : 'admin';
    if (usernameInput.value === defaultUsername) usernameInput.value = nextDefaultUsername;
    defaultUsername = nextDefaultUsername;
}

serverSelect.addEventListener('change', () => updateServerSelection());
localModeButton.addEventListener('click', () => updateServerSelection('local'));
remoteModeButton.addEventListener('click', () => updateServerSelection('remote'));
updateServerSelection();

authForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const jellyfinUrl = jellyfinServers[connectionMode][serverSelect.value].replace(/\/+$/, '');
    const username = usernameInput.value.trim();
    const password = document.getElementById('password').value;
    const submitButton = authForm.querySelector('button[type="submit"]');

    submitButton.disabled = true;
    statusMessage.textContent = 'Connecting to Jellyfin...';
    statusMessage.classList.remove('error');
    try {
        const session = await authenticateUser(jellyfinUrl, username, password);
        sessionStorage.setItem('jellyfinConnection', JSON.stringify({
            server: jellyfinUrl,
            username,
            userId: session.User.Id,
            accessToken: session.AccessToken
        }));
        window.location.href = 'library.html';
    } catch (error) {
        statusMessage.textContent = error.message;
        statusMessage.classList.add('error');
        submitButton.disabled = false;
    }
});

async function authenticateUser(server, username, password) {
    let response;
    try {
        response = await fetch(`${server}/Users/AuthenticateByName`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'MediaBrowser Client="Jellyfin Viewer", Device="Browser", DeviceId="JellyfinViewer", Version="1.0.0"'
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
