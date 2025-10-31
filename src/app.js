import { auth, provider, db } from './firebase.js';
import { APP_VERSION } from './version.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import {
    doc,
    getDoc,
    setDoc,
    collection,
    addDoc,
    onSnapshot,
    updateDoc,
    deleteDoc,
    writeBatch,
    deleteField
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

const loginBtn = document.getElementById('login');
const heroLoginBtn = document.querySelector('[data-action="login"]');
const logoutBtn = document.getElementById('logout');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const userEmail = document.getElementById('user-email');
const loginHero = document.getElementById('login-hero');
const wishlistSection = document.getElementById('wishlist-section');

const itemForm = document.getElementById('item-form');
const itemInput = document.getElementById('item-input');
const itemUrl = document.getElementById('item-url');
const itemNote = document.getElementById('item-note');
const itemPriority = document.getElementById('item-priority');
const itemPrice = document.getElementById('item-price');
const itemTag = document.getElementById('item-tag');
const addItemBtn = document.getElementById('add-item');

const filterSearch = document.getElementById('filter-search');
const filterTag = document.getElementById('filter-tag');
const filterPurchased = document.getElementById('filter-purchased');
const sortSelect = document.getElementById('sort-select');

const manualHint = document.getElementById('manual-hint');
const loadingState = document.getElementById('loading-state');
const emptyState = document.getElementById('empty-state');
const itemsList = document.getElementById('items');
const appVersion = document.getElementById('app-version');

const metadataCache = new Map();

const filters = {
    search: '',
    tag: 'all',
    purchased: 'all',
    sort: 'manual'
};

let currentUser = null;
let wishlistItems = [];
let unsubscribeWishlist = null;
let initialSnapshotPending = false;
let draggedElement = null;
const metadataUpdateQueue = new Map();
const METADATA_TTL = 6 * 60 * 60 * 1000; // 6 часов
// Метаданные берем через Microlink (https://microlink.io) с поддержкой CORS.
const METADATA_ENDPOINT = 'https://api.microlink.io/';
// Запасной вариант — AllOrigins с HTML для разбора метатегов.
const HTML_PROXY_ENDPOINT = 'https://api.allorigins.win/raw?url=';
const CURRENCY_SYMBOL_MAP = {
    '₽': 'RUB',
    '₴': 'UAH',
    '₸': 'KZT',
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY'
};
const BLOCKED_METADATA_PATTERNS = [
    /antibot/i,
    /challenge page/i,
    /access denied/i,
    /just a moment/i,
    /verification required/i,
    /forbidden/i
];
const OZON_DOMAIN_PATTERN = /(?:^|\.)ozon\.ru/i;

function setRuntimeMetadata(url, metadata) {
    if (!url) return;
    metadataCache.set(url, metadata);
}

function getRuntimeMetadata(url) {
    if (!url) return null;
    return metadataCache.get(url) || null;
}

function clearRuntimeMetadata(url) {
    if (!url) return;
    metadataCache.delete(url);
}

function buildPersistentMetadata(metadata, markAttempt = true) {
    const timestamp = metadata?.metadataFetchedAt || (markAttempt ? new Date().toISOString() : '');
    return {
        remoteTitle: metadata?.remoteTitle || '',
        remoteDescription: metadata?.remoteDescription || '',
        remotePrice: typeof metadata?.remotePrice === 'number' && Number.isFinite(metadata.remotePrice) ? Number(metadata.remotePrice) : null,
        remoteCurrency: metadata?.remoteCurrency || '',
        metadataFetchedAt: timestamp
    };
}

function createEmptyPersistentMetadata(markAttempt = false) {
    return buildPersistentMetadata(null, markAttempt);
}

function createEmptyRuntimeMetadata(markAttempt = false, extras = {}) {
    return {
        imageUrl: '',
        remoteTitle: '',
        remoteDescription: '',
        remotePrice: null,
        remoteCurrency: '',
        metadataFetchedAt: markAttempt ? new Date().toISOString() : '',
        loading: false,
        ...extras
    };
}

if (appVersion) {
    appVersion.textContent = `Версия: ${APP_VERSION}`;
}

loginBtn?.addEventListener('click', () => handleLogin());
heroLoginBtn?.addEventListener('click', () => handleLogin());

logoutBtn?.addEventListener('click', async () => {
    setButtonBusy(logoutBtn, true, 'Выходим...');
    try {
        await signOut(auth);
    } catch (err) {
        console.error('Ошибка выхода', err);
        alert('Не удалось выйти: ' + err.message);
    } finally {
        setButtonBusy(logoutBtn, false);
    }
});

itemForm?.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    await handleAddItem();
});

filterSearch?.addEventListener('input', () => {
    filters.search = filterSearch.value.trim().toLowerCase();
    renderCurrentView();
});

filterTag?.addEventListener('change', () => {
    filters.tag = filterTag.value;
    renderCurrentView();
});

filterPurchased?.addEventListener('change', () => {
    filters.purchased = filterPurchased.value;
    renderCurrentView();
});

sortSelect?.addEventListener('change', () => {
    filters.sort = sortSelect.value;
    renderCurrentView();
});

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        setAuthVisibility({ isLoggedIn: true });
        await ensureUserDocument(user);
        subscribeToWishlist(user.uid);
    } else {
        cleanupAfterLogout();
    }
});

async function handleLogin() {
    setButtonBusy(loginBtn, true, 'Открываем окно...');
    if (heroLoginBtn) {
        setButtonBusy(heroLoginBtn, true, 'Открываем окно...');
    }
    try {
        await signInWithPopup(auth, provider);
    } catch (err) {
        console.error('Ошибка входа', err);
        alert('Не удалось войти: ' + err.message);
    } finally {
        setButtonBusy(loginBtn, false);
        if (heroLoginBtn) {
            setButtonBusy(heroLoginBtn, false);
        }
    }
}

async function ensureUserDocument(user) {
    try {
        const userDocRef = doc(db, 'users', user.uid);
        const snapshot = await getDoc(userDocRef);
        if (!snapshot.exists()) {
            await setDoc(userDocRef, {
                name: user.displayName || '',
                email: user.email || '',
                createdAt: new Date().toISOString()
            });
        }
    } catch (err) {
        console.error('Не удалось подготовить профиль пользователя', err);
        alert('Не удалось подготовить данные пользователя: ' + err.message);
    }
}

function subscribeToWishlist(uid) {
    unsubscribeWishlist?.();
    const colRef = collection(db, 'users', uid, 'wishlist');
    initialSnapshotPending = true;
    setLoadingState(true);

    unsubscribeWishlist = onSnapshot(
        colRef,
        (snapshot) => {
            const items = snapshot.docs.map((docSnap, index) => normalizeWishlistItem(docSnap.id, docSnap.data(), index));
            wishlistItems = items.slice().sort(sortByManualOrder);
            scheduleMetadataEnrichment(uid, wishlistItems);
            ensureSequentialOrder(uid, wishlistItems).catch((err) => {
                console.error('Не удалось синхронизировать порядок карточек', err);
            });
            updateTagFilterOptions(wishlistItems);
            renderCurrentView();
        },
        (err) => {
                initialSnapshotPending = false;
            console.error('Ошибка получения списка желаний', err);
            alert('Не удалось загрузить список: ' + err.message);
            setLoadingState(false);
        }
    );
}

function normalizeWishlistItem(id, data = {}, fallbackIndex = 0) {
    const safeNumber = (value, defaultValue) => (typeof value === 'number' && Number.isFinite(value) ? value : defaultValue);
    const safeString = (value) => (typeof value === 'string' ? value : '');
    return {
        id,
        text: safeString(data.text) || 'Без названия',
        url: safeString(data.url),
        note: safeString(data.note),
        priority: safeNumber(data.priority, 3),
        price: typeof data.price === 'number' && Number.isFinite(data.price) ? data.price : null,
        tag: safeString(data.tag),
        order: safeNumber(data.order, fallbackIndex + 1),
        purchased: Boolean(data.purchased),
        createdAt: safeString(data.createdAt) || new Date().toISOString(),
        imageUrl: safeString(data.imageUrl),
        remoteTitle: safeString(data.remoteTitle),
        remoteDescription: safeString(data.remoteDescription),
        remotePrice: typeof data.remotePrice === 'number' && Number.isFinite(data.remotePrice) ? data.remotePrice : null,
        remoteCurrency: safeString(data.remoteCurrency),
        metadataFetchedAt: safeString(data.metadataFetchedAt)
    };
}

async function ensureSequentialOrder(uid, items) {
    if (!uid || !items.length) return;
    const sorted = items.slice().sort(sortByManualOrder);
    let needsUpdate = false;
    sorted.forEach((item, index) => {
        if (item.order !== index + 1) {
            needsUpdate = true;
        }
    });
    if (!needsUpdate) return;

    try {
        const batch = writeBatch(db);
        sorted.forEach((item, index) => {
            const ref = doc(db, 'users', uid, 'wishlist', item.id);
            batch.update(ref, { order: index + 1 });
            item.order = index + 1;
        });
        await batch.commit();
    } catch (err) {
        console.error('Не удалось обновить порядок элементов', err);
    }
}

function scheduleMetadataEnrichment(uid, items) {
    if (!uid || !items.length) return;
    const now = Date.now();
    items.forEach((item) => {
        if (!item.url) return;
        const runtimeMetadata = getRuntimeMetadata(item.url);
        const runtimeTimestamp = runtimeMetadata?.metadataFetchedAt ? Date.parse(runtimeMetadata.metadataFetchedAt) : NaN;
        const runtimeFresh = Number.isFinite(runtimeTimestamp) && now - runtimeTimestamp <= METADATA_TTL;
        const lastFetched = item.metadataFetchedAt ? Date.parse(item.metadataFetchedAt) : NaN;
        const docFresh = Number.isFinite(lastFetched) && now - lastFetched <= METADATA_TTL;
        const needsMetadata = !runtimeFresh || !docFresh || !item.metadataFetchedAt;
        if (!needsMetadata) return;
        if (metadataUpdateQueue.has(item.id)) return;
        if (!runtimeMetadata?.imageUrl) {
            setRuntimeMetadata(item.url, createEmptyRuntimeMetadata(false, { loading: true }));
            renderCurrentView();
        }
        metadataUpdateQueue.set(item.id, true);
        fetchAndNormalizeMetadata(item.url)
            .then(async (metadata) => {
                if (!metadata) return;
                setRuntimeMetadata(item.url, metadata);
                renderCurrentView();
                if (!currentUser || currentUser.uid !== uid) return;
                const docRef = doc(db, 'users', uid, 'wishlist', item.id);
                const persistent = buildPersistentMetadata(metadata);
                await updateDoc(docRef, { ...persistent, imageUrl: deleteField() });
            })
            .catch((err) => {
                console.error('Не удалось обновить метаданные элемента', err);
            })
            .finally(() => {
                metadataUpdateQueue.delete(item.id);
            });
    });
}

async function handleAddItem() {
    if (!currentUser) {
        alert('Сначала войдите в аккаунт.');
        return;
    }

    let payload;
    try {
        payload = buildItemPayload({
            text: itemInput.value,
            url: itemUrl.value,
            note: itemNote.value,
            priority: itemPriority.value,
            price: itemPrice.value,
            tag: itemTag.value
        });
    } catch (validationError) {
        alert(validationError.message);
        return;
    }

    let fetchedMetadata = null;
    if (payload.url) {
        setButtonBusy(addItemBtn, true, 'Получаем данные...');
        try {
            fetchedMetadata = await fetchAndNormalizeMetadata(payload.url);
            if (fetchedMetadata) {
                setRuntimeMetadata(payload.url, fetchedMetadata);
            }
        } catch (err) {
            console.error('Не удалось получить дополнительные данные о товаре', err);
        } finally {
            setButtonBusy(addItemBtn, false);
        }
    }

    const newItem = {
        ...payload,
        ...(fetchedMetadata ? buildPersistentMetadata(fetchedMetadata) : createEmptyPersistentMetadata()),
        createdAt: new Date().toISOString(),
        order: getNextOrder(),
        purchased: false
    };

    const colRef = collection(db, 'users', currentUser.uid, 'wishlist');
    setButtonBusy(addItemBtn, true, 'Добавляем...');
    try {
        await addDoc(colRef, newItem);
        itemForm.reset();
        itemPriority.value = '3';
    } catch (err) {
        console.error('Не удалось добавить желание', err);
        alert('Не удалось добавить желание: ' + err.message);
    } finally {
        setButtonBusy(addItemBtn, false);
    }
}

function buildItemPayload({ text = '', url = '', note = '', priority = '3', price = '', tag = '' }) {
    const trimmedText = text.trim();
    if (!trimmedText) {
        throw new Error('Опишите, что вы хотите получить.');
    }

    const cleanUrl = url.trim();
    if (cleanUrl && !isValidUrl(cleanUrl)) {
        throw new Error('Пожалуйста, укажите корректную ссылку, начинающуюся с http или https.');
    }

    const normalizedPriority = Number(priority);
    if (!Number.isFinite(normalizedPriority) || normalizedPriority < 1 || normalizedPriority > 5) {
        throw new Error('Приоритет должен быть числом от 1 до 5.');
    }

    const priceString = String(price).trim();
    let normalizedPrice = null;
    if (priceString) {
        const prepared = Number(priceString.replace(',', '.'));
        if (!Number.isFinite(prepared) || prepared < 0) {
            throw new Error('Цена должна быть неотрицательным числом.');
        }
        normalizedPrice = Number(prepared.toFixed(2));
    }

    return {
        text: trimmedText,
        url: cleanUrl,
        note: note.trim(),
        priority: normalizedPriority,
        price: normalizedPrice,
        tag: tag.trim()
    };
}

function getNextOrder() {
    if (!wishlistItems.length) return 1;
    const maxOrder = Math.max(...wishlistItems.map((item) => (typeof item.order === 'number' ? item.order : 0)));
    return maxOrder + 1;
}

function renderCurrentView() {
    if (initialSnapshotPending) {
        initialSnapshotPending = false;
        setLoadingState(false);
    } else if (!loadingState.hidden) {
        setLoadingState(false);
    }
    const prepared = applyFiltersAndSort(wishlistItems.slice());
    loadWishlist(prepared);
}

function applyFiltersAndSort(items) {
    let result = items;

    if (filters.search) {
        result = result.filter((item) => {
            const haystack = `${item.text}\u0000${item.note}\u0000${item.remoteTitle || ''}\u0000${item.remoteDescription || ''}`.toLowerCase();
            return haystack.includes(filters.search.toLowerCase());
        });
    }

    if (filters.tag !== 'all') {
        result = result.filter((item) => item.tag === filters.tag);
    }

    if (filters.purchased === 'active') {
        result = result.filter((item) => !item.purchased);
    } else if (filters.purchased === 'done') {
        result = result.filter((item) => item.purchased);
    }

    switch (filters.sort) {
        case 'manual':
            result.sort(sortByManualOrder);
            break;
        case 'createdDesc':
            result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            break;
        case 'priorityDesc':
            result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
            break;
        case 'priceAsc':
            result.sort((a, b) => normalizePriceSort(a.price, Number.POSITIVE_INFINITY) - normalizePriceSort(b.price, Number.POSITIVE_INFINITY));
            break;
        case 'priceDesc':
            result.sort((a, b) => normalizePriceSort(b.price, Number.NEGATIVE_INFINITY) - normalizePriceSort(a.price, Number.NEGATIVE_INFINITY));
            break;
        default:
            break;
    }

    return result;
}

function loadWishlist(items) {
    setLoadingState(false);
    itemsList.innerHTML = '';
    const isManual = filters.sort === 'manual';
    manualHint.hidden = !isManual || items.length <= 1;
    itemsList.classList.toggle('drag-enabled', isManual && items.length > 1);
    itemsList.classList.toggle('drag-disabled', !isManual || items.length <= 1);

    if (!items.length) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    items.forEach((item) => {
        const element = createWishlistItemElement(item, isManual);
        itemsList.appendChild(element);
    });
}

function createWishlistItemElement(item, allowDrag) {
    const li = document.createElement('li');
    li.className = 'wish-card';
    if (item.purchased) {
        li.classList.add('wish-card--done');
    }
    li.dataset.id = item.id;
    li.dataset.order = String(item.order ?? 0);

    if (allowDrag) {
        li.draggable = true;
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragend', handleDragEnd);
    }

    const content = document.createElement('div');
    content.className = 'wish-card__content';

    const header = document.createElement('div');
    header.className = 'wish-card__header';

    const title = document.createElement('h3');
    title.className = 'wish-card__title';
    title.textContent = item.text;
    header.appendChild(title);

    const badgeContainer = document.createElement('div');
    badgeContainer.className = 'wish-card__badges';

    if (item.tag) {
        const tagBadge = document.createElement('span');
        tagBadge.className = 'badge';
        tagBadge.textContent = item.tag;
        badgeContainer.appendChild(tagBadge);
    }

    const priorityBadge = document.createElement('span');
    priorityBadge.className = `badge ${item.priority >= 4 ? 'badge--priority-high' : ''}`.trim();
    priorityBadge.textContent = `Приоритет ${item.priority}/5`;
    badgeContainer.appendChild(priorityBadge);

    if (item.purchased) {
        const purchasedBadge = document.createElement('span');
        purchasedBadge.className = 'badge badge--purchased';
        purchasedBadge.textContent = 'Уже куплено';
        badgeContainer.appendChild(purchasedBadge);
    }

    header.appendChild(badgeContainer);
    content.appendChild(header);

    const runtimeMetadata = getRuntimeMetadata(item.url);
    const imageSource = runtimeMetadata?.imageUrl || item.imageUrl;
    const isImageLoading = Boolean(runtimeMetadata?.loading) && !imageSource;
    const persistedBlocked = containsBlockedMarker(item.remoteTitle) || containsBlockedMarker(item.remoteDescription);
    const blockedReason = runtimeMetadata?.blockedReason;
    const metadataBlocked = Boolean(runtimeMetadata?.blocked) || persistedBlocked;
    if (imageSource) {
        const media = document.createElement('figure');
        media.className = 'wish-card__media';
        const image = document.createElement('img');
        image.className = 'wish-card__image';
        image.src = imageSource;
        image.alt = runtimeMetadata?.remoteTitle || item.remoteTitle || item.text;
        image.loading = 'lazy';
        media.appendChild(image);
        content.appendChild(media);
    } else if (isImageLoading) {
        const skeleton = document.createElement('div');
        skeleton.className = 'wish-card__media wish-card__media--skeleton';
        const shimmer = document.createElement('div');
        shimmer.className = 'wish-card__media-placeholder';
        skeleton.appendChild(shimmer);
        content.appendChild(skeleton);
    }

    const resolvedRemoteTitle = [runtimeMetadata?.remoteTitle, item.remoteTitle]
        .map((value) => sanitizeRemoteText(value))
        .find((title) => title && title !== item.text) || '';
    if (resolvedRemoteTitle) {
        const remoteTitle = document.createElement('p');
        remoteTitle.className = 'wish-card__remote-title';
        remoteTitle.textContent = resolvedRemoteTitle;
        content.appendChild(remoteTitle);
    }

    const resolvedRemoteDescription = [runtimeMetadata?.remoteDescription, item.remoteDescription]
        .map((value) => sanitizeRemoteText(value))
        .find(Boolean) || '';
    if (resolvedRemoteDescription) {
        const remoteDescription = document.createElement('p');
        remoteDescription.className = 'wish-card__remote-description';
        remoteDescription.textContent = resolvedRemoteDescription;
        content.appendChild(remoteDescription);
    }

    if (metadataBlocked) {
        const warning = document.createElement('p');
        warning.className = 'wish-card__metadata-warning';
        warning.textContent = getBlockedMetadataMessage(item.url, blockedReason);
        content.appendChild(warning);
    }

    if (item.note) {
        const note = document.createElement('p');
        note.className = 'wish-card__note';
        note.textContent = item.note;
        content.appendChild(note);
    }

    const meta = document.createElement('div');
    meta.className = 'wish-card__meta';
    const dateSpan = document.createElement('span');
    dateSpan.textContent = `Добавлено: ${formatDate(item.createdAt)}`;
    meta.appendChild(dateSpan);

    if (item.metadataFetchedAt) {
        const fetchedSpan = document.createElement('span');
        fetchedSpan.textContent = `Данные обновлены: ${formatDate(item.metadataFetchedAt)}`;
        meta.appendChild(fetchedSpan);
    }

    const pricesBlock = document.createElement('div');
    pricesBlock.className = 'wish-card__prices';

    if (item.price !== null) {
        const manualPrice = document.createElement('span');
        manualPrice.className = 'price-chip price-chip--manual';
        manualPrice.textContent = `Моя оценка: ${formatPrice(item.price)}`;
        pricesBlock.appendChild(manualPrice);
    }

    const resolvedRemotePrice = typeof item.remotePrice === 'number' ? item.remotePrice : (typeof runtimeMetadata?.remotePrice === 'number' ? runtimeMetadata.remotePrice : null);
    const resolvedRemoteCurrency = item.remoteCurrency || runtimeMetadata?.remoteCurrency || '';

    if (typeof resolvedRemotePrice === 'number') {
        const remotePrice = document.createElement('span');
        remotePrice.className = 'price-chip price-chip--remote';
        remotePrice.textContent = `По ссылке: ${formatPriceWithCurrency(resolvedRemotePrice, resolvedRemoteCurrency)}`;
        pricesBlock.appendChild(remotePrice);
    }

    if (pricesBlock.children.length) {
        meta.appendChild(pricesBlock);
    }

    content.appendChild(meta);

    if (item.url) {
        const link = document.createElement('a');
        link.className = 'wish-card__link';
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Открыть ссылку';
        content.appendChild(link);
    }

    li.appendChild(content);

    const actions = document.createElement('div');
    actions.className = 'wish-card__actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'button button--subtle';
    toggleBtn.textContent = item.purchased ? 'Отметить как нужно' : 'Отметить как куплено';
    toggleBtn.addEventListener('click', () => handleTogglePurchased(item));
    actions.appendChild(toggleBtn);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'button button--ghost edit-toggle';
    editBtn.textContent = 'Редактировать';
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button button--danger';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', () => handleDeleteItem(item));
    actions.appendChild(deleteBtn);

    li.appendChild(actions);

    const editForm = createEditForm(item, editBtn);
    li.appendChild(editForm);

    return li;
}

function createEditForm(item, toggleButton) {
    const form = document.createElement('form');
    form.className = 'edit-form';
    form.noValidate = true;

    const titleField = document.createElement('label');
    titleField.className = 'field';
    titleField.innerHTML = '<span class="field-label">Что хочу *</span>';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.name = 'text';
    titleInput.value = item.text;
    titleField.appendChild(titleInput);
    form.appendChild(titleField);

    const urlField = document.createElement('label');
    urlField.className = 'field';
    urlField.innerHTML = '<span class="field-label">Ссылка</span>';
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.name = 'url';
    urlInput.value = item.url || '';
    urlField.appendChild(urlInput);
    form.appendChild(urlField);

    const noteField = document.createElement('label');
    noteField.className = 'field';
    noteField.innerHTML = '<span class="field-label">Заметка</span>';
    const noteInput = document.createElement('textarea');
    noteInput.name = 'note';
    noteInput.rows = 3;
    noteInput.value = item.note || '';
    noteField.appendChild(noteInput);
    form.appendChild(noteField);

    const duo = document.createElement('div');
    duo.className = 'field-grid';

    const priorityField = document.createElement('label');
    priorityField.className = 'field';
    priorityField.innerHTML = '<span class="field-label">Приоритет</span>';
    const prioritySelect = document.createElement('select');
    prioritySelect.name = 'priority';
    ['1', '2', '3', '4', '5'].forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        if (Number(value) === item.priority) {
            option.selected = true;
        }
        prioritySelect.appendChild(option);
    });
    priorityField.appendChild(prioritySelect);

    const priceField = document.createElement('label');
    priceField.className = 'field';
    priceField.innerHTML = '<span class="field-label">Цена, ₽</span>';
    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.step = '0.01';
    priceInput.min = '0';
    priceInput.name = 'price';
    priceInput.value = item.price !== null ? String(item.price) : '';
    priceField.appendChild(priceInput);

    duo.appendChild(priorityField);
    duo.appendChild(priceField);
    form.appendChild(duo);

    const tagField = document.createElement('label');
    tagField.className = 'field';
    tagField.innerHTML = '<span class="field-label">Тег</span>';
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.name = 'tag';
    tagInput.value = item.tag || '';
    tagField.appendChild(tagInput);
    form.appendChild(tagField);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'button button--primary';
    saveBtn.textContent = 'Сохранить';

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'button button--subtle';
    refreshBtn.textContent = 'Обновить данные';
    refreshBtn.addEventListener('click', async () => {
        const currentUrlValue = urlInput.value.trim();
        if (!currentUrlValue) {
            alert('Укажите ссылку, чтобы обновить данные по товару.');
            return;
        }
        if (!isValidUrl(currentUrlValue)) {
            alert('Пожалуйста, укажите корректную ссылку, начинающуюся с http или https.');
            return;
        }
        if (!currentUser) {
            alert('Сначала войдите в аккаунт.');
            return;
        }
        setRuntimeMetadata(currentUrlValue, createEmptyRuntimeMetadata(false, { loading: true }));
        renderCurrentView();
        setButtonBusy(refreshBtn, true, 'Обновляем...');
        try {
            const metadata = await fetchAndNormalizeMetadata(currentUrlValue, { force: true });
            if (metadata) {
                setRuntimeMetadata(currentUrlValue, metadata);
                renderCurrentView();
            }
            const docRef = doc(db, 'users', currentUser.uid, 'wishlist', item.id);
            const persistent = buildPersistentMetadata(metadata);
            await updateDoc(docRef, { ...persistent, imageUrl: deleteField() });
        } catch (err) {
            console.error('Не удалось обновить данные по ссылке', err);
            alert('Не удалось обновить данные по ссылке: ' + err.message);
        } finally {
            setButtonBusy(refreshBtn, false);
        }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button button--ghost';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.addEventListener('click', () => {
        form.classList.remove('active');
        toggleButton.textContent = 'Редактировать';
    });

    actions.appendChild(saveBtn);
    actions.appendChild(refreshBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    toggleButton.addEventListener('click', () => {
        const nowActive = !form.classList.contains('active');
        document.querySelectorAll('.edit-form.active').forEach((activeForm) => {
            if (activeForm !== form) {
                activeForm.classList.remove('active');
            }
        });
        document.querySelectorAll('.edit-toggle').forEach((btn) => {
            if (btn !== toggleButton) {
                btn.textContent = 'Редактировать';
            }
        });
        if (nowActive) {
            form.classList.add('active');
            toggleButton.textContent = 'Свернуть';
        } else {
            form.classList.remove('active');
            toggleButton.textContent = 'Редактировать';
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await handleEditSubmit({
            form,
            saveButton: saveBtn,
            toggleButton,
            original: item
        });
    });

    return form;
}

async function handleEditSubmit({ form, saveButton, toggleButton, original }) {
    if (!currentUser) {
        alert('Сначала войдите в аккаунт.');
        return;
    }

    const formData = new FormData(form);
    let payload;
    try {
        payload = buildItemPayload({
            text: formData.get('text') || '',
            url: formData.get('url') || '',
            note: formData.get('note') || '',
            priority: formData.get('priority') || original.priority,
            price: formData.get('price') || '',
            tag: formData.get('tag') || ''
        });
    } catch (validationError) {
        alert(validationError.message);
        return;
    }

    let metadataFields = null;
    const urlChanged = (payload.url || '') !== (original.url || '');
    if (urlChanged) {
        clearRuntimeMetadata(original.url);
        if (payload.url) {
            setRuntimeMetadata(payload.url, createEmptyRuntimeMetadata(false, { loading: true }));
            renderCurrentView();
            setButtonBusy(saveButton, true, 'Получаем данные...');
            try {
                const fetched = await fetchAndNormalizeMetadata(payload.url, { force: true });
                if (fetched) {
                    setRuntimeMetadata(payload.url, fetched);
                    metadataFields = buildPersistentMetadata(fetched);
                    renderCurrentView();
                } else {
                    metadataFields = createEmptyPersistentMetadata();
                }
            } catch (err) {
                console.error('Не удалось обновить данные по ссылке', err);
                metadataFields = createEmptyPersistentMetadata();
                renderCurrentView();
            } finally {
                setButtonBusy(saveButton, false);
            }
        } else {
            metadataFields = createEmptyPersistentMetadata();
        }
    }

    setButtonBusy(saveButton, true, 'Сохраняем...');
    try {
        const docRef = doc(db, 'users', currentUser.uid, 'wishlist', original.id);
        const updatePayload = metadataFields ? { ...payload, ...metadataFields } : payload;
        await updateDoc(docRef, { ...updatePayload, imageUrl: deleteField() });
        form.classList.remove('active');
        toggleButton.textContent = 'Редактировать';
    } catch (err) {
        console.error('Не удалось обновить карточку', err);
        alert('Не удалось сохранить изменения: ' + err.message);
    } finally {
        setButtonBusy(saveButton, false);
    }
}

async function handleTogglePurchased(item) {
    if (!currentUser) {
        alert('Сначала войдите в аккаунт.');
        return;
    }
    try {
        const ref = doc(db, 'users', currentUser.uid, 'wishlist', item.id);
        await updateDoc(ref, { purchased: !item.purchased });
    } catch (err) {
        console.error('Не удалось изменить статус покупки', err);
        alert('Не удалось изменить статус: ' + err.message);
    }
}

async function handleDeleteItem(item) {
    if (!currentUser) {
        alert('Сначала войдите в аккаунт.');
        return;
    }
    const confirmed = confirm('Удалить это желание?');
    if (!confirmed) return;
    try {
        clearRuntimeMetadata(item.url);
        const ref = doc(db, 'users', currentUser.uid, 'wishlist', item.id);
        await deleteDoc(ref);
    } catch (err) {
        console.error('Не удалось удалить карточку', err);
        alert('Не удалось удалить желание: ' + err.message);
    }
}

function updateTagFilterOptions(items) {
    if (!filterTag) return;
    const previous = filterTag.value;
    const uniqueTags = Array.from(new Set(items.filter((item) => item.tag).map((item) => item.tag)));
    filterTag.innerHTML = '<option value="all">Все теги</option>';
    uniqueTags.forEach((tag) => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        filterTag.appendChild(option);
    });
    if (previous && (previous === 'all' || uniqueTags.includes(previous))) {
        filterTag.value = previous;
        filters.tag = previous;
    } else {
        filterTag.value = 'all';
        filters.tag = 'all';
    }
}

function setLoadingState(isLoading) {
    if (isLoading) {
        loadingState.hidden = false;
        emptyState.hidden = true;
        itemsList.innerHTML = '';
        itemsList.setAttribute('aria-busy', 'true');
    } else {
        loadingState.hidden = true;
        itemsList.removeAttribute('aria-busy');
    }
}

function setAuthVisibility({ isLoggedIn }) {
    if (!loginBtn || !logoutBtn || !userInfo || !wishlistSection || !loginHero) return;

    if (isLoggedIn) {
        loginBtn.style.display = 'none';
        userInfo.style.display = 'flex';
        logoutBtn.style.display = '';
        wishlistSection.style.display = '';
        loginHero.style.display = 'none';

        const user = currentUser;
        userName.textContent = user?.displayName || 'Без имени';
        userEmail.textContent = user?.email || '';
        if (user?.photoURL) {
            userAvatar.src = user.photoURL;
            userAvatar.hidden = false;
            userAvatar.alt = user.displayName ? `Аватар пользователя ${user.displayName}` : 'Аватар пользователя';
        } else {
            userAvatar.hidden = true;
            userAvatar.removeAttribute('src');
        }
    } else {
        loginBtn.style.display = '';
        loginBtn.disabled = false;
        logoutBtn.style.display = 'none';
        userInfo.style.display = 'none';
        wishlistSection.style.display = 'none';
        loginHero.style.display = '';
        userAvatar.hidden = true;
        userAvatar.removeAttribute('src');
        userName.textContent = '';
        userEmail.textContent = '';
    }
}

function cleanupAfterLogout() {
    unsubscribeWishlist?.();
    unsubscribeWishlist = null;
    wishlistItems = [];
    initialSnapshotPending = false;
    metadataCache.clear();
    metadataUpdateQueue.clear();
    setAuthVisibility({ isLoggedIn: false });
    setLoadingState(false);
    filters.search = '';
    filters.tag = 'all';
    filters.purchased = 'all';
    filters.sort = 'manual';
    filterSearch.value = '';
    filterTag.value = 'all';
    filterPurchased.value = 'all';
    sortSelect.value = 'manual';
    itemsList.innerHTML = '';
    emptyState.hidden = true;
}

function setButtonBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }
        if (busyText) {
            button.textContent = busyText;
        }
        button.disabled = true;
    } else {
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText;
        }
        button.disabled = false;
    }
}

function sortByManualOrder(a, b) {
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function normalizePriceSort(value, defaultValue) {
    return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
}

function formatDate(isoString) {
    try {
        const date = new Date(isoString);
        return new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }).format(date);
    } catch (err) {
        return 'Неизвестно';
    }
}

function formatPrice(value) {
    try {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            maximumFractionDigits: 2
        }).format(value);
    } catch (err) {
        return `${value} ₽`;
    }
}

function formatPriceWithCurrency(value, currency) {
    try {
        if (currency) {
            return new Intl.NumberFormat('ru-RU', {
                style: 'currency',
                currency,
                maximumFractionDigits: 2
            }).format(value);
        }
        return formatPrice(value);
    } catch (err) {
        return `${value} ${currency || '₽'}`.trim();
    }
}

function normalizeRemotePrice(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Number(raw);
    }
    if (typeof raw === 'string') {
        const sanitized = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
        const parsed = Number.parseFloat(sanitized);
        if (Number.isFinite(parsed)) {
            return Number(parsed);
        }
    }
    return null;
}

function normalizeCurrency(raw) {
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (CURRENCY_SYMBOL_MAP[trimmed]) {
        return CURRENCY_SYMBOL_MAP[trimmed];
    }
    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_MAP)) {
        if (trimmed.includes(symbol)) {
            return code;
        }
    }
    const normalized = trimmed.replace(/[^A-Za-z]/g, '').toUpperCase();
    return normalized.length ? normalized : '';
}

function isValidUrl(candidate) {
    try {
        const url = new URL(candidate);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (err) {
        return false;
    }
}

function buildMetadataRequestUrl(targetUrl, options = {}) {
    if (!targetUrl) return '';
    const params = new URLSearchParams({
        url: targetUrl,
        audio: 'false',
        video: 'false',
        palette: 'false',
        iframe: 'false'
    });
    if (options.disableCache) {
        params.set('force', 'true');
    }
    return `${METADATA_ENDPOINT}?${params.toString()}`;
}

function buildHtmlProxyUrl(targetUrl, options = {}) {
    if (!targetUrl) return '';
    const encodedUrl = encodeURIComponent(targetUrl);
    const cacheBypass = options.disableCache ? `&disableCache=true&_=${Date.now()}` : '';
    return `${HTML_PROXY_ENDPOINT}${encodedUrl}${cacheBypass}`;
}

function pickFirstTruthy(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return '';
}

function pickFirstPriceCandidate(...values) {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

function normalizeMicrolinkPrice(candidate) {
    if (!candidate) return null;
    if (typeof candidate === 'string' || typeof candidate === 'number') {
        const normalized = normalizeRemotePrice(candidate);
        if (normalized !== null) {
            return {
                value: normalized,
                currency: typeof candidate === 'string' ? normalizeCurrency(candidate) : ''
            };
        }
        return null;
    }

    if (typeof candidate === 'object') {
        const potentialValue = pickFirstPriceCandidate(
            candidate.value,
            candidate.amount,
            candidate.price,
            candidate.current,
            candidate.text
        );
        const normalized = normalizeRemotePrice(potentialValue ?? '');
        if (normalized === null) return null;
        const currencySource = typeof candidate.currency === 'string'
            ? candidate.currency
            : typeof candidate.currencyCode === 'string'
            ? candidate.currencyCode
            : typeof candidate.symbol === 'string'
            ? candidate.symbol
            : '';
        const currency = normalizeCurrency(currencySource) || (typeof potentialValue === 'string' ? normalizeCurrency(potentialValue) : '');
        return {
            value: normalized,
            currency
        };
    }

    return null;
}

function collectMicrolinkPrices(data) {
    const primaryOffer = Array.isArray(data.product?.offers) ? data.product.offers[0] : data.product?.offers;
    const primaryProduct = Array.isArray(data.products) ? data.products[0] : data.products;
    const primaryPrices = Array.isArray(data.prices) ? data.prices : [data.prices];

    const candidates = [
        data.price,
        data.product?.price,
        primaryOffer?.price,
        primaryOffer,
        primaryProduct?.price,
        primaryProduct,
        ...primaryPrices.filter(Boolean),
        data.meta?.price,
        data.meta?.product?.price
    ];

    for (const candidate of candidates) {
        const parsed = normalizeMicrolinkPrice(candidate);
        if (parsed) return parsed;
    }

    return null;
}

function extractMetadataFromMicrolink(data, baseUrl) {
    if (!data || typeof data !== 'object') {
        return createEmptyRuntimeMetadata(true);
    }

    const rawImage = pickFirstTruthy(
        data.image?.url,
        data.image,
        data.logo?.url,
        data.logo,
        data.thumbnail?.url,
        data.thumbnail
    );

    const imageUrl = sanitizeRemoteImageUrl(resolveUrl(rawImage, baseUrl));

    if (isMicrolinkBlocked(data, imageUrl, baseUrl)) {
        const reason = baseUrl && OZON_DOMAIN_PATTERN.test(baseUrl) ? 'ozon' : 'remote_protection';
        return createEmptyRuntimeMetadata(true, {
            blocked: true,
            blockedReason: reason
        });
    }

    const remoteTitle = sanitizeRemoteText(
        pickFirstTruthy(
            data.title,
            data.publisher,
            data.site?.title,
            data.author,
            data.owner
        )
    );
    const remoteDescription = sanitizeRemoteText(
        pickFirstTruthy(
            data.description,
            data.excerpt,
            data.summary
        )
    );

    const priceInfo = collectMicrolinkPrices(data);

    return {
        imageUrl,
        remoteTitle,
        remoteDescription,
        remotePrice: priceInfo?.value ?? null,
        remoteCurrency: priceInfo?.currency ?? '',
        metadataFetchedAt: new Date().toISOString(),
        loading: false
    };
}

function resolveUrl(candidate, base) {
    if (!candidate) return '';
    try {
        return new URL(candidate, base).toString();
    } catch (err) {
        return '';
    }
}

function sanitizeRemoteImageUrl(url) {
    if (!url) return '';
    const blockedPatterns = [
        'abt-complaints/static/v1/img/warn.png'
    ];
    if (blockedPatterns.some((pattern) => url.includes(pattern))) {
        return '';
    }
    return url;
}

function containsBlockedMarker(value) {
    if (typeof value !== 'string') return false;
    return BLOCKED_METADATA_PATTERNS.some((pattern) => pattern.test(value));
}

function isMicrolinkBlocked(data, imageUrl, originalUrl) {
    const textCandidates = [
        data?.title,
        data?.description,
        data?.excerpt,
        data?.summary,
        data?.url,
        data?.content,
        data?.author,
        data?.publisher
    ];

    if (textCandidates.some(containsBlockedMarker)) {
        return true;
    }

    if (originalUrl && OZON_DOMAIN_PATTERN.test(originalUrl)) {
        if (!imageUrl) {
            return true;
        }
        if (textCandidates.some((value) => typeof value === 'string' && /fab_chlg/i.test(value))) {
            return true;
        }
    }

    return false;
}

function sanitizeRemoteText(value) {
    if (containsBlockedMarker(value)) {
        return '';
    }
    return typeof value === 'string' ? value.trim() : '';
}

function getBlockedMetadataMessage(url, reason) {
    if (reason === 'ozon' || (url && OZON_DOMAIN_PATTERN.test(url))) {
        return 'OZON защищает карточки от автоматического сбора данных. Откройте ссылку, чтобы увидеть товар.';
    }
    return 'Магазин ограничивает автоматическую загрузку данных. Откройте ссылку вручную.';
}

function shouldFallbackToHtml(metadata) {
    if (!metadata || metadata.blocked) return false;
    const hasPrice = typeof metadata.remotePrice === 'number' && Number.isFinite(metadata.remotePrice);
    return !hasPrice;
}

function mergeMetadata(primary, secondary) {
    if (!primary) return secondary;
    if (!secondary) return primary;
    const merged = {
        ...primary,
        imageUrl: primary.imageUrl || secondary.imageUrl,
        remoteTitle: primary.remoteTitle || secondary.remoteTitle,
        remoteDescription: primary.remoteDescription || secondary.remoteDescription,
        remotePrice:
            typeof primary.remotePrice === 'number' && Number.isFinite(primary.remotePrice)
                ? primary.remotePrice
                : secondary.remotePrice,
        remoteCurrency: primary.remoteCurrency || secondary.remoteCurrency
    };
    return merged;
}

function extractMetadataFromHtml(html, baseUrl) {
    if (typeof html !== 'string' || !html.trim()) {
        return null;
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const bodyText = doc.body?.textContent || '';
        if (containsBlockedMarker(bodyText)) {
            const reason = baseUrl && OZON_DOMAIN_PATTERN.test(baseUrl) ? 'ozon' : 'remote_protection';
            return createEmptyRuntimeMetadata(true, {
                blocked: true,
                blockedReason: reason
            });
        }

        const pick = (...selectors) => {
            for (const selector of selectors) {
                const element = doc.querySelector(selector);
                if (!element) continue;
                const value = element.getAttribute('content') ?? element.getAttribute('value') ?? element.textContent;
                if (typeof value === 'string' && value.trim()) {
                    return value.trim();
                }
            }
            return '';
        };

        const rawImage = pick(
            'meta[property="og:image"]',
            'meta[name="twitter:image"]',
            'meta[itemprop="image"]',
            'meta[property="og:image:secure_url"]'
        );
        const imageUrl = sanitizeRemoteImageUrl(resolveUrl(rawImage, baseUrl));

        const rawTitle = pick(
            'meta[property="og:title"]',
            'meta[name="twitter:title"]',
            'meta[name="title"]',
            'title'
        );
        const remoteTitle = sanitizeRemoteText(rawTitle);

        const rawDescription = pick(
            'meta[property="og:description"]',
            'meta[name="twitter:description"]',
            'meta[name="description"]'
        );
        const remoteDescription = sanitizeRemoteText(rawDescription);

        const rawPrice = pick(
            'meta[property="product:price:amount"]',
            'meta[itemprop="price"]',
            'meta[property="og:price:amount"]',
            'meta[name="twitter:data1"]',
            'meta[name="price"]'
        );
        const rawCurrency = pick(
            'meta[property="product:price:currency"]',
            'meta[itemprop="priceCurrency"]',
            'meta[property="og:price:currency"]',
            'meta[name="twitter:label1"]'
        );

        let remotePrice = normalizeRemotePrice(rawPrice);
        let remoteCurrency = normalizeCurrency(rawCurrency) || normalizeCurrency(rawPrice);

        const jsonLdPrice = extractPriceFromJsonLd(doc);
        if (jsonLdPrice) {
            if (remotePrice === null && typeof jsonLdPrice.value === 'number') {
                remotePrice = jsonLdPrice.value;
            }
            if (!remoteCurrency && jsonLdPrice.currency) {
                remoteCurrency = jsonLdPrice.currency;
            }
        }

        return {
            imageUrl,
            remoteTitle,
            remoteDescription,
            remotePrice,
            remoteCurrency,
            metadataFetchedAt: new Date().toISOString(),
            loading: false
        };
    } catch (err) {
        console.error('Не удалось распарсить HTML метаданных', err);
        return null;
    }
}

function extractPriceFromJsonLd(doc) {
    if (!doc) return null;
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
        const payload = script.textContent?.trim();
        if (!payload) continue;
        try {
            const json = JSON.parse(payload);
            const result = findPriceInJsonLd(json);
            if (result) return result;
        } catch (err) {
            continue;
        }
    }
    return null;
}

function findPriceInJsonLd(node) {
    if (!node || typeof node !== 'object') {
        return null;
    }

    if (Array.isArray(node)) {
        for (const entry of node) {
            const found = findPriceInJsonLd(entry);
            if (found) return found;
        }
        return null;
    }

    const candidate = normalizeMicrolinkPrice({
        value: pickFirstPriceCandidate(
            node.price,
            node.priceValue,
            node.lowPrice,
            node.highPrice,
            node.currentPrice,
            node.offers?.price
        ),
        amount: node.amount,
        price: node.price,
        current: node.current
            || node.currentPrice
            || node.offers?.current
            || node.offers?.currentPrice
            || node.priceSpecification?.price,
        text: node.priceText || node.text,
        currency: node.priceCurrency
            || node.currency
            || node.currencyCode
            || node.priceCurrencyCode
            || node.offers?.priceCurrency
            || node.priceSpecification?.priceCurrency,
        currencyCode: node.currencyCode
            || node.priceCurrency
            || node.priceCurrencyCode
            || node.offers?.currencyCode,
        symbol: node.priceSymbol || node.currencySymbol || node.offers?.currencySymbol
    });

    if (candidate) {
        return candidate;
    }

    const nestedKeys = ['offers', 'priceSpecification'];
    for (const key of nestedKeys) {
        if (node[key]) {
            const nested = findPriceInJsonLd(node[key]);
            if (nested) return nested;
        }
    }

    for (const value of Object.values(node)) {
        if (!value || typeof value !== 'object') continue;
        const nested = findPriceInJsonLd(value);
        if (nested) return nested;
    }

    return null;
}

async function fetchMicrolinkMetadata(url, options = {}) {
    const requestUrl = buildMetadataRequestUrl(url, options);
    const response = await fetch(requestUrl, {
        headers: {
            Accept: 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Microlink вернул код ${response.status}`);
    }
    const payload = await response.json();
    if (!payload || payload.status !== 'success' || !payload.data) {
        throw new Error('Microlink вернул некорректные данные');
    }
    return extractMetadataFromMicrolink(payload.data, url);
}

async function fetchHtmlMetadata(url, options = {}) {
    const proxyUrl = buildHtmlProxyUrl(url, options);
    const response = await fetch(proxyUrl, {
        headers: {
            Accept: 'text/html,application/xhtml+xml'
        }
    });
    if (!response.ok) {
        throw new Error(`HTML-прокси вернул код ${response.status}`);
    }
    const html = await response.text();
    return extractMetadataFromHtml(html, url);
}

async function fetchAndNormalizeMetadata(url, options = {}) {
    const { force = false } = options;
    if (force) {
        metadataCache.delete(url);
    } else if (metadataCache.has(url)) {
        const cached = metadataCache.get(url);
        const cachedTimestamp = cached?.metadataFetchedAt ? Date.parse(cached.metadataFetchedAt) : NaN;
        if (!Number.isNaN(cachedTimestamp)) {
            const age = Date.now() - cachedTimestamp;
            if (age <= METADATA_TTL) {
                return cached;
            }
            metadataCache.delete(url);
        }
    }

    try {
        let finalMetadata = null;
        let microlinkMetadata = null;

        try {
            microlinkMetadata = await fetchMicrolinkMetadata(url, { disableCache: force });
        } catch (err) {
            console.warn('Microlink не смог получить метаданные', err);
        }

        finalMetadata = microlinkMetadata;

        const shouldTryHtml = !finalMetadata || shouldFallbackToHtml(finalMetadata);
        if (shouldTryHtml) {
            try {
                const htmlMetadata = await fetchHtmlMetadata(url, { disableCache: force });
                if (htmlMetadata) {
                    finalMetadata = mergeMetadata(finalMetadata, htmlMetadata);
                }
            } catch (err) {
                console.warn('HTML-прокси не смог получить метаданные', err);
            }
        }

        if (!finalMetadata) {
            finalMetadata = createEmptyRuntimeMetadata(true);
        }

        finalMetadata = {
            ...finalMetadata,
            metadataFetchedAt: new Date().toISOString(),
            loading: false
        };

        setRuntimeMetadata(url, finalMetadata);
        return finalMetadata;
    } catch (err) {
        console.error('Сервис метаданных недоступен', err);
        const fallback = createEmptyRuntimeMetadata(true);
        setRuntimeMetadata(url, fallback);
        return fallback;
    }
}

function handleDragStart(event) {
    if (filters.sort !== 'manual') return;
    draggedElement = event.currentTarget;
    if (!draggedElement) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedElement.dataset.id || '');
    requestAnimationFrame(() => draggedElement.classList.add('wish-card--dragging'));
}

function handleDragOver(event) {
    if (filters.sort !== 'manual' || !draggedElement) return;
    event.preventDefault();
    const target = event.currentTarget;
    if (!target || target === draggedElement || target.nodeName !== 'LI') return;
    const rect = target.getBoundingClientRect();
    const shouldPlaceAfter = event.clientY - rect.top > rect.height / 2;
    const referenceNode = shouldPlaceAfter ? target.nextSibling : target;
    if (referenceNode !== draggedElement) {
        itemsList.insertBefore(draggedElement, referenceNode);
    }
}

function handleDrop(event) {
    if (filters.sort !== 'manual') return;
    event.preventDefault();
    persistOrderFromDom().catch((err) => {
        console.error('Не удалось сохранить новый порядок', err);
        alert('Не удалось сохранить порядок: ' + err.message);
    });
}

function handleDragEnd() {
    if (draggedElement) {
        draggedElement.classList.remove('wish-card--dragging');
    }
    draggedElement = null;
}

async function persistOrderFromDom() {
    if (!currentUser) return;
    const children = Array.from(itemsList.children);
    const updates = [];

    children.forEach((child, index) => {
        const id = child.dataset.id;
        if (!id) return;
        const expectedOrder = index + 1;
        const item = wishlistItems.find((entry) => entry.id === id);
        if (item && item.order !== expectedOrder) {
            item.order = expectedOrder;
            updates.push({ id, order: expectedOrder });
        }
    });

    if (!updates.length) return;

    const batch = writeBatch(db);
    updates.forEach(({ id, order }) => {
        const ref = doc(db, 'users', currentUser.uid, 'wishlist', id);
        batch.update(ref, { order });
    });
    await batch.commit();
}