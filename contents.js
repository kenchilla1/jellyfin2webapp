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
let castContext = null;
let playbackToolbarTimeout = null;
let playbackMetadataRequestId = 0;
let currentMediaSource = null;
let selectedAudioStreamIndex = null;
let subtitleStreams = [];
let hlsPlayback = null;
let hlsRecoveryAttempted = false;
let currentPlaySessionId = null;
let isSeeking = false;
let authenticationExpired = false;

window.__onGCastApiAvailable = (isAvailable) => {
    if (!isAvailable || !window.cast?.framework) return;
    const castFramework = window.cast.framework;
    castContext = castFramework.CastContext.getInstance();
    castContext.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
    });
    document.getElementById('cast-launcher').hidden = false;
    castContext.addEventListener(castFramework.CastContextEventType.SESSION_STATE_CHANGED, (event) => {
        if ([castFramework.SessionState.SESSION_STARTED, castFramework.SessionState.SESSION_RESUMED].includes(event.sessionState)) {
            castCurrentMedia();
        }
    });
};

if (!connection || (!parentId && !favoritesPage && !watchId)) {
    window.location.replace(connection ? 'library.html' : 'index.html?manual=1');
} else {
    document.getElementById('contents-title').textContent = pageTitle;
    renderBreadcrumbs();
    document.getElementById('back-button').addEventListener('click', () => goBack('library.html'));
    document.getElementById('bottom-back-button').addEventListener('click', () => goBack('library.html'));
    document.getElementById('close-player').addEventListener('click', closePlayer);
    const player = document.getElementById('media-player');
    const playerStage = document.getElementById('player-stage');
    const playbackControls = document.getElementById('playback-controls');
    const playbackToolbar = document.getElementById('playback-toolbar');
    const playbackToggle = document.getElementById('playback-toggle');
    const toolbarPlaybackToggle = document.getElementById('toolbar-playback-toggle');
    const playbackSeekbar = document.getElementById('playback-seekbar');
    const audioStreamSelect = document.getElementById('audio-stream-select');
    const subtitleStreamSelect = document.getElementById('subtitle-stream-select');
    setupTrackMenu(audioStreamSelect, document.getElementById('audio-track-button'), document.getElementById('audio-track-menu'));
    setupTrackMenu(subtitleStreamSelect, document.getElementById('subtitle-track-button'), document.getElementById('subtitle-track-menu'));
    player.addEventListener('timeupdate', updatePlaybackTimeline);
    player.addEventListener('durationchange', updatePlaybackTimeline);
    playbackSeekbar.addEventListener('input', () => {
        isSeeking = true;
        const duration = getPlaybackDuration();
        if (duration > 0) {
            const target = duration * Number(playbackSeekbar.value) / Number(playbackSeekbar.max);
            document.getElementById('playback-current-time').textContent = formatPlaybackTime(target);
        }
    });
    playbackSeekbar.addEventListener('change', () => {
        isSeeking = false;
        const duration = getPlaybackDuration();
        if (duration > 0) player.currentTime = duration * Number(playbackSeekbar.value) / Number(playbackSeekbar.max);
    });
    audioStreamSelect.addEventListener('change', () => changeAudioStream(audioStreamSelect.value));
    subtitleStreamSelect.addEventListener('change', updateSubtitleTrack);
    playerStage.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'mouse') showPlaybackToolbar();
    });
    playerStage.addEventListener('click', (event) => {
        if (event.target === player || event.target === playerStage) toggleTapControls();
    });
    playbackControls.addEventListener('click', (event) => {
        if (event.target === playbackControls) toggleTapControls();
        else event.stopPropagation();
    });
    playbackControls.addEventListener('pointerdown', (event) => event.stopPropagation());
    playbackToolbar.addEventListener('click', (event) => event.stopPropagation());
    playbackToolbar.addEventListener('pointerdown', (event) => event.stopPropagation());
    playbackToggle.addEventListener('click', togglePlayback);
    toolbarPlaybackToggle.addEventListener('click', togglePlayback);
    player.addEventListener('playing', () => { hlsRecoveryAttempted = false; });
    document.querySelectorAll('#playback-controls [data-seek], #playback-toolbar [data-seek]').forEach((button) => {
        button.addEventListener('click', () => seekPlayer(Number(button.dataset.seek)));
    });
    player.addEventListener('play', () => {
        playbackToggle.textContent = 'Ⅱ';
        playbackToggle.setAttribute('aria-label', 'Pause');
        playbackToggle.title = 'Pause';
        toolbarPlaybackToggle.textContent = 'Ⅱ';
        toolbarPlaybackToggle.setAttribute('aria-label', 'Pause');
        toolbarPlaybackToggle.title = 'Pause';
        playerStage.classList.remove('tap-controls-visible');
    });
    player.addEventListener('pause', () => {
        playbackToggle.textContent = '▶';
        playbackToggle.setAttribute('aria-label', 'Play');
        playbackToggle.title = 'Play';
        toolbarPlaybackToggle.textContent = '▶';
        toolbarPlaybackToggle.setAttribute('aria-label', 'Play');
        toolbarPlaybackToggle.title = 'Play';
        if (!document.getElementById('player-section').hidden && !playerStage.classList.contains('toolbar-visible')) {
            playerStage.classList.add('tap-controls-visible');
        }
    });
    document.getElementById('fullscreen-like-button').addEventListener('click', (event) => {
        event.stopPropagation();
        if (currentMedia) toggleFavorite(currentMedia, event.currentTarget);
    });
    document.getElementById('delete-media-button').addEventListener('click', (event) => {
        event.stopPropagation();
        deleteCurrentMedia();
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

function handleAuthenticationExpired() {
    if (authenticationExpired) return;
    authenticationExpired = true;
    sessionStorage.removeItem('jellyfinConnection');
    window.location.replace('index.html?manual=1');
}

async function jellyfinGet(path) {
    const response = await fetch(`${connection.server}${path}`, {
        headers: { Authorization: authorizationHeader() }
    });
    if (!response.ok) {
        if (response.status === 401) handleAuthenticationExpired();
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
        statusMessage.textContent = '';
        playMedia(film);
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

async function deleteCurrentMedia() {
    const media = currentMedia;
    if (!media || !window.confirm(`Permanently delete "${media.Name}" from the server?`)) return;

    const button = document.getElementById('delete-media-button');
    button.disabled = true;
    statusMessage.classList.remove('error');
    statusMessage.textContent = `Deleting ${media.Name}...`;
    try {
        const response = await fetch(`${connection.server}/Items/${encodeURIComponent(media.Id)}`, {
            method: 'DELETE',
            headers: { Authorization: authorizationHeader() }
        });
        if (!response.ok) {
            const responseDetail = (await response.text()).trim();
            const detail = responseDetail ? `: ${responseDetail.slice(0, 240)}` : '';
            throw new Error(`Could not delete this film (HTTP ${response.status})${detail}`);
        }

        closePlayer();
        if (!watchId) {
            await loadContents(true);
            if (!statusMessage.classList.contains('error')) statusMessage.textContent = `${media.Name} was deleted.`;
        } else {
            statusMessage.textContent = `${media.Name} was deleted.`;
        }
    } catch (error) {
        statusMessage.textContent = error.message;
        statusMessage.classList.add('error');
    } finally {
        button.disabled = false;
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

function browserPlaybackUrl(media, audioStreamIndex = null, mediaSourceId = null) {
    const canCopyVideo = canCopyVideoForBrowser();
    const query = new URLSearchParams({
        DeviceId: 'JellyfinViewer',
        PlaySessionId: currentPlaySessionId || String(Date.now()),
        AudioCodec: 'aac',
        AudioChannels: '2',
        MaxAudioChannels: '2',
        SegmentContainer: 'mp4',
        AllowVideoStreamCopy: String(canCopyVideo),
        AllowAudioStreamCopy: 'true',
        api_key: connection.accessToken
    });
    if (!canCopyVideo) {
        const videoBitRate = getBrowserVideoBitRate();
        query.set('VideoBitRate', String(videoBitRate));
        query.set('MaxStreamingBitrate', String(videoBitRate + 1000000));
        query.set('VideoCodec', 'h264');
        query.set('MaxVideoBitDepth', '8');
        query.set('RequireAvc', 'true');
    }
    if (audioStreamIndex !== null) query.set('AudioStreamIndex', String(audioStreamIndex));
    if (mediaSourceId) query.set('MediaSourceId', mediaSourceId);
    return `${connection.server}/Videos/${encodeURIComponent(media.Id)}/master.m3u8?${query}`;
}

function canCopyVideoForBrowser() {
    const videoStream = currentMediaSource?.MediaStreams?.find((stream) => stream.Type === 'Video');
    const codec = String(videoStream?.Codec || '').toLowerCase();
    return ['h264', 'avc', 'avc1'].includes(codec) && Number(videoStream?.BitDepth || 8) <= 8;
}

function getBrowserVideoBitRate() {
    const videoStream = currentMediaSource?.MediaStreams?.find((stream) => stream.Type === 'Video');
    const width = Number(videoStream?.Width || 1920);
    const height = Number(videoStream?.Height || 1080);
    return Math.min(40000000, Math.max(6000000, Math.round(width * height * 6)));
}

function loadBrowserPlayback(media, startPosition = 0, shouldResume = true) {
    const player = document.getElementById('media-player');
    const streamUrl = browserPlaybackUrl(media, selectedAudioStreamIndex, currentMediaSource?.Id || null);
    if (hlsPlayback) {
        hlsPlayback.destroy();
        hlsPlayback = null;
    }
    player.removeAttribute('src');
    player.load();

    if (window.Hls?.isSupported()) {
        const hls = new window.Hls({
            startPosition,
            maxBufferLength: 30,
            backBufferLength: 90,
            enableWorker: true,
            xhrSetup(xhr) {
                xhr.setRequestHeader('Authorization', authorizationHeader());
            }
        });
        hlsPlayback = hls;
        hls.on(window.Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            if (Number(data.response?.code) === 401) {
                handleAuthenticationExpired();
                return;
            }
            console.error('Jellyfin HLS playback failed:', data.details);
            if (!hlsRecoveryAttempted && data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
                hlsRecoveryAttempted = true;
                hls.recoverMediaError();
                return;
            }
            if (!hlsRecoveryAttempted && data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
                hlsRecoveryAttempted = true;
                hls.startLoad(Math.max(0, player.currentTime || startPosition));
                return;
            }
            hls.destroy();
            if (hlsPlayback === hls) hlsPlayback = null;
            if (currentMedia?.Id === media.Id) {
                statusMessage.textContent = `Playback stopped: ${data.details || 'the stream could not recover'}.`;
                statusMessage.classList.add('error');
                loadProgressivePlayback(media, player.currentTime || startPosition, shouldResume);
            }
        });
        if (shouldResume) hls.on(window.Hls.Events.MANIFEST_PARSED, () => player.play().catch(() => {}));
        hls.loadSource(streamUrl);
        hls.attachMedia(player);
        return;
    }

    if (player.canPlayType('application/vnd.apple.mpegurl')) {
        player.src = streamUrl;
        player.load();
        if (startPosition > 0) {
            player.addEventListener('loadedmetadata', () => {
                player.currentTime = startPosition;
            }, { once: true });
        }
        if (shouldResume) player.play().catch(() => {});
        return;
    }

    loadProgressivePlayback(media, startPosition, shouldResume);
}

function loadProgressivePlayback(media, startPosition = 0, shouldResume = true) {
    const player = document.getElementById('media-player');
    const canCopyVideo = canCopyVideoForBrowser();
    const query = new URLSearchParams({
        DeviceId: 'JellyfinViewer',
        PlaySessionId: currentPlaySessionId || String(Date.now()),
        AudioCodec: 'aac',
        AudioChannels: '2',
        MaxAudioChannels: '2',
        AllowVideoStreamCopy: String(canCopyVideo),
        AllowAudioStreamCopy: 'true',
        api_key: connection.accessToken
    });
    if (!canCopyVideo) {
        const videoBitRate = getBrowserVideoBitRate();
        query.set('VideoBitRate', String(videoBitRate));
        query.set('MaxStreamingBitrate', String(videoBitRate + 1000000));
        query.set('VideoCodec', 'h264');
        query.set('MaxVideoBitDepth', '8');
        query.set('RequireAvc', 'true');
    }
    if (selectedAudioStreamIndex !== null) query.set('AudioStreamIndex', String(selectedAudioStreamIndex));
    if (currentMediaSource?.Id) query.set('MediaSourceId', currentMediaSource.Id);
    if (startPosition > 0) query.set('StartTimeTicks', String(Math.floor(startPosition * 10000000)));
    player.src = `${connection.server}/Videos/${encodeURIComponent(media.Id)}/stream?${query}`;
    player.load();
    if (shouldResume) player.play().catch(() => {});
}

async function loadPlaybackTracks(media) {
    const requestId = ++playbackMetadataRequestId;
    const audioSelect = document.getElementById('audio-stream-select');
    const subtitleSelect = document.getElementById('subtitle-stream-select');
    audioSelect.replaceChildren(new Option('Loading...', ''));
    subtitleSelect.replaceChildren(new Option('Loading...', ''));
    audioSelect.disabled = true;
    subtitleSelect.disabled = true;

    try {
        const query = new URLSearchParams({ UserId: connection.userId });
        const playbackInfo = await jellyfinGet(`/Items/${encodeURIComponent(media.Id)}/PlaybackInfo?${query}`);
        if (requestId !== playbackMetadataRequestId || currentMedia?.Id !== media.Id) return null;

        currentMediaSource = playbackInfo.MediaSources?.find((source) => source.Type === 'Default') || playbackInfo.MediaSources?.[0] || null;
        const streams = currentMediaSource?.MediaStreams || [];
        const audioStreams = streams.filter((stream) => stream.Type === 'Audio');
        subtitleStreams = streams.filter((stream) => stream.Type === 'Subtitle');

        audioSelect.replaceChildren(new Option('Server default', ''));
        audioStreams.forEach((stream) => audioSelect.add(new Option(mediaStreamLabel(stream), String(stream.Index))));
        audioSelect.disabled = audioStreams.length === 0;
        audioSelect.dispatchEvent(new Event('change'));

        subtitleSelect.replaceChildren(new Option('Off', ''));
        subtitleStreams.forEach((stream) => subtitleSelect.add(new Option(mediaStreamLabel(stream), String(stream.Index))));
        subtitleSelect.disabled = subtitleStreams.length === 0;
        subtitleSelect.dispatchEvent(new Event('change'));
        return currentMediaSource;
    } catch {
        if (requestId !== playbackMetadataRequestId || currentMedia?.Id !== media.Id) return null;
        audioSelect.replaceChildren(new Option('Unavailable', ''));
        subtitleSelect.replaceChildren(new Option('Unavailable', ''));
        audioSelect.disabled = true;
        subtitleSelect.disabled = true;
        audioSelect.dispatchEvent(new Event('change'));
        subtitleSelect.dispatchEvent(new Event('change'));
        return null;
    }
}

function mediaStreamLabel(stream) {
    const details = stream.DisplayTitle || [
        stream.Language,
        stream.Title,
        stream.Codec?.toUpperCase(),
        stream.Channels ? `${stream.Channels} ch` : ''
    ].filter(Boolean).join(' - ');
    const flags = [stream.IsDefault ? 'Default' : '', stream.IsForced ? 'Forced' : ''].filter(Boolean);
    const label = details || `Track ${stream.Index + 1}`;
    return flags.length ? `${label} (${flags.join(', ')})` : label;
}

function setupTrackMenu(select, trigger, menu) {
    const refreshMenu = () => {
        menu.replaceChildren();
        [...select.options].forEach((option) => {
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = 'toolbar-track-option';
            choice.setAttribute('role', 'option');
            choice.setAttribute('aria-selected', String(option.value === select.value));
            choice.textContent = option.textContent;
            choice.addEventListener('click', () => {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                closeTrackMenu(trigger, menu);
                refreshMenu();
            });
            menu.appendChild(choice);
        });
        trigger.disabled = select.disabled;
    };

    trigger.addEventListener('click', () => {
        const shouldOpen = menu.hidden;
        document.querySelectorAll('.toolbar-track-popup').forEach((popup) => { popup.hidden = true; });
        document.querySelectorAll('.toolbar-track-trigger').forEach((button) => button.setAttribute('aria-expanded', 'false'));
        if (shouldOpen) {
            refreshMenu();
            menu.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
        }
    });
    select.addEventListener('change', refreshMenu);
    document.addEventListener('click', (event) => {
        if (!menu.contains(event.target) && event.target !== trigger) closeTrackMenu(trigger, menu);
    });
    trigger.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeTrackMenu(trigger, menu);
    });
    refreshMenu();
}

function closeTrackMenu(trigger, menu) {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
}

function changeAudioStream(value) {
    const media = currentMedia;
    if (!media) return;
    const audioStreamIndex = value === '' ? null : Number(value);
    if (audioStreamIndex === selectedAudioStreamIndex) return;

    const player = document.getElementById('media-player');
    const wasPlaying = !player.paused;
    const currentTime = player.currentTime || 0;
    selectedAudioStreamIndex = audioStreamIndex;
    currentPlaySessionId = String(Date.now());
    loadBrowserPlayback(media, currentTime, wasPlaying);
}

function updateSubtitleTrack() {
    const player = document.getElementById('media-player');
    player.querySelectorAll('track[data-player-subtitle]').forEach((track) => track.remove());
    const stream = subtitleStreams.find((candidate) => String(candidate.Index) === document.getElementById('subtitle-stream-select').value);
    if (!stream || !currentMedia || !currentMediaSource?.Id) return;

    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = mediaStreamLabel(stream);
    track.srclang = stream.Language || 'und';
    track.dataset.playerSubtitle = 'true';
    track.src = `${connection.server}/Videos/${encodeURIComponent(currentMedia.Id)}/${encodeURIComponent(currentMediaSource.Id)}/Subtitles/${encodeURIComponent(stream.Index)}/Stream.vtt?api_key=${encodeURIComponent(connection.accessToken)}`;
    player.appendChild(track);
    track.track.mode = 'showing';
}

async function castCurrentMedia() {
    const session = castContext?.getCurrentSession();
    if (!session || !currentMedia) return;

    const player = document.getElementById('media-player');
    const mediaInfo = new chrome.cast.media.MediaInfo(mediaUrl(currentMedia), 'video/mp4');
    mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;
    const metadata = new chrome.cast.media.GenericMediaMetadata();
    metadata.title = currentMedia.Name;
    mediaInfo.metadata = metadata;
    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;
    request.currentTime = player.currentTime || 0;

    try {
        await session.loadMedia(request);
        player.pause();
    } catch {
        statusMessage.textContent = 'Could not cast this film. Check that the TV can reach the selected Jellyfin server.';
        statusMessage.classList.add('error');
    }
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
    clearTimeout(playbackToolbarTimeout);
    if (hlsPlayback) {
        hlsPlayback.destroy();
        hlsPlayback = null;
    }
    player.pause();
    player.removeAttribute('src');
    player.load();
    isSeeking = false;
    document.getElementById('playback-seekbar').blur();
    document.getElementById('player-stage').classList.remove('tap-controls-visible', 'toolbar-visible');
    currentMediaId = media.Id;
    currentMedia = media;
    currentPlaySessionId = String(Date.now());
    hlsRecoveryAttempted = false;
    document.getElementById('playback-seekbar').value = '0';
    document.getElementById('playback-current-time').textContent = '0:00';
    document.getElementById('playback-duration').textContent = formatPlaybackTime(Number(media.RunTimeTicks || 0) / 10000000);
    const fullscreenLikeButton = document.getElementById('fullscreen-like-button');
    updateLikeButton(fullscreenLikeButton, media);
    fullscreenLikeButton.hidden = false;
    currentMediaSource = null;
    selectedAudioStreamIndex = null;
    subtitleStreams = [];
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
    if (castContext?.getCurrentSession()) {
        castCurrentMedia();
        return;
    }
    loadPlaybackTracks(media).then((mediaSource) => {
        if (authenticationExpired || currentMedia?.Id !== media.Id) return;
        if (mediaSource?.Id) {
            loadBrowserPlayback(media);
        } else {
            loadProgressivePlayback(media);
        }
    });
}

function closePlayer() {
    const player = document.getElementById('media-player');
    const playerSection = document.getElementById('player-section');
    if (document.fullscreenElement === playerSection) document.exitFullscreen().catch(() => {});
    clearTimeout(playbackToolbarTimeout);
    playbackMetadataRequestId += 1;
    currentMediaSource = null;
    selectedAudioStreamIndex = null;
    subtitleStreams = [];
    player.querySelectorAll('track[data-player-subtitle]').forEach((track) => track.remove());
    document.getElementById('player-stage').classList.remove('tap-controls-visible', 'toolbar-visible');
    playerSection.classList.remove('player-open');
    if (hlsPlayback) {
        hlsPlayback.destroy();
        hlsPlayback = null;
    }
    player.pause();
    player.removeAttribute('src');
    player.load();
    playerSection.hidden = true;
    currentMediaId = null;
    currentMedia = null;
    currentPlaySessionId = null;
    document.getElementById('fullscreen-like-button').hidden = true;
}

function showPlaybackToolbar() {
    const playerStage = document.getElementById('player-stage');
    playerStage.classList.remove('tap-controls-visible');
    playerStage.classList.add('toolbar-visible');
    clearTimeout(playbackToolbarTimeout);
    playbackToolbarTimeout = setTimeout(() => playerStage.classList.remove('toolbar-visible'), 5000);
}

function toggleTapControls() {
    const playerStage = document.getElementById('player-stage');
    clearTimeout(playbackToolbarTimeout);
    playerStage.classList.remove('toolbar-visible');
    playerStage.classList.toggle('tap-controls-visible');
}

function togglePlayback() {
    const player = document.getElementById('media-player');
    if (player.paused) player.play().catch(() => {});
    else player.pause();
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
    const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.ctrlKey || event.altKey ? 60 : 15);
    seekPlayer(delta);
}

function seekPlayer(delta) {
    const player = document.getElementById('media-player');
    const duration = getPlaybackDuration();
    player.currentTime = Math.max(0, Math.min(duration > 0 ? duration - 0.25 : Infinity, (player.currentTime || 0) + delta));
}

function getPlaybackDuration() {
    const player = document.getElementById('media-player');
    if (Number.isFinite(player.duration)) return player.duration;
    return Number(currentMedia?.RunTimeTicks || 0) / 10000000;
}

function updatePlaybackTimeline() {
    const player = document.getElementById('media-player');
    const seekbar = document.getElementById('playback-seekbar');
    const duration = getPlaybackDuration();
    const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
    if (!isSeeking) {
        seekbar.value = String(duration > 0 ? Math.round(currentTime / duration * Number(seekbar.max)) : 0);
        document.getElementById('playback-current-time').textContent = formatPlaybackTime(currentTime);
    }
    document.getElementById('playback-duration').textContent = formatPlaybackTime(duration);
}

function formatPlaybackTime(seconds) {
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const remainingSeconds = totalSeconds % 60;
    return hours
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
        : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function goBack(fallback) {
    if (window.history.length > 1) window.history.back();
    else window.location.href = fallback;
}