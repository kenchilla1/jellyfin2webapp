const authForm = document.getElementById('auth-form');
const statusMessage = document.getElementById('connection-status');
document.getElementById('jellyfin-server').value = window.location.origin;

authForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const jellyfinUrl = document.getElementById('jellyfin-server').value.trim().replace(/\/+$/, '');
    const username = document.getElementById('username').value.trim();
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
