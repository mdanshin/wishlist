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
    writeBatch
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
        createdAt: safeString(data.createdAt) || new Date().toISOString()
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

    const newItem = {
        ...payload,
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
            const haystack = `${item.text}\u0000${item.note}`.toLowerCase();
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
    li.appendChild(header);

    if (item.note) {
        const note = document.createElement('p');
        note.className = 'wish-card__note';
        note.textContent = item.note;
        li.appendChild(note);
    }

    const meta = document.createElement('div');
    meta.className = 'wish-card__meta';
    const dateSpan = document.createElement('span');
    dateSpan.textContent = `Добавлено: ${formatDate(item.createdAt)}`;
    meta.appendChild(dateSpan);

    if (item.price !== null) {
        const priceSpan = document.createElement('span');
        priceSpan.textContent = `Цена: ${formatPrice(item.price)}`;
        meta.appendChild(priceSpan);
    }

    li.appendChild(meta);

    if (item.url) {
        const link = document.createElement('a');
        link.className = 'wish-card__link';
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Открыть ссылку';
        li.appendChild(link);
    }

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

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button button--ghost';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.addEventListener('click', () => {
        form.classList.remove('active');
        toggleButton.textContent = 'Редактировать';
    });

    actions.appendChild(saveBtn);
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

    setButtonBusy(saveButton, true, 'Сохраняем...');
    try {
        const docRef = doc(db, 'users', currentUser.uid, 'wishlist', original.id);
        await updateDoc(docRef, payload);
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

function isValidUrl(candidate) {
    try {
        const url = new URL(candidate);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (err) {
        return false;
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