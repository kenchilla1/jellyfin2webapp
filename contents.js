const connection = JSON.parse(sessionStorage.getItem('jellyfinConnection') || 'null');
const params = new URLSearchParams(window.location.search);
const parentId = params.get('parentId');
const watchId = params.get('watchId');
const favoritesPage = params.get('favorites') === 'true';
const favoritesLibraryId = params.get('favoritesLibraryId');
const pageTitle = params.get('title') || 'Contents';
const libraryId = params.get('libraryId') || parentId;
const libraryName = params.get('libraryName') || pageTitle;
const statusMessage = document.getElementById('contents-status');
const contentsList = document.getElementById('contents-list');
const moreButton = document.getElementById('load-more');
const sortControls = document.getElementById('contents-sort-controls');
const sortBySelect = document.getElementById('contents-sort-by');
const sortOrderButton = document.getElementById('contents-sort-order');
const pageSize = 100;
let startIndex = 0;
let totalItems = Infinity;
let loading = false;
let activePreview = null;
let playableItems = [];
let currentMediaId = null;
let currentMedia = null;

if (!connection || (!parentId && !favoritesPage && !watchId)) {
    window.location.replace(connection ? 'library.html' : 'index.html');
} else {
    document.getElementById('contents-title').textContent = pageTitle;
    renderBreadcrumbs();
    document.getElementById('back-button').addEventListener('click', () => goBack('library.html'));
    document.getElementById('bottom-back-button').addEventListener('click', () => goBack('library.html'));
    document.getElementById('close-player').addEventListener('click', closePlayer);
    document.getElementById('fullscreen-like-button').addEventListener('click', (event) => {
        event.stopPropagation();
        if (currentMedia) toggleFavorite(currentMedia, event.currentTarget);
    });
    setSortOrder('Ascending');
    moreButton.addEventListener('click', () => loadContents(false));
    sortBySelect.addEventListener('change', () => loadContents(true));
    sortOrderButton.addEventListener('click', () => {
        const ascending = sortOrderButton.dataset.order !== 'Ascending';
        setSortOrder(ascending ? 'Ascending' : 'Descending');
        loadContents(true);
    });
    document.addEventListener('keydown', handlePlayerKeydown);
    document.addEventListener('fullscreenchange', () => {
        const playerSection = document.getElementById('player-section');
        if (!playerSection.hidden && !document.fullscreenElement && !playerSection.classList.contains('player-open')) {
            closePlayer();
        }
    });
    if (watchId) {
        sortControls.hidden = true;
        loadWatchItem();
    }
    else {
        loadContents(true);
        if (!favoritesPage && parentId === libraryId) loadLibraryFileCount();
    }
}

function setSortOrder(order) {
    sortOrderButton.dataset.order = order;
    sortOrderButton.textContent = order;
    sortOrderButton.setAttribute('aria-label', `Sort ${order.toLowerCase()}`);
    sortOrderButton.title = `Sort ${order.toLowerCase()}`;
}

function authorizationHeader() {
    return `MediaBrowser Client="Jellyfin Viewer", Device="Browser", DeviceId="JellyfinViewer", Version="1.0.0", Token="${connection.accessToken}"`;
}

async function jellyfinGet(path) {
    const response = await fetch(`${connection.server}${path}`, {
        headers: { Authorization: authorizationHeader() }
    });
    if (!response.ok) {
        throw new Error(`Jellyfin request failed (HTTP ${response.status}).`);
    }
    return response.json();
}

function renderBreadcrumbs() {
    const breadcrumbs = document.getElementById('breadcrumbs');
    const librariesLink = document.createElement('a');
    librariesLink.href = 'library.html';
    librariesLink.textContent = 'Libraries';
    breadcrumbs.appendChild(librariesLink);

    if (watchId) {
        const searchLink = document.createElement('a');
        searchLink.href = 'library.html';
        searchLink.textContent = 'Search';
        const current = document.createElement('span');
        current.textContent = pageTitle;
        breadcrumbs.append(' / ', searchLink, ' / ', current);
        return;
    }

    if (favoritesPage) {
        if (favoritesLibraryId) {
            const libraryParams = new URLSearchParams({
                parentId: favoritesLibraryId,
                title: libraryName,
                libraryId: favoritesLibraryId,
                libraryName
            });
            const libraryLink = document.createElement('a');
            libraryLink.href = `contents.html?${libraryParams}`;
            libraryLink.textContent = libraryName;
            const current = document.createElement('span');
            current.textContent = 'Favorites';
            breadcrumbs.append(' / ', libraryLink, ' / ', current);
            return;
        }
        const current = document.createElement('span');
        current.textContent = 'Favorites';
        breadcrumbs.append(' / ', current);
        return;
    }

    const libraryParams = new URLSearchParams({
        parentId: libraryId,
        title: libraryName,
        libraryId,
        libraryName
    });
    const libraryLink = document.createElement('a');
    libraryLink.href = `contents.html?${libraryParams}`;
    libraryLink.textContent = libraryName;
    breadcrumbs.append(' / ', libraryLink);
    if (parentId !== libraryId) {
        const current = document.createElement('span');
        current.textContent = pageTitle;
        breadcrumbs.append(' / ', current);
    }
}

async function loadLibraryFileCount() {
    const countElement = document.getElementById('library-file-count');
    const query = new URLSearchParams({
        ParentId: libraryId,
        Recursive: 'true',
        IsFolder: 'false',
        IncludeItemTypes: 'Movie,Episode,MusicVideo,Video',
        Limit: '1'
    });
    try {
        const result = await jellyfinGet(`/Users/${encodeURIComponent(connection.userId)}/Items?${query}`);
        const count = Number(result.TotalRecordCount || 0);
        countElement.textContent = `${count.toLocaleString()} ${count === 1 ? 'file' : 'files'}`;
        countElement.hidden = false;
    } catch {
        countElement.hidden = true;
    }
}

async function loadWatchItem() {
    moreButton.hidden = true;
    statusMessage.textContent = 'Loading film...';
    try {
        const query = new URLSearchParams({ Ids: watchId, Fields: 'Overview,RunTimeTicks,ParentId' });
        const result = await jellyfinGet(`/Users/${encodeURIComponent(connection.userId)}/Items?${query}`);
        const film = result.Items[0];
        if (!film) throw new Error('This film could not be found.');
        document.getElementById('contents-title').textContent = film.Name;
        contentsList.replaceChildren(createMediaCard(film));
        statusMessage.textContent = film.Overview || '';
    } catch (error) {
        statusMessage.textContent = error.message;
        statusMessage.classList.add('error');
    }
}

async function loadContents(reset) {
    if (loading) return;
    loading = true;
    moreButton.disabled = true;
    statusMessage.classList.remove('error');
    statusMessage.textContent = reset ? 'Loading contents...' : 'Loading more...';
    if (reset) {
        startIndex = 0;
        totalItems = Infinity;
        playableItems = [];
        contentsList.replaceChildren();
    }

    const query = new URLSearchParams({
        SortBy: sortBySelect.value,
        SortOrder: sortOrderButton.dataset.order || 'Ascending',
        StartIndex: String(startIndex),
        Limit: String(pageSize),
        Fields: 'Overview,RunTimeTicks'
    });
    if (favoritesPage) {
        query.set('IsFavorite', 'true');
        query.set('Recursive', 'true');
        query.set('IncludeItemTypes', 'Movie,Episode,MusicVideo');
        if (favoritesLibraryId) query.set('ParentId', favoritesLibraryId);
    } else {
        query.set('ParentId', parentId);
    }

    try {
        const result = await jellyfinGet(`/Users/${encodeURIComponent(connection.userId)}/Items?${query}`);
        if (reset && !favoritesPage && !watchId && parentId === libraryId) {
            const favoritesCount = await loadLibraryFavoritesCount();
            contentsList.appendChild(createLibraryFavoritesCard(favoritesCount));
        }
        result.Items.forEach((media) => contentsList.appendChild(createMediaCard(media)));
        startIndex += result.Items.length;
        totalItems = Number(result.TotalRecordCount ?? startIndex);
        statusMessage.textContent = startIndex ? '' : 'This folder is empty.';
        moreButton.hidden = startIndex >= totalItems || result.Items.length === 0;
    } catch (error) {
        statusMessage.textContent = error.message;
        statusMessage.classList.add('error');
        moreButton.hidden = startIndex === 0;
    } finally {
        loading = false;
        moreButton.disabled = false;
    }
}

async function loadLibraryFavoritesCount() {
    const query = new URLSearchParams({
        ParentId: libraryId,
        IsFavorite: 'true',
        Recursive: 'true',
        IncludeItemTypes: 'Movie,Episode,MusicVideo',
        Limit: '1'
    });
    try {
        const result = await jellyfinGet(`/Users/${encodeURIComponent(connection.userId)}/Items?${query}`);
        return Number(result.TotalRecordCount || 0);
    } catch {
        return 0;
    }
}

function createLibraryFavoritesCard(count) {
    const item = document.createElement('li');
    item.className = 'media-card';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-button folder-button library-favorites-card';
    button.setAttribute('aria-label', `Open ${libraryName} favorites`);
    const poster = document.createElement('img');
    poster.alt = '';
    poster.loading = 'lazy';
    poster.src = `${connection.server}/Items/${encodeURIComponent(libraryId)}/Images/Primary?api_key=${encodeURIComponent(connection.accessToken)}&maxWidth=420`;
    poster.addEventListener('error', () => poster.remove(), { once: true });
    const title = document.createElement('span');
    title.textContent = count ? `Favorites (${count})` : 'Favorites';
    const heart = document.createElement('span');
    heart.className = 'library-favorites-mark';
    heart.setAttribute('aria-hidden', 'true');
    heart.textContent = '♥';
    button.append(poster, title, heart);
    button.addEventListener('click', () => {
        const favoritesParams = new URLSearchParams({
            parentId: libraryId,
            title: 'Favorites',
            libraryId,
            libraryName,
            favorites: 'true',
            favoritesLibraryId: libraryId
        });
        window.location.href = `contents.html?${favoritesParams}`;
    });
    item.appendChild(button);
    return item;
}

function createMediaCard(media) {
    const item = document.createElement('li');
    item.className = 'media-card';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-button';
    button.title = media.IsFolder ? `Open ${media.Name}` : `Play ${media.Name}`;

    const poster = document.createElement('img');
    poster.alt = '';
    poster.loading = 'lazy';
    poster.src = `${connection.server}/Items/${encodeURIComponent(media.Id)}/Images/Primary?api_key=${encodeURIComponent(connection.accessToken)}&maxWidth=420`;
    poster.addEventListener('error', () => poster.remove(), { once: true });

    const title = document.createElement('span');
    title.textContent = media.Name;
    button.append(poster, title);
    const isFolder = media.IsFolder || media.Type === 'Folder';
    const isVideo = media.MediaType === 'Video' && !isFolder;
    if (isFolder) {
        button.classList.add('folder-button');
        button.addEventListener('click', () => openFolder(media));
    } else {
        button.addEventListener('click', () => playMedia(media));
        if (isVideo && !playableItems.some((item) => item.Id === media.Id)) {
            playableItems.push(media);
        }
        if (media.Type === 'Movie' && Number(media.RunTimeTicks) > 0) {
            button.addEventListener('pointerenter', () => showPreview(media, button));
            button.addEventListener('pointerleave', () => closePreview(media.Id));
            button.addEventListener('focus', () => showPreview(media, button));
            button.addEventListener('blur', () => closePreview(media.Id));
        }
    }
    item.appendChild(button);
    item.dataset.mediaId = media.Id;
    if (isVideo) {
        item.appendChild(createArtworkEditor(media, poster));
        item.appendChild(createLikeButton(media));
    }
    return item;
}

function createArtworkEditor(media, poster) {
    const controls = document.createElement('div');
    controls.className = 'media-artwork-control';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'change-media-artwork-button';
    button.title = `Change ${media.Name} image`;
    button.setAttribute('aria-label', `Change ${media.Name} image`);
    button.innerHTML = '<span class="picture-icon" aria-hidden="true"></span>';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    input.setAttribute('aria-label', `Choose a new image for ${media.Name}`);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        input.click();
    });
    input.addEventListener('change', () => uploadMediaArtwork(media, poster, input, button));
    controls.append(button, input);
    return controls;
}

async function uploadMediaArtwork(media, poster, input, button) {
    const image = input.files?.[0];
    if (!image) return;
    if (!image.type.startsWith('image/')) {
        statusMessage.textContent = 'Choose a supported image file.';
        statusMessage.classList.add('error');
        input.value = '';
        return;
    }

    button.disabled = true;
    statusMessage.classList.remove('error');
    statusMessage.textContent = `Updating ${media.Name} artwork...`;
    try {
        const uploadImage = await normalizeArtworkImage(image);
        const encodedImage = await encodeImageBase64(uploadImage);
        const response = await fetch(`${connection.server}/Items/${encodeURIComponent(media.Id)}/Images/Primary`, {
            method: 'POST',
            headers: {
                Authorization: authorizationHeader(),
                'Content-Type': 'image/jpeg'
            },
            body: encodedImage
        });
        if (!response.ok) {
            const responseDetail = (await response.text()).trim();
            const detail = responseDetail ? `: ${responseDetail.slice(0, 240)}` : '';
            throw new Error(`Jellyfin could not update this image (HTTP ${response.status})${detail}`);
        }
        poster.src = `${connection.server}/Items/${encodeURIComponent(media.Id)}/Images/Primary?api_key=${encodeURIComponent(connection.accessToken)}&maxWidth=420&updated=${Date.now()}`;
        media.ImageTags = media.ImageTags || {};
        media.ImageTags.Primary = 'updated';
        statusMessage.textContent = `${media.Name} artwork updated.`;
    } catch (error) {
        statusMessage.textContent = error.message;
        statusMessage.classList.add('error');
    } finally {
        button.disabled = false;
        input.value = '';
    }
}

async function normalizeArtworkImage(image) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(image);
    } catch {
        throw new Error('This image format could not be read by the browser. Try a PNG or JPEG image.');
    }

    try {
        const maxDimension = 2400;
        const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('The browser could not prepare this image.');
        context.fillStyle = '#111720';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((result) => result ? resolve(result) : reject(new Error('The browser could not encode this image.')), 'image/jpeg', 0.88);
        });
        return blob;
    } finally {
        bitmap.close();
    }
}

function encodeImageBase64(image) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => {
            const dataUrl = String(reader.result);
            const separator = dataUrl.indexOf(',');
            if (separator < 0) {
                reject(new Error('The browser could not encode this image.'));
                return;
            }
            resolve(dataUrl.slice(separator + 1));
        }, { once: true });
        reader.addEventListener('error', () => reject(new Error('The browser could not encode this image.')), { once: true });
        reader.readAsDataURL(image);
    });
}

function createLikeButton(media) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'like-button';
    button.dataset.mediaId = media.Id;
    updateLikeButton(button, media);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(media, button);
    });
    return button;
}

async function toggleFavorite(media, button) {
    const wasFavorite = Boolean(media.UserData?.IsFavorite);
    const relatedButtons = [...document.querySelectorAll('.like-button')]
        .filter((candidate) => candidate.dataset.mediaId === media.Id);
    relatedButtons.forEach((candidate) => { candidate.disabled = true; });
    try {
        const response = await fetch(`${connection.server}/Users/${encodeURIComponent(connection.userId)}/FavoriteItems/${encodeURIComponent(media.Id)}`, {
            method: wasFavorite ? 'DELETE' : 'POST',
            headers: { Authorization: authorizationHeader() }
        });
        if (!response.ok) throw new Error(`Could not update favorite (HTTP ${response.status}).`);
        media.UserData = media.UserData || {};
        media.UserData.IsFavorite = !wasFavorite;
        relatedButtons.forEach((candidate) => updateLikeButton(candidate, media));
        statusMessage.textContent = '';
    } catch (error) {
        statusMessage.textContent = error.message;
        statusMessage.classList.add('error');
    } finally {
        relatedButtons.forEach((candidate) => { candidate.disabled = false; });
    }
}

function updateLikeButton(button, media) {
    const isFavorite = Boolean(media.UserData?.IsFavorite);
    const label = isFavorite ? `Unlike ${media.Name}` : `Like ${media.Name}`;
    button.dataset.mediaId = media.Id;
    button.setAttribute('aria-pressed', String(isFavorite));
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = isFavorite ? '♥' : '♡';
}

function openFolder(folder) {
    const nextParams = new URLSearchParams({
        parentId: folder.Id,
        title: folder.Name,
        libraryId,
        libraryName
    });
    window.location.href = `contents.html?${nextParams}`;
}

function mediaUrl(media) {
    return `${connection.server}/Videos/${encodeURIComponent(media.Id)}/stream?static=true&api_key=${encodeURIComponent(connection.accessToken)}`;
}

function showPreview(media, card) {
    closePreview();
    const overlay = document.createElement('div');
    overlay.className = 'hover-preview';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.preload = 'auto';
    video.src = mediaUrl(media);
    overlay.appendChild(video);
    document.body.appendChild(overlay);

    const cardBounds = card.getBoundingClientRect();
    const width = Math.min(cardBounds.width * 3, window.innerWidth - 32);
    const height = width * 9 / 16 + 16;
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, cardBounds.left + cardBounds.width / 2 - width / 2));
    const top = Math.max(16, Math.min(window.innerHeight - height - 16, cardBounds.top + cardBounds.height / 2 - height / 2));
    overlay.style.width = `${width}px`;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    activePreview = { id: media.Id, overlay, video };

    video.addEventListener('loadedmetadata', () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0) return;
        const startPlayback = () => {
            if (activePreview?.video === video) video.play().catch(() => {});
        };
        video.addEventListener('seeked', startPlayback, { once: true });
        video.currentTime = video.duration / 2;
        startPlayback();
    }, { once: true });
    video.addEventListener('error', () => closePreview(media.Id), { once: true });
}

function closePreview(mediaId) {
    if (!activePreview || (mediaId && activePreview.id !== mediaId)) return;
    activePreview.video.pause();
    activePreview.video.removeAttribute('src');
    activePreview.video.load();
    activePreview.overlay.remove();
    activePreview = null;
}

function playMedia(media) {
    closePreview();
    const player = document.getElementById('media-player');
    const playerSection = document.getElementById('player-section');
    const wasFullscreen = document.fullscreenElement === playerSection || playerSection.classList.contains('player-open');
    currentMediaId = media.Id;
    currentMedia = media;
    const fullscreenLikeButton = document.getElementById('fullscreen-like-button');
    updateLikeButton(fullscreenLikeButton, media);
    fullscreenLikeButton.hidden = false;
    player.src = mediaUrl(media);
    document.getElementById('player-title').textContent = media.Name;
    playerSection.hidden = false;
    if (!wasFullscreen) playerSection.classList.remove('player-open');
    if (!wasFullscreen && typeof playerSection.requestFullscreen === 'function') {
        try {
            playerSection.requestFullscreen().catch(() => playerSection.classList.add('player-open'));
        } catch {
            playerSection.classList.add('player-open');
        }
    } else if (!wasFullscreen) {
        playerSection.classList.add('player-open');
    }
    player.play().catch(() => {});
}

function closePlayer() {
    const player = document.getElementById('media-player');
    const playerSection = document.getElementById('player-section');
    if (document.fullscreenElement === playerSection) document.exitFullscreen().catch(() => {});
    playerSection.classList.remove('player-open');
    player.pause();
    player.removeAttribute('src');
    player.load();
    playerSection.hidden = true;
    currentMediaId = null;
    currentMedia = null;
    document.getElementById('fullscreen-like-button').hidden = true;
}

function handlePlayerKeydown(event) {
    const player = document.getElementById('media-player');
    const playerSection = document.getElementById('player-section');
    const isFullscreen = document.fullscreenElement === playerSection || playerSection.classList.contains('player-open');
    const isFilmNavigationKey = event.code === 'Numpad0' || event.code === 'Numpad2';
    const isFavoriteKey = event.code === 'Numpad1';
    if (playerSection.hidden || !isFullscreen || (!isFilmNavigationKey && !isFavoriteKey && !['ArrowLeft', 'ArrowRight'].includes(event.key))) return;
    event.preventDefault();
    if (isFavoriteKey) {
        document.getElementById('fullscreen-like-button').click();
        return;
    }
    if (isFilmNavigationKey) {
        const currentIndex = playableItems.findIndex((media) => media.Id === currentMediaId);
        const direction = event.code === 'Numpad0' ? 1 : -1;
        const nextMedia = playableItems[currentIndex + direction];
        if (nextMedia) playMedia(nextMedia);
        return;
    }
    const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.ctrlKey ? 60 : 15);
    const end = Number.isFinite(player.duration) ? player.duration : Infinity;
    player.currentTime = Math.max(0, Math.min(end, player.currentTime + delta));
}

function goBack(fallback) {
    if (window.history.length > 1) window.history.back();
    else window.location.href = fallback;
}