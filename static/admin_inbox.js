/* RIKO CMS - Admin Reservations & Operations Controller Script */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialise State
    const state = {
        view: CURRENT_VIEW, // 'dashboard', 'reservations', 'settings'
        // Inbox State
        page: 1,
        perPage: 12,
        search: '',
        status: 'All',
        dateFilter: 'all',
        startDate: '',
        endDate: '',
        selectedId: null,
        reservations: [], // current page items
        totalItems: 0,
        counters: {}
    };

    // 2. Fetch general DOM references
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const inboxBadgeCount = document.getElementById('inboxBadgeCount');

    // 3. Initialize theme on load
    initTheme();

    // 4. Start Real-time Stream Connection
    initRealtimeStream();

    // 5. Load active view controller
    initViewController();

    // 6. Start fallback polling to guarantee sync
    let fallbackPollInterval = null;
    function startFallbackPolling() {
        if (fallbackPollInterval) clearInterval(fallbackPollInterval);
        fallbackPollInterval = setInterval(() => {
            if (state.view === 'reservations') {
                loadInboxDataSilently();
            } else if (state.view === 'dashboard') {
                loadDashboardDetails();
            }
        }, 10000); // 10 seconds interval
    }
    startFallbackPolling();

    // ==========================================
    // VIEW ROUTER
    // ==========================================
    function initViewController() {
        // Fetch counters and update sidebar badge
        loadGlobalCounters();

        if (state.view === 'dashboard') {
            initDashboardView();
        } else if (state.view === 'reservations') {
            initReservationsView();
        } else if (state.view === 'settings') {
            initSettingsView();
        }
    }

    // ==========================================
    // REAL-TIME BROADCAST ENGINE (SSE)
    // ==========================================
    let eventSource = null;

    function initRealtimeStream() {
        if (eventSource) {
            eventSource.close();
        }

        eventSource = new EventSource('/api/reservations/stream');

        // General message event handler
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'ping') return;

            // Handle different broadcast events
            if (data.type === 'new_reservation') {
                handleNewReservationEvent(data.item);
            } else if (data.type === 'reservation_update') {
                handleReservationUpdateEvent(data.item);
            } else if (data.type === 'reservation_delete') {
                handleReservationDeleteEvent(data.id);
            }
        };

        eventSource.onerror = (err) => {
            console.warn("SSE connection interrupted. Reconnecting in 5 seconds...");
            setTimeout(initRealtimeStream, 5000);
        };
    }

    function handleNewReservationEvent(item) {
        // 1. Play synthesized audio chime
        playChimeNotification();

        // 2. Trigger premium toast notification
        showToast(`New booking proposal received from <strong>${escapeHtml(item.name)}</strong> (${item.guests} guests).`, 'success');

        // 3. Update global counters
        loadGlobalCounters();

        // 4. If on Dashboard view, reload details
        if (state.view === 'dashboard') {
            loadDashboardDetails();
        }

        // 5. If on Inbox view, sync list
        if (state.view === 'reservations') {
            // Check if item fits current filters before prepending
            if (matchesCurrentFilters(item)) {
                // Remove last item of page if cache is full
                if (state.reservations.length >= state.perPage) {
                    state.reservations.pop();
                }
                state.reservations.unshift(item);
                renderInboxList(state.reservations);
                updateInboxCountersUI();
            } else {
                // Just update counters on pills
                loadInboxCountersOnly();
            }
        }
    }

    function handleReservationUpdateEvent(item) {
        // Update local item cache
        const idx = state.reservations.findIndex(x => x.id === item.id);
        if (idx !== -1) {
            state.reservations[idx] = item;
            renderInboxList(state.reservations);
        }

        // Update details panel if currently open
        if (state.view === 'reservations' && state.selectedId === item.id) {
            renderReservationDetails(item);
        }

        // Reload counters
        loadGlobalCounters();

        if (state.view === 'dashboard') {
            loadDashboardDetails();
        } else if (state.view === 'reservations') {
            loadInboxCountersOnly();
        }
    }

    function handleReservationDeleteEvent(id) {
        // Remove item from cache
        state.reservations = state.reservations.filter(x => x.id !== id);
        renderInboxList(state.reservations);

        // If selected, reset details panel
        if (state.view === 'reservations' && state.selectedId === id) {
            state.selectedId = null;
            document.getElementById('detailsContent').style.display = 'none';
            document.getElementById('detailsPlaceholder').style.display = 'flex';
            showToast("The active reservation was deleted by another manager session.", "error");
        }

        loadGlobalCounters();

        if (state.view === 'dashboard') {
            loadDashboardDetails();
        } else if (state.view === 'reservations') {
            loadInboxCountersOnly();
        }
    }

    function matchesCurrentFilters(item) {
        // Status filter match
        if (state.status !== 'All' && item.status !== state.status) return false;

        // Search text match
        if (state.search) {
            const query = state.search.toLowerCase();
            const matchName = item.name.toLowerCase().includes(query);
            const matchPhone = item.phone.toLowerCase().includes(query);
            if (!matchName && !matchPhone) return false;
        }

        // Date relative filter match
        const todayStr = new Date().toISOString().split('T')[0];
        if (state.dateFilter === 'today') {
            if (item.date !== todayStr) return false;
        } else if (state.dateFilter === 'tomorrow') {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            if (item.date !== tomorrowStr) return false;
        } else if (state.dateFilter === 'upcoming') {
            if (item.date < todayStr) return false;
        } else if (state.dateFilter === 'custom') {
            if (state.startDate && item.date < state.startDate) return false;
            if (state.endDate && item.date > state.endDate) return false;
        }

        return true;
    }

    // ==========================================
    // COUNTERS & SIDEBAR LOADER
    // ==========================================
    async function loadGlobalCounters() {
        try {
            const res = await fetch('/api/reservations/counters');
            const data = await res.json();
            if (!res.ok || data.success === false) {
                throw new Error(data.details || data.error || "Failed to load operations counters.");
            }
            if (data.success) {
                state.counters = data.counters;
                updateSidebarBadge();
            }
        } catch (err) {
            console.error("Failed to load operations counters:", err);
        }
    }

    function updateSidebarBadge() {
        if (!inboxBadgeCount) return;
        const newCount = state.counters["New"] || 0;
        if (newCount > 0) {
            inboxBadgeCount.textContent = newCount;
            inboxBadgeCount.style.display = 'block';
        } else {
            inboxBadgeCount.style.display = 'none';
        }
    }

    // ==========================================
    // VIEW 1: DASHBOARD VIEW
    // ==========================================
    function initDashboardView() {
        loadDashboardDetails();
    }

    async function loadDashboardDetails() {
        // Load Counters
        await loadGlobalCounters();
        
        // Populate dashboard card metrics
        const valNew = document.getElementById('dashboardCountNew');
        const valPending = document.getElementById('dashboardCountPending');
        const valConfirmed = document.getElementById('dashboardCountConfirmed');
        const valCompleted = document.getElementById('dashboardCountCompleted');

        if (valNew) valNew.textContent = state.counters["New"] || 0;
        if (valPending) valPending.textContent = state.counters["Pending"] || 0;
        if (valConfirmed) valConfirmed.textContent = state.counters["Confirmed"] || 0;
        if (valCompleted) valCompleted.textContent = state.counters["Completed"] || 0;

        // Load recent activity logs list
        const activityContainer = document.getElementById('dashboardRecentActivity');
        if (!activityContainer) return;

        try {
            const res = await fetch('/api/reservations/logs/recent');
            const resData = await res.json();
            if (resData.success && resData.logs) {
                renderDashboardActivity(resData.logs);
            } else {
                activityContainer.innerHTML = '<div class="text-center" style="padding:20px; color:var(--text-muted);">Failed to load activity logs.</div>';
            }
        } catch (e) {
            activityContainer.innerHTML = '<div class="text-center" style="padding:20px; color:var(--text-muted);">Failed to contact server.</div>';
        }
    }

    function renderDashboardActivity(logs) {
        const container = document.getElementById('dashboardRecentActivity');
        if (logs.length === 0) {
            container.innerHTML = '<div class="text-center" style="padding:20px; color:var(--text-muted);"><i class="fa-solid fa-timeline"></i> No recent system activity logged yet.</div>';
            return;
        }

        let html = '';
        logs.forEach(log => {
            const timeStr = formatDateTime(log.timestamp);
            let actionText = '';
            let iconClass = 'fa-circle-info';
            let itemClass = 'create';

            if (log.action_type === 'Create') {
                actionText = `Received new booking proposal from <span>${escapeHtml(log.guest_name)}</span>`;
                iconClass = 'fa-plus';
                itemClass = 'create';
            } else if (log.action_type === 'Status Update') {
                actionText = `Updated <span>${escapeHtml(log.guest_name)}</span> status: <strong>${log.prev_status}</strong> &rarr; <strong>${log.new_status}</strong>`;
                iconClass = 'fa-pen-to-square';
                itemClass = 'update';
            } else {
                actionText = `Performed operation on <span>${escapeHtml(log.guest_name)}</span>`;
                iconClass = 'fa-circle-nodes';
                itemClass = 'update';
            }

            html += `
                <div class="activity-item ${itemClass}">
                    <div class="activity-icon-indicator">
                        <i class="fa-solid ${iconClass}"></i>
                    </div>
                    <div class="activity-desc-block">
                        <h4>${actionText}</h4>
                        <div class="activity-time">${timeStr}</div>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    // ==========================================
    // VIEW 2: RESERVATIONS INBOX VIEW
    // ==========================================
    function initReservationsView() {
        // Search Input listeners
        const searchInput = document.getElementById('inboxSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', debounce((e) => {
                state.search = e.target.value.trim();
                state.page = 1;
                loadInboxData();
            }, 300));
        }

        // Relative Date buttons listeners
        const dateTabBtns = document.querySelectorAll('.inbox-tab');
        const customDateRangeInputs = document.getElementById('customDateRangeInputs');
        dateTabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                dateTabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const filter = btn.getAttribute('data-date');
                state.dateFilter = filter;
                state.page = 1;

                if (filter === 'custom') {
                    customDateRangeInputs.style.display = 'flex';
                } else {
                    customDateRangeInputs.style.display = 'none';
                    state.startDate = '';
                    state.endDate = '';
                    loadInboxData();
                }
            });
        });

        // Apply Custom Date Range
        const applyCustomDateBtn = document.getElementById('applyCustomDateBtn');
        if (applyCustomDateBtn) {
            applyCustomDateBtn.addEventListener('click', () => {
                state.startDate = document.getElementById('customStartDate').value;
                state.endDate = document.getElementById('customEndDate').value;
                state.page = 1;
                loadInboxData();
            });
        }

        // Status filters listener pills
        const statusFilters = document.querySelectorAll('.status-filter');
        statusFilters.forEach(pill => {
            pill.addEventListener('click', () => {
                statusFilters.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                state.status = pill.getAttribute('data-status');
                state.page = 1;
                loadInboxData();
            });
        });

        // Pagination buttons listeners
        const prevBtn = document.getElementById('inboxPrevPageBtn');
        const nextBtn = document.getElementById('inboxNextPageBtn');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (state.page > 1) {
                    state.page--;
                    loadInboxData();
                }
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                state.page++;
                loadInboxData();
            });
        }

        // Details Status Action buttons listeners
        setupDetailsActions();

        // Load initial inbox list
        loadInboxData();
    }

    async function loadInboxDataSilently() {
        let url = `/api/reservations?page=${state.page}&per_page=${state.perPage}&status=${encodeURIComponent(state.status)}&date_filter=${state.dateFilter}`;
        if (state.search) url += `&search=${encodeURIComponent(state.search)}`;
        if (state.startDate) url += `&start_date=${state.startDate}`;
        if (state.endDate) url += `&end_date=${state.endDate}`;

        try {
            const res = await fetch(url);
            const rawBody = await res.text();
            let data = {};
            try {
                data = rawBody ? JSON.parse(rawBody) : {};
            } catch (jsonErr) {
                throw new Error(`Reservation inbox API returned HTTP ${res.status}: ${rawBody.slice(0, 240) || res.statusText}`);
            }
            if (!res.ok || data.success === false) {
                throw new Error(data.details || data.error || "Failed to sync reservation records.");
            }

            // Simple deep comparison to check if items changed before rendering
            const prevSerialized = JSON.stringify(state.reservations.map(r => ({ id: r.id, status: r.status, is_read: r.is_read })));
            const newSerialized = JSON.stringify((data.items || []).map(r => ({ id: r.id, status: r.status, is_read: r.is_read })));

            if (prevSerialized !== newSerialized || data.total_items !== state.totalItems) {
                state.reservations = data.items;
                state.totalItems = data.total_items;
                renderInboxList(data.items);
                updateInboxPaginationUI(data);
            }
            loadGlobalCounters();
            loadInboxCountersOnly();
        } catch (e) {
            console.warn("Silent fallback synchronization failed:", e);
        }
    }

    async function loadInboxData() {
        const bodyContainer = document.getElementById('inboxListBody');
        bodyContainer.innerHTML = `
            <div class="text-center" style="padding: 40px; color: var(--gold);">
                <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.8rem; margin-bottom: 10px;"></i>
                <div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em;">Syncing Inbox...</div>
            </div>
        `;

        let url = `/api/reservations?page=${state.page}&per_page=${state.perPage}&status=${encodeURIComponent(state.status)}&date_filter=${state.dateFilter}`;
        if (state.search) url += `&search=${encodeURIComponent(state.search)}`;
        if (state.startDate) url += `&start_date=${state.startDate}`;
        if (state.endDate) url += `&end_date=${state.endDate}`;

        try {
            const res = await fetch(url);
            const rawBody = await res.text();
            let data = {};
            try {
                data = rawBody ? JSON.parse(rawBody) : {};
            } catch (jsonErr) {
                throw new Error(`Reservation inbox API returned HTTP ${res.status}: ${rawBody.slice(0, 240) || res.statusText}`);
            }
            if (!res.ok || data.success === false) {
                throw new Error(data.details || data.error || "Failed to sync reservation records.");
            }

            state.reservations = data.items || [];
            state.totalItems = data.total_items || 0;

            renderInboxList(state.reservations);
            updateInboxPaginationUI(data);
            await loadInboxCountersOnly();
            if (data.warning) {
                showToast(data.warning, "error");
            }
        } catch (e) {
            const message = escapeHtml(e.message || "Failed to sync reservation records.");
            bodyContainer.innerHTML = `<div class="text-center" style="padding: 40px; color: var(--text-muted);">${message}</div>`;
            showToast(message, "error");
        }
    }

    async function loadInboxCountersOnly() {
        try {
            const res = await fetch('/api/reservations/counters');
            const data = await res.json();
            if (!res.ok || data.success === false) {
                throw new Error(data.details || data.error || "Failed to load inbox counters.");
            }
            if (data.success) {
                state.counters = data.counters;
                updateInboxCountersUI();
            }
        } catch (e) {
            console.error("Failed to load inbox counters:", e);
        }
    }

    function updateInboxCountersUI() {
        // Update sidebar
        updateSidebarBadge();

        // Update pills
        const cAll = document.getElementById('countAll');
        const cNew = document.getElementById('countNew');
        const cPending = document.getElementById('countPending');
        const cConfirmed = document.getElementById('countConfirmed');
        const cCompleted = document.getElementById('countCompleted');
        const cCancelled = document.getElementById('countCancelled');

        let sumAll = 0;
        Object.values(state.counters).forEach(v => sumAll += v);

        if (cAll) cAll.textContent = sumAll;
        if (cNew) cNew.textContent = state.counters["New"] || 0;
        if (cPending) cPending.textContent = state.counters["Pending"] || 0;
        if (cConfirmed) cConfirmed.textContent = state.counters["Confirmed"] || 0;
        if (cCompleted) cCompleted.textContent = state.counters["Completed"] || 0;
        if (cCancelled) cCancelled.textContent = state.counters["Cancelled"] || 0;
    }

    function renderInboxList(items) {
        const container = document.getElementById('inboxListBody');
        items = Array.isArray(items) ? items : [];
        if (items.length === 0) {
            container.innerHTML = `
                <div class="text-center" style="padding: 60px 20px; color: var(--text-muted);">
                    <i class="fa-regular fa-folder-open" style="font-size: 2.2rem; margin-bottom: 12px; display: block; opacity: 0.4;"></i>
                    <h4 style="margin: 0 0 6px; font-weight: 600; color: var(--text-main);">Inbox is Empty</h4>
                    <p style="font-size: 0.72rem; margin: 0;">No reservation proposals matching current criteria.</p>
                </div>
            `;
            return;
        }

        let html = '';
        items.forEach(item => {
            const isActive = state.selectedId === item.id ? 'active' : '';
            const isUnread = item.is_read === 0 ? 'unread' : '';
            const displayTime = formatCompactTime(item.created_at);
            const statusClass = item.status.toLowerCase();
            
            // Format guest count string
            const guestsStr = item.guests === 1 ? '1 Guest' : `${item.guests} Guests`;
            const dateStr = formatDateLabel(item.date);

            html += `
                <div class="inbox-item ${isActive} ${isUnread}" data-id="${item.id}">
                    ${item.is_read === 0 ? '<div class="unread-dot"></div>' : ''}
                    <div class="inbox-item-header">
                        <span class="inbox-item-name">${escapeHtml(item.name)}</span>
                        <span class="inbox-item-time">${displayTime}</span>
                    </div>
                    <div class="inbox-item-sub">
                        <div class="inbox-item-details">
                            <span class="inbox-item-guests-count">${guestsStr}</span>
                            <span class="inbox-item-date-text">&bull; ${dateStr} at ${item.time}</span>
                        </div>
                        <span class="details-status-badge status-${statusClass}" style="padding: 2px 6px; font-size: 0.6rem; border-radius: 0;">${item.status}</span>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;

        // Attach click listeners to item rows
        const rows = container.querySelectorAll('.inbox-item');
        rows.forEach(row => {
            row.addEventListener('click', () => {
                const rawId = row.getAttribute('data-id');
                const id = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId;
                selectReservation(id);
            });
        });
    }

    function updateInboxPaginationUI(data) {
        const prevBtn = document.getElementById('inboxPrevPageBtn');
        const nextBtn = document.getElementById('inboxNextPageBtn');
        const info = document.getElementById('inboxPaginationInfo');

        const start = (data.page - 1) * data.per_page + 1;
        const end = Math.min(start + data.items.length - 1, data.total_items);

        if (data.total_items === 0) {
            if (info) info.textContent = '0 proposals';
            if (prevBtn) prevBtn.disabled = true;
            if (nextBtn) nextBtn.disabled = true;
            return;
        }

        if (info) info.textContent = `${start}-${end} of ${data.total_items}`;
        if (prevBtn) prevBtn.disabled = data.page === 1;
        if (nextBtn) nextBtn.disabled = data.page === data.total_pages;
    }

    async function selectReservation(id) {
        state.selectedId = id;

        // Update active class state on left list row immediately
        const rows = document.querySelectorAll('.inbox-item');
        rows.forEach(r => {
            const rawId = r.getAttribute('data-id');
            const rowId = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId;
            if (rowId === id) {
                r.classList.add('active');
                r.classList.remove('unread');
                const dot = r.querySelector('.unread-dot');
                if (dot) dot.remove();
            } else {
                r.classList.remove('active');
            }
        });

        // Show loading in details panel
        document.getElementById('detailsPlaceholder').style.display = 'none';
        const detailsContainer = document.getElementById('detailsContent');
        detailsContainer.style.display = 'block';
        detailsContainer.style.opacity = '0.5';

        try {
            const res = await fetch(`/api/reservations/${id}`);
            const data = await res.json();
            if (!res.ok || data.success === false) {
                throw new Error(data.details || data.error || "Failed to fetch reservation details.");
            }
            if (data.success) {
                renderReservationDetails(data.item);
                detailsContainer.style.opacity = '1';
                
                // Update local list cache read status without reload
                const idx = state.reservations.findIndex(x => x.id === id);
                if (idx !== -1) {
                    state.reservations[idx].is_read = 1;
                }
                
                // Reload global count
                loadGlobalCounters();
                loadInboxCountersOnly();
            } else {
                showToast("Failed to fetch reservation details", "error");
            }
        } catch (e) {
            showToast(e.message || "Connection to server failed.", "error");
        }
    }

    async function renderReservationDetails(item) {
        // Name and Initials
        document.getElementById('detailsGuestName').textContent = item.name;
        document.getElementById('detailsInitials').textContent = getInitials(item.name);
        document.getElementById('detailsSubmissionTime').textContent = formatDateTime(item.created_at);

        // Core fields
        document.getElementById('detailsPhone').innerHTML = `<a href="tel:${item.phone}" style="color:var(--gold); text-decoration:none;">${item.phone}</a>`;
        document.getElementById('detailsGuests').textContent = item.guests === 1 ? '1 Guest' : `${item.guests} Guests`;
        document.getElementById('detailsDate').textContent = formatDateLabel(item.date) + ` (${item.date})`;
        document.getElementById('detailsTime').textContent = item.time;

        // Special Requests
        const reqBox = document.getElementById('detailsSpecialRequests');
        if (item.special_request && item.special_request.trim() !== '') {
            reqBox.textContent = item.special_request;
            reqBox.style.fontStyle = 'normal';
            reqBox.style.color = 'var(--text-main)';
        } else {
            reqBox.textContent = "No special requests or dietary adjustments submitted.";
            reqBox.style.fontStyle = 'italic';
            reqBox.style.color = 'var(--text-muted)';
        }

        // Status badge
        const badge = document.getElementById('detailsStatusBadge');
        badge.textContent = item.status;
        badge.className = `details-status-badge status-${item.status.toLowerCase()}`;

        // Load History Log Timeline
        try {
            const res = await fetch(`/api/reservations/${item.id}/logs`);
            const logData = await res.json();
            if (!res.ok || logData.success === false) {
                throw new Error(logData.details || logData.error || "Timeline logs query failed.");
            }
            if (logData.success && logData.logs) {
                renderTimelineLogs(logData.logs);
            }
        } catch (e) {
            console.error("Timeline logs query failed:", e);
        }
    }

    function renderTimelineLogs(logs) {
        const list = document.getElementById('detailsLogList');
        if (logs.length === 0) {
            list.innerHTML = '<div class="timeline-log-item">No action logs recorded.</div>';
            return;
        }

        let html = '';
        logs.forEach(log => {
            const timeStr = formatDateTime(log.timestamp);
            let logMsg = '';
            if (log.action_type === 'Create') {
                logMsg = 'Proposal submitted by guest.';
            } else if (log.action_type === 'Status Update') {
                logMsg = `Status changed from <span style="font-weight:600;">${log.prev_status}</span> to <span style="font-weight:600; color:var(--gold);">${log.new_status}</span> by Staff.`;
            } else {
                logMsg = `Operation performed: ${log.action_type}`;
            }

            html += `
                <div class="timeline-log-item">
                    <span class="action-log-type">${logMsg}</span>
                    <span class="action-log-time">&bull; ${timeStr}</span>
                </div>
            `;
        });
        list.innerHTML = html;
    }

    function setupDetailsActions() {
        const confirmBtn = document.getElementById('actionConfirmBtn');
        const pendingBtn = document.getElementById('actionPendingBtn');
        const completeBtn = document.getElementById('actionCompleteBtn');
        const cancelBtn = document.getElementById('actionCancelBtn');
        const deleteBtn = document.getElementById('actionDeleteBtn');

        if (confirmBtn) confirmBtn.addEventListener('click', () => updateStatusAPI('Confirmed'));
        if (pendingBtn) pendingBtn.addEventListener('click', () => updateStatusAPI('Pending'));
        if (completeBtn) completeBtn.addEventListener('click', () => updateStatusAPI('Completed'));
        if (cancelBtn) cancelBtn.addEventListener('click', () => updateStatusAPI('Cancelled'));

        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                if (!state.selectedId) return;
                
                if (confirm("Are you sure you want to permanently delete this reservation? This cannot be undone.")) {
                    try {
                        const res = await fetch(`/api/reservations/${state.selectedId}`, {
                            method: 'DELETE'
                        });
                        const data = await res.json();
                        if (data.success) {
                            showToast("Reservation deleted successfully.", "success");
                            
                            // Close details panel
                            state.selectedId = null;
                            document.getElementById('detailsContent').style.display = 'none';
                            document.getElementById('detailsPlaceholder').style.display = 'flex';
                            
                            loadInboxData();
                        } else {
                            showToast(data.error || "Failed to delete item", "error");
                        }
                    } catch (e) {
                        showToast("Connection to database failed.", "error");
                    }
                }
            });
        }
    }

    async function updateStatusAPI(newStatus) {
        if (!state.selectedId) return;

        try {
            const res = await fetch(`/api/reservations/${state.selectedId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            const data = await res.json();
            
            if (data.success) {
                showToast(`Status updated to ${newStatus}.`, "success");
                renderReservationDetails(data.item);
                
                // Update local list row text directly
                const idx = state.reservations.findIndex(x => x.id === state.selectedId);
                if (idx !== -1) {
                    state.reservations[idx].status = newStatus;
                    renderInboxList(state.reservations);
                }
                
                loadInboxCountersOnly();
            } else {
                showToast(data.error || "Failed to update status", "error");
            }
        } catch (e) {
            showToast("Server communication error.", "error");
        }
    }

    // ==========================================
    // VIEW 3: SETTINGS VIEW
    // ==========================================
    function initSettingsView() {
        // Settings panel requires no dynamic action except displaying the data in template
    }

    // ==========================================
    // CHIME NOTIFICATION SYNTHESISER (Web Audio API)
    // ==========================================
    function playChimeNotification() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            // Note 1: C5 (523.25 Hz)
            const osc1 = audioCtx.createOscillator();
            const gain1 = audioCtx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime);
            gain1.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
            
            osc1.connect(gain1);
            gain1.connect(audioCtx.destination);
            osc1.start();
            osc1.stop(audioCtx.currentTime + 0.5);
            
            // Note 2: E5 (659.25 Hz) slightly delayed
            setTimeout(() => {
                const osc2 = audioCtx.createOscillator();
                const gain2 = audioCtx.createGain();
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime);
                gain2.gain.setValueAtTime(0.08, audioCtx.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
                
                osc2.connect(gain2);
                gain2.connect(audioCtx.destination);
                osc2.start();
                osc2.stop(audioCtx.currentTime + 0.6);
            }, 100);
        } catch (e) {
            console.warn("Chime play error:", e);
        }
    }

    // ==========================================
    // THEME HANDLING
    // ==========================================
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('riko-cms-theme', newTheme);
        });
    }

    function initTheme() {
        const storedTheme = localStorage.getItem('riko-cms-theme');
        if (storedTheme) {
            document.documentElement.setAttribute('data-theme', storedTheme);
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    }

    // ==========================================
    // HELPER UTILITIES
    // ==========================================
    function getInitials(name) {
        if (!name) return 'GA';
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function formatDateTime(isoString) {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            return date.toLocaleString('en-IN', {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
                timeZone: 'Asia/Kolkata' // Adhere to IST only
            });
        } catch (e) {
            return isoString;
        }
    }

    function formatCompactTime(isoString) {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            const today = new Date();
            
            // Format both dates in IST context to check if they are on the same calendar day
            const dateIST = date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
            const todayIST = today.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
            
            if (dateIST === todayIST) {
                return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
            }
            
            return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });
        } catch (e) {
            return isoString;
        }
    }

    function formatDateLabel(dateString) {
        if (!dateString) return '';
        try {
            // Split "YYYY-MM-DD" to avoid timezone conversion offsets and represent date in local/IST terms
            const parts = dateString.split('-');
            if (parts.length !== 3) return dateString;
            
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1; // 0-indexed month
            const day = parseInt(parts[2], 10);
            
            // Create target date locally (which aligns with user's perspective)
            const date = new Date(year, month, day);
            
            const today = new Date();
            today.setHours(0,0,0,0);
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);

            const compareDate = new Date(date);
            compareDate.setHours(0,0,0,0);

            if (compareDate.toDateString() === today.toDateString()) {
                return "Today";
            } else if (compareDate.toDateString() === tomorrow.toDateString()) {
                return "Tomorrow";
            }
            
            return date.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });
        } catch (e) {
            return dateString;
        }
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

    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    function showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

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
        
        container.appendChild(toast);
        
        const removeTimeout = setTimeout(() => {
            removeToast(toast);
        }, 6000);
        
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
