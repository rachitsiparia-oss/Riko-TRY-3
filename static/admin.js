/* RIKO CMS - Admin Dashboard Core Controller Script */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialise State
    const state = {
        collection: CURRENT_COLLECTION,
        fields: COLLECTION_FIELDS,
        page: 1,
        perPage: 10,
        sortCol: 'id',
        sortDir: 'DESC',
        search: '',
        category: '',
        status: '',
        selectedIds: [],
        items: [] // Current page items cache
    };

    // 2. Fetch DOM references
    const tableBody = document.getElementById('tableBody');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const statusFilter = document.getElementById('statusFilter');
    const bulkActionSelect = document.getElementById('bulkActionSelect');
    const applyBulkBtn = document.getElementById('applyBulkBtn');
    const bulkCount = document.getElementById('bulkCount');
    
    // Pagination refs
    const paginationInfo = document.getElementById('paginationInfo');
    const paginationNumbers = document.getElementById('paginationNumbers');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');

    // Modal / Form refs
    const addModal = document.getElementById('addModal');
    const openAddModalBtn = document.getElementById('openAddModalBtn');
    const closeAddModalBtn = document.getElementById('closeAddModalBtn');
    const cancelAddBtn = document.getElementById('cancelAddBtn');
    const addItemForm = document.getElementById('addItemForm');
    const addNameInput = document.getElementById('add_name');
    const addSlugInput = document.getElementById('add_slug');
    const addImageInput = document.getElementById('add_image_url');
    const addImagePreviewBox = document.getElementById('add_image_preview_box');

    // Slide Panel / Edit refs
    const editSlidePanel = document.getElementById('editSlidePanel');
    const editSlidePanelBackdrop = document.getElementById('editSlidePanelBackdrop');
    const closeEditSlidePanelBtn = document.getElementById('closeEditSlidePanelBtn');
    const editItemForm = document.getElementById('editItemForm');
    const editNameInput = document.getElementById('edit_name');
    const editSlugInput = document.getElementById('edit_slug');
    const editImageInput = document.getElementById('edit_image_url');
    const editImagePreviewBox = document.getElementById('edit_image_preview_box');
    const editImageCurrentSrc = document.getElementById('edit_image_current_src');
    const savingIndicator = document.getElementById('savingIndicator');
    const editItemSubtitle = document.getElementById('editItemSubtitle');

    // Delete Modal refs
    const deleteModal = document.getElementById('deleteModal');
    const closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const deleteItemName = document.getElementById('deleteItemName');
    let pendingDeleteId = null;

    // Lightbox refs
    const lightboxModal = document.getElementById('lightboxModal');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxCaption = document.getElementById('lightboxCaption');
    const closeLightboxBtn = document.getElementById('closeLightboxBtn');

    // Theme Toggle
    const themeToggleBtn = document.getElementById('themeToggleBtn');

    // 3. Load Theme on Startup
    initTheme();

    // 4. Load Initial Table Content
    loadData();

    // ==========================================
    // DATA LOADING & RENDERING
    // ==========================================
    async function loadData() {
        showTableLoading();
        
        let url = `/api/collections/${state.collection}?page=${state.page}&per_page=${state.perPage}&sort_col=${state.sortCol}&sort_dir=${state.sortDir}`;
        if (state.search) url += `&search=${encodeURIComponent(state.search)}`;
        if (state.category) url += `&category=${encodeURIComponent(state.category)}`;
        if (state.status) url += `&status=${encodeURIComponent(state.status)}`;

        try {
            const res = await fetch(url);
            const rawBody = await res.text();
            let data = {};
            try {
                data = rawBody ? JSON.parse(rawBody) : {};
            } catch (jsonErr) {
                throw new Error(`Collection API returned HTTP ${res.status}: ${rawBody.slice(0, 240) || res.statusText}`);
            }
            if (!res.ok || data.success === false) {
                throw new Error(data.details || data.error || "Failed to fetch collection data.");
            }
            
            state.items = data.items;
            renderTable(data.items);
            updatePagination(data);
            resetSelection();
            if (data.warning) {
                showToast(`${data.warning} ${data.details || ''}`.trim(), "error");
            }
        } catch (err) {
            showToast(err.message || "Failed to fetch collection data.", "error");
        }
    }

    function renderTable(items) {
        if (!items || items.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="${state.fields.length + 2}" class="text-center" style="padding: 40px; color: var(--text-muted);">
                        <i class="fa-regular fa-folder-open" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
                        No items found matching your filters.
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        items.forEach(item => {
            const isChecked = state.selectedIds.includes(item.id) ? 'checked' : '';
            html += `
                <tr data-id="${item.id}">
                    <td class="checkbox-cell">
                        <label class="custom-checkbox-container">
                            <input type="checkbox" class="row-checkbox" value="${item.id}" ${isChecked}>
                            <span class="custom-checkbox"></span>
                        </label>
                    </td>
            `;

            state.fields.forEach(field => {
                const val = item[field.name];
                
                if (field.type === 'image') {
                    html += `
                        <td>
                            <img src="/${val}" alt="${item.name}" class="table-img-preview rounded-preview" data-caption="${item.name}">
                        </td>
                    `;
                } else if (field.name === 'name') {
                    html += `
                        <td class="font-semibold cursor-pointer edit-trigger" style="color: var(--text-main); font-weight: 500;">
                            ${escapeHtml(val)}
                        </td>
                    `;
                } else if (field.type === 'slug') {
                    html += `
                        <td>
                            <span class="badge-mono">${escapeHtml(val)}</span>
                        </td>
                    `;
                } else if (field.type === 'longtext') {
                    html += `
                        <td class="description-text-cell" title="${escapeHtml(val)}">
                            ${escapeHtml(val)}
                        </td>
                    `;
                } else if (field.name === 'price') {
                    html += `
                        <td class="font-semibold text-monospace">
                            ₹${parseFloat(val).toFixed(2)}
                        </td>
                    `;
                } else if (field.name === 'category') {
                    html += `
                        <td>
                            <span class="category-pill">${escapeHtml(val)}</span>
                        </td>
                    `;
                } else if (field.name === 'status') {
                    const statusClass = val.toLowerCase() === 'published' ? 'published' : 'draft';
                    html += `
                        <td>
                            <select class="inline-status-select ${statusClass}" data-id="${item.id}">
                                <option value="Published" ${val === 'Published' ? 'selected' : ''}>Published</option>
                                <option value="Draft" ${val === 'Draft' ? 'selected' : ''}>Draft</option>
                            </select>
                        </td>
                    `;
                } else {
                    html += `<td>${escapeHtml(val)}</td>`;
                }
            });

            html += `
                    <td>
                        <div class="row-actions">
                            <button class="row-action-btn edit-btn edit-trigger" title="Quick Edit"><i class="fa-regular fa-pen-to-square"></i></button>
                            <button class="row-action-btn delete-btn row-delete-btn" title="Delete"><i class="fa-regular fa-trash-can"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });
        tableBody.innerHTML = html;
        attachTableEvents();
    }

    function showTableLoading() {
        tableBody.innerHTML = `
            <tr>
                <td colspan="${state.fields.length + 2}" class="text-center" style="padding: 40px; color: var(--gold);">
                    <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;">Loading Database Records...</div>
                </td>
            </tr>
        `;
    }

    // ==========================================
    // INTERACTION LOGIC
    // ==========================================
    function attachTableEvents() {
        // Row Checkboxes
        const rowCheckboxes = document.querySelectorAll('.row-checkbox');
        rowCheckboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                const id = parseInt(cb.value);
                if (cb.checked) {
                    state.selectedIds.push(id);
                } else {
                    state.selectedIds = state.selectedIds.filter(x => x !== id);
                }
                updateBulkActionsUI();
            });
        });

        // Click on Name or Edit Button -> Open Sliding Panel
        const editTriggers = document.querySelectorAll('.edit-trigger');
        editTriggers.forEach(el => {
            el.addEventListener('click', (e) => {
                const tr = el.closest('tr');
                const id = parseInt(tr.getAttribute('data-id'));
                openEditDrawer(id);
            });
        });

        // Click delete on individual row
        const rowDeleteBtns = document.querySelectorAll('.row-delete-btn');
        rowDeleteBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tr = btn.closest('tr');
                const id = parseInt(tr.getAttribute('data-id'));
                const item = state.items.find(x => x.id === id);
                openDeleteModal(id, item ? item.name : "this item");
            });
        });

        // Image zoom lightbox
        const tableImgs = document.querySelectorAll('.table-img-preview');
        tableImgs.forEach(img => {
            img.addEventListener('click', () => {
                lightboxImg.src = img.src;
                lightboxCaption.textContent = img.getAttribute('data-caption') || "Image Preview";
                lightboxModal.classList.add('active');
            });
        });

        // Inline Status Dropdown Edit
        const statusSelects = document.querySelectorAll('.inline-status-select');
        statusSelects.forEach(select => {
            select.addEventListener('change', async () => {
                const id = parseInt(select.getAttribute('data-id'));
                const newStatus = select.value;
                
                // Optimistic visual update
                select.className = `inline-status-select ${newStatus.toLowerCase()}`;
                
                try {
                    const res = await fetch(`/api/collections/${state.collection}/${id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: newStatus })
                    });
                    const resData = await res.json();
                    if (resData.success) {
                        showToast(`Status updated to ${newStatus}.`, "success");
                    } else {
                        showToast(resData.error || "Failed to update status", "error");
                        loadData(); // Revert on failure
                    }
                } catch (err) {
                    showToast("Server communication error.", "error");
                    loadData();
                }
            });
        });
    }

    // ==========================================
    // SEARCH, FILTERS & SORTING
    // ==========================================
    // Debounce Helper
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    searchInput.addEventListener('input', debounce((e) => {
        state.search = e.target.value.trim();
        state.page = 1;
        loadData();
    }, 400));

    if (categoryFilter) {
        categoryFilter.addEventListener('change', (e) => {
            state.category = e.target.value;
            state.page = 1;
            loadData();
        });
    }

    statusFilter.addEventListener('change', (e) => {
        state.status = e.target.value;
        state.page = 1;
        loadData();
    });

    // Sorting column headers
    const sortHeaders = document.querySelectorAll('.sortable-header');
    sortHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-column');
            if (state.sortCol === column) {
                state.sortDir = state.sortDir === 'ASC' ? 'DESC' : 'ASC';
            } else {
                state.sortCol = column;
                state.sortDir = 'ASC';
            }

            // Update UI class indicators
            sortHeaders.forEach(h => {
                h.classList.remove('asc', 'desc');
            });
            th.classList.add(state.sortDir.toLowerCase());
            
            loadData();
        });
    });

    // ==========================================
    // PAGINATION
    // ==========================================
    function updatePagination(data) {
        const start = (data.page - 1) * data.per_page + 1;
        const end = Math.min(start + data.items.length - 1, data.total_items);
        
        if (data.total_items === 0) {
            paginationInfo.textContent = "Showing 0 entries";
            paginationNumbers.innerHTML = '';
            prevPageBtn.disabled = true;
            nextPageBtn.disabled = true;
            return;
        }

        paginationInfo.textContent = `Showing ${start} to ${end} of ${data.total_items} entries`;
        prevPageBtn.disabled = data.page === 1;
        nextPageBtn.disabled = data.page === data.total_pages;

        // Render page buttons
        let numHtml = '';
        for (let i = 1; i <= data.total_pages; i++) {
            const activeClass = i === data.page ? 'active' : '';
            numHtml += `<button class="pagination-number ${activeClass}" data-page="${i}">${i}</button>`;
        }
        paginationNumbers.innerHTML = numHtml;

        // Attach click listeners to number buttons
        const pageBtns = paginationNumbers.querySelectorAll('.pagination-number');
        pageBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const p = parseInt(btn.getAttribute('data-page'));
                if (state.page !== p) {
                    state.page = p;
                    loadData();
                }
            });
        });
    }

    prevPageBtn.addEventListener('click', () => {
        if (state.page > 1) {
            state.page--;
            loadData();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        state.page++;
        loadData();
    });

    // ==========================================
    // SELECTION & BULK OPERATIONS
    // ==========================================
    selectAllCheckbox.addEventListener('change', () => {
        const isChecked = selectAllCheckbox.checked;
        const rowCheckboxes = document.querySelectorAll('.row-checkbox');
        
        state.selectedIds = [];
        rowCheckboxes.forEach(cb => {
            cb.checked = isChecked;
            if (isChecked) {
                state.selectedIds.push(parseInt(cb.value));
            }
        });
        updateBulkActionsUI();
    });

    function resetSelection() {
        state.selectedIds = [];
        selectAllCheckbox.checked = false;
        updateBulkActionsUI();
    }

    function updateBulkActionsUI() {
        const count = state.selectedIds.length;
        bulkCount.textContent = `${count} selected`;
        
        if (count > 0) {
            bulkActionSelect.disabled = false;
            applyBulkBtn.disabled = false;
        } else {
            bulkActionSelect.disabled = true;
            bulkActionSelect.value = '';
            applyBulkBtn.disabled = true;
        }
    }

    applyBulkBtn.addEventListener('click', async () => {
        const action = bulkActionSelect.value;
        if (!action) return;

        if (action === 'delete') {
            if (!confirm(`Are you sure you want to permanently delete these ${state.selectedIds.length} items?`)) {
                return;
            }
        }

        try {
            const res = await fetch(`/api/collections/${state.collection}/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ids: state.selectedIds,
                    action: action
                })
            });
            const resData = await res.json();
            if (resData.success) {
                showToast(`Successfully applied action to ${state.selectedIds.length} items.`, "success");
                loadData();
            } else {
                showToast(resData.error || "Failed to perform bulk action", "error");
            }
        } catch (err) {
            showToast("Server communication error during bulk action.", "error");
        }
    });

    // ==========================================
    // CREATE NEW ITEM MODAL
    // ==========================================
    openAddModalBtn.addEventListener('click', () => {
        addModal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Lock scrolling
    });

    function closeAddModal() {
        addModal.classList.remove('active');
        addItemForm.reset();
        addImagePreviewBox.innerHTML = `
            <i class="fa-solid fa-cloud-arrow-up cloud-icon"></i>
            <span>Preview Upload</span>
        `;
        document.body.style.overflow = '';
    }

    closeAddModalBtn.addEventListener('click', closeAddModal);
    cancelAddBtn.addEventListener('click', closeAddModal);

    // Live Slug Generation
    if (addNameInput && addSlugInput) {
        addNameInput.addEventListener('input', (e) => {
            addSlugInput.value = slugify(e.target.value);
        });
    }

    // Add Image Input Preview trigger
    if (addImageInput) {
        addImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    addImagePreviewBox.innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; object-fit:cover;">`;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Add Form Submit
    addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const saveBtn = document.getElementById('saveAddBtn');
        saveBtn.textContent = "Saving...";
        saveBtn.disabled = true;

        const formData = new FormData(addItemForm);

        try {
            const res = await fetch(`/api/collections/${state.collection}`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            
            if (data.success) {
                showToast("Item created successfully.", "success");
                closeAddModal();
                loadData();
            } else {
                showToast(data.error || "Failed to create item", "error");
            }
        } catch (err) {
            showToast("Network error occurred while saving.", "error");
        } finally {
            saveBtn.textContent = "Save Collection Item";
            saveBtn.disabled = false;
        }
    });

    // ==========================================
    // RIGHT-SLIDING EDIT AUTO-SAVE PANEL
    // ==========================================
    let autoSaveTimeout = null;

    function openEditDrawer(id) {
        const item = state.items.find(x => x.id === id);
        if (!item) return;

        // Populate fields
        editItemSubtitle.textContent = `Item ID: #${item.id}`;
        document.getElementById('edit_id').value = item.id;

        state.fields.forEach(field => {
            const val = item[field.name];
            const input = document.getElementById(`edit_${field.name}`);
            
            if (!input) return;

            if (field.type === 'image') {
                editImageCurrentSrc.src = `/${val}`;
            } else {
                input.value = val;
            }
        });

        // Clear saving status
        savingIndicator.className = 'saving-indicator';

        // Show panel
        editSlidePanel.classList.add('active');
        editSlidePanelBackdrop.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeEditDrawer() {
        editSlidePanel.classList.remove('active');
        editSlidePanelBackdrop.classList.remove('active');
        editItemForm.reset();
        document.body.style.overflow = '';
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
        }
    }

    closeEditSlidePanelBtn.addEventListener('click', closeEditDrawer);
    editSlidePanelBackdrop.addEventListener('click', closeEditDrawer);

    // Auto-save key/change events trigger setup
    const editAutosaveTriggers = document.querySelectorAll('.edit-autosave-trigger');
    editAutosaveTriggers.forEach(input => {
        const isTextInput = input.tagName === 'INPUT' && (input.type === 'text' || input.type === 'number') || input.tagName === 'TEXTAREA';
        
        if (isTextInput) {
            // Debounced auto-save for typing text inputs
            input.addEventListener('input', () => {
                showSavingStatus('saving');
                
                // Live edit slug update if Name is modified
                if (input.id === 'edit_name' && editSlugInput) {
                    editSlugInput.value = slugify(input.value);
                }

                if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
                autoSaveTimeout = setTimeout(() => {
                    triggerAutoSave();
                }, 800);
            });
        } else {
            // Instant auto-save for select dropdowns
            input.addEventListener('change', () => {
                showSavingStatus('saving');
                triggerAutoSave();
            });
        }
    });

    // Image upload trigger inside edit drawer
    if (editImageInput) {
        editImageInput.addEventListener('change', () => {
            showSavingStatus('saving');
            
            // Show preview instantly
            const file = editImageInput.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    editImageCurrentSrc.src = e.target.result;
                };
                reader.readAsDataURL(file);
            }
            
            triggerAutoSave();
        });
    }

    async function triggerAutoSave() {
        const id = document.getElementById('edit_id').value;
        const formData = new FormData(editItemForm);

        try {
            const res = await fetch(`/api/collections/${state.collection}/${id}`, {
                method: 'POST', // Use POST for multipart form update compatibility
                body: formData
            });
            const data = await res.json();
            
            if (data.success) {
                showSavingStatus('success');
                // Optimistically update local items cache
                const index = state.items.findIndex(x => x.id == id);
                if (index !== -1) {
                    state.items[index] = data.item;
                    // Re-render table row values without full database query reload
                    updateTableRow(data.item);
                }
            } else {
                showSavingStatus('error', data.error);
                showToast(data.error || "Failed to auto-save changes", "error");
            }
        } catch (err) {
            showSavingStatus('error', 'Network connection error');
        }
    }

    function updateTableRow(item) {
        const tr = document.querySelector(`tr[data-id="${item.id}"]`);
        if (!tr) return;

        state.fields.forEach(field => {
            const val = item[field.name];
            
            if (field.type === 'image') {
                const img = tr.querySelector('.table-img-preview');
                if (img) img.src = `/${val}`;
            } else if (field.name === 'name') {
                const td = tr.querySelector('.edit-trigger');
                if (td && td.tagName === 'TD') td.textContent = val;
            } else if (field.type === 'slug') {
                const badge = tr.querySelector('.badge-mono');
                if (badge) badge.textContent = val;
            } else if (field.type === 'longtext') {
                const td = tr.querySelector('.description-text-cell');
                if (td) {
                    td.textContent = val;
                    td.title = val;
                }
            } else if (field.name === 'price') {
                const td = tr.querySelector('.text-monospace');
                if (td) td.textContent = `₹${parseFloat(val).toFixed(2)}`;
            } else if (field.name === 'category') {
                const pill = tr.querySelector('.category-pill');
                if (pill) pill.textContent = val;
            } else if (field.name === 'status') {
                const select = tr.querySelector('.inline-status-select');
                if (select) {
                    select.value = val;
                    select.className = `inline-status-select ${val.toLowerCase()}`;
                }
            }
        });
    }

    function showSavingStatus(status, errorMsg = '') {
        savingIndicator.classList.remove('success', 'error', 'spin');
        
        if (status === 'saving') {
            savingIndicator.className = 'saving-indicator active';
            savingIndicator.querySelector('i').className = 'fa-solid fa-circle-notch fa-spin';
            savingIndicator.querySelector('span').textContent = 'Saving...';
        } else if (status === 'success') {
            savingIndicator.className = 'saving-indicator active success';
            savingIndicator.querySelector('i').className = 'fa-solid fa-check';
            savingIndicator.querySelector('span').textContent = 'Saved';
            // Hide indicator after 2 seconds of inactivity
            setTimeout(() => {
                if (savingIndicator.classList.contains('success')) {
                    savingIndicator.classList.remove('active');
                }
            }, 2000);
        } else if (status === 'error') {
            savingIndicator.className = 'saving-indicator active error';
            savingIndicator.querySelector('i').className = 'fa-solid fa-triangle-exclamation';
            savingIndicator.querySelector('span').textContent = errorMsg ? `Error: ${errorMsg}` : 'Save Failed';
        }
    }

    // ==========================================
    // DELETE SINGLE ITEM CONFIRMATION
    // ==========================================
    function openDeleteModal(id, name) {
        pendingDeleteId = id;
        deleteItemName.textContent = name;
        deleteModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeDeleteModal() {
        deleteModal.classList.remove('active');
        pendingDeleteId = null;
        document.body.style.overflow = '';
    }

    closeDeleteModalBtn.addEventListener('click', closeDeleteModal);
    cancelDeleteBtn.addEventListener('click', closeDeleteModal);

    confirmDeleteBtn.addEventListener('click', async () => {
        if (!pendingDeleteId) return;

        confirmDeleteBtn.textContent = "Deleting...";
        confirmDeleteBtn.disabled = true;

        try {
            const res = await fetch(`/api/collections/${state.collection}/${pendingDeleteId}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            
            if (data.success) {
                showToast("Item deleted successfully.", "success");
                closeDeleteModal();
                loadData();
            } else {
                showToast(data.error || "Failed to delete item", "error");
            }
        } catch (err) {
            showToast("Server error during item deletion.", "error");
        } finally {
            confirmDeleteBtn.textContent = "Delete Permanently";
            confirmDeleteBtn.disabled = false;
        }
    });

    // ==========================================
    // LIGHTBOX PREVIEW CLOSING
    // ==========================================
    function closeLightbox() {
        lightboxModal.classList.remove('active');
        lightboxImg.src = '';
    }
    
    closeLightboxBtn.addEventListener('click', closeLightbox);
    lightboxModal.addEventListener('click', (e) => {
        if (e.target === lightboxModal) closeLightbox();
    });

    // ==========================================
    // THEME SWITCH CONTROLS
    // ==========================================
    themeToggleBtn.addEventListener('click', () => {
        const htmlElement = document.documentElement;
        const currentTheme = htmlElement.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        htmlElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('riko-cms-theme', newTheme);
    });

    function initTheme() {
        const storedTheme = localStorage.getItem('riko-cms-theme');
        if (storedTheme) {
            document.documentElement.setAttribute('data-theme', storedTheme);
        } else {
            // Default dark
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    }

    // ==========================================
    // HELPER UTILITIES
    // ==========================================
    function slugify(text) {
        return text
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')           // Replace spaces with -
            .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
            .replace(/\-\-+/g, '-')         // Replace multiple - with single -
            .replace(/^-+/, '')             // Trim - from start of text
            .replace(/-+$/, '');            // Trim - from end of text
    }

    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    function showToast(message, type = "success") {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icon = type === 'success' 
            ? '<i class="fa-regular fa-circle-check toast-icon"></i>' 
            : '<i class="fa-solid fa-circle-exclamation toast-icon"></i>';
            
        toast.innerHTML = `
            ${icon}
            <div class="toast-message">${message}</div>
            <button class="toast-close">&times;</button>
        `;
        
        document.getElementById('toastContainer').appendChild(toast);
        
        // Auto remove toast
        const removeTimeout = setTimeout(() => {
            removeToast(toast);
        }, 5000);
        
        toast.querySelector('.toast-close').addEventListener('click', () => {
            clearTimeout(removeTimeout);
            removeToast(toast);
        });
    }

    function removeToast(toast) {
        toast.style.animation = 'none';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px) scale(0.95)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }
});
