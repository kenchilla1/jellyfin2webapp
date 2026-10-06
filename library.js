const connection = JSON.parse(sessionStorage.getItem('jellyfinConnection') || 'null');
const statusMessage = document.getElementById('library-status');
const libraryList = document.getElementById('library-list');
const searchInput = document.getElementById('library-search');
const searchSection = document.getElementById('film-search-section');
const searchStatus = document.getElementById('film-search-status');
const searchResults = document.getElementById('film-search-results');
const progressStorageKey = `jellyfin-filtered-libraries:${connection?.server || 'server'}:${connection?.userId || 'user'}`;
const progressVisibilityStorageKey = `${progressStorageKey}:visible:v3`;
let searchTimer;
let searchRequestId = 0;

searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = searchInput.value.trim();
    const requestId = ++searchRequestId;
    if (query.length < 2) {
        searchSection.hidden = true;
        libraryList.hidden = false;
        searchResults.replaceChildren();
        return;
    }
    searchSection.hidden = false;
    libraryList.hidden = true;
    searchStatus.textContent = 'Searching films...';
    searchResults.replaceChildren();
    searchTimer = setTimeout(() => searchFilms(query, requestId), 250);
});

if (!connection) {
    window.location.replace('index.html?manual=1');
} else {
    document.getElementById('back-button').addEventListener('click', () => goBack('index.html?manual=1'));
    const visibilityButton = document.getElementById('toggle-progress-visibility');
    const marksVisible = localStorage.getItem(progressVisibilityStorageKey) === 'true';
    setProgressMarksVisible(marksVisible, visibilityButton);
    visibilityButton.addEventListener('click', () => {
        const visible = libraryList.classList.contains('progress-marks-hidden');
        setProgressMarksVisible(visible, visibilityButton);
        localStorage.setItem(progressVisibilityStorageKey, String(visible));
    });
    loadLibraries();
}

function setProgressMarksVisible(visible, button) {
    libraryList.classList.toggle('progress-marks-hidden', !visible);
    button.setAttribute('aria-pressed', String(visible));
    button.textContent = visible ? 'Hide check marks' : 'Show check marks';
}

async function jellyfinGet(path) {
    const response = await fetch(`${connection.server}${path}`, {
        headers: { 'Authorization': authorizationHeader() }
    });
    if (!response.ok) {
        throw new Error(`Jellyfin request failed (HTTP ${response.status}).`);
    }
    return response.json();
}

function authorizationHeader() {
    return `MediaBrowser Client="Jellyfin Viewer", Device="Browser", DeviceId="JellyfinViewer", Version="1.0.0", Token="${connection.accessToken}"`;
}

async function loadLibraries() {
    statusMessage.textContent = 'Loading libraries...';
    try {
        const result = await jellyfinGet(`/Users/${encodeURIComponent(connection.userId)}/Views`);
        const librariesNeedingArtwork = result.Items.filter((library) => !library.ImageTags?.Primary);
        if (librariesNeedingArtwork.length) {
            statusMessage.textContent = 'Loading library artwork...';
            await loadLibraryArtwork(librariesNeedingArtwork);
        }
        const favorites = await loadFavoritesPreview();
        libraryList.replaceChildren();
        libraryList.appendChild(createFavoritesCard(favorites[0]));
        result.Items.forEach((library) => {
            libraryList.appendChild(createLibraryCard(library));
        });
        statusMessage.textContent = result.Items.length ? '' : 'No libraries are available for this user.';
    } catch (error) {
        statusMessage.textContent = error.message;
        statusMessage.classList.add('error');
    }
}

async function loadFavoritesPreview() {
    const query = new URLSearchParams({
        IsFavorite: 'true',
        Recursive: 'true',
        IncludeItemTypes: 'Movie,Episode,MusicVideo',
        SortBy: 'DateCreated',
        SortOrder: 'Descending',
        Limit: '1'
    });
    try {
        const result = await jellyfinGet(`/Users/${encodeURIComponent(connection.userId)}/Items?${query}`);
        return result.Items;
    } catch {
        return [];
    }
}

async function loadLibraryArtwork(libraries) {
    let nextIndex = 0;
    const workerCount = Math.min(6, libraries.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < libraries.length) {
            const library = libraries[nextIndex++];
            const query = new URLSearchParams({
                ParentId: library.Id,
                Recursive: 'true',
                IncludeItemTypes: 'Movie,Episode',
                SortBy: 'DateCreated',
                SortOrder: 'Descending',
                Limit: '1'
            });
            try {
                const result = await jellyfinGet(`/Users/${encodeURIComponent(connection.userId)}/Items?${query}`);
                library.coverItem = result.Items[0];
            } catch {
                library.coverItem = null;
            }
        }
    });
    await Promise.all(workers);
}

function createLibraryCard(library) {
    const params = new URLSearchParams({
        parentId: library.Id,
        title: library.Name,
        libraryId: library.Id,
        libraryName: library.Name
    });
    const artwork = library.ImageTags?.Primary ? { Id: library.Id } : library.coverItem;
    const className = library.ImageTags?.Primary ? 'server-artwork' : '';
    const card = createArtworkCard(library.Name, artwork, className, () => {
        window.location.href = `contents.html?${params}`;
    });
    addLibraryProgressCheckbox(card, library);
    return card;
}

function addLibraryProgressCheckbox(card, library) {
    const label = document.createElement('label');
    label.className = 'library-progress-checkbox';
    label.title = `Mark ${library.Name} as filtered through`;
    label.addEventListener('click', (event) => event.stopPropagation());

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = getFilteredLibraryIds().includes(library.Id);
    checkbox.setAttribute('aria-label', `Mark ${library.Name} as filtered through`);
    checkbox.addEventListener('change', () => {
        const filteredIds = new Set(getFilteredLibraryIds());
        if (checkbox.checked) filteredIds.add(library.Id);
        else filteredIds.delete(library.Id);
        localStorage.setItem(progressStorageKey, JSON.stringify([...filteredIds]));
        card.classList.toggle('library-filtered-through', checkbox.checked);
    });

    label.appendChild(checkbox);
    card.appendChild(label);
    card.classList.toggle('library-filtered-through', checkbox.checked);
}

function getFilteredLibraryIds() {
    try {
        const storedIds = JSON.parse(localStorage.getItem(progressStorageKey) || '[]');
        return Array.isArray(storedIds) ? storedIds : [];
    } catch {
        return [];
    }
}

function createFavoritesCard(coverItem) {
    const card = createArtworkCard('Favorites', coverItem, 'favorites-button', () => {
        window.location.href = 'contents.html?favorites=true&title=Favorites';
    });
    const button = card.querySelector('.library-button');
    const mark = document.createElement('span');
    mark.className = 'favorites-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '♥';
    button.prepend(mark);
    return card;
}

function createArtworkCard(titleText, coverItem, className, onClick) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `library-button ${className}`.trim();
    button.setAttribute('aria-label', titleText);
    if (coverItem) {
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.src = `${connection.server}/Items/${encodeURIComponent(coverItem.Id)}/Images/Primary?api_key=${encodeURIComponent(connection.accessToken)}&maxWidth=640`;
        image.addEventListener('error', () => image.remove(), { once: true });
        button.appendChild(image);
    }
    const title = document.createElement('span');
    title.textContent = titleText;
    button.appendChild(title);
    button.addEventListener('click', onClick);
    item.appendChild(button);
    return item;
}

async function searchFilms(query, requestId) {
    const search = new URLSearchParams({
        SearchTerm: query,
        IncludeItemTypes: 'Movie',
        Recursive: 'true',
        Limit: '50',
        Fields: 'Overview,RunTimeTicks,ParentId'
    });
    try {
        const result = await jellyfinGet(`/Users/${encodeURIComponent(connection.userId)}/Items?${search}`);
        if (requestId !== searchRequestId || query !== searchInput.value.trim()) return;
        searchResults.replaceChildren(...result.Items.map(createFilmResult));
        searchStatus.textContent = result.Items.length
            ? `${result.TotalRecordCount} ${result.TotalRecordCount === 1 ? 'film' : 'films'} found`
            : 'No films found.';
    } catch (error) {
        if (requestId !== searchRequestId) return;
        searchStatus.textContent = error.message;
    }
}

function createFilmResult(film) {
    const item = document.createElement('li');
    item.className = 'media-card';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-button';
    button.setAttribute('aria-label', `Open ${film.Name}`);
    const poster = document.createElement('img');
    poster.alt = '';
    poster.loading = 'lazy';
    poster.src = `${connection.server}/Items/${encodeURIComponent(film.Id)}/Images/Primary?api_key=${encodeURIComponent(connection.accessToken)}&maxWidth=420`;
    poster.addEventListener('error', () => poster.remove(), { once: true });
    const title = document.createElement('span');
    title.textContent = film.Name;
    button.append(poster, title);
    button.addEventListener('click', () => {
        const params = new URLSearchParams({ watchId: film.Id, title: film.Name });
        window.location.href = `contents.html?${params}`;
    });
    item.appendChild(button);
    return item;
}

function goBack(fallback) {
    if (window.history.length > 1) window.history.back();
    else window.location.href = fallback;
}

