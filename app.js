document.addEventListener('DOMContentLoaded', () => {

    // ─────────────────────────────────────────────
    //  Internal JSON Database (localStorage-backed)
    // ─────────────────────────────────────────────

    const DB = {
        // Users table: [{ id, username, passwordHash, createdAt }]
        getUsers() {
            return JSON.parse(localStorage.getItem('taskflow_users')) || [];
        },
        saveUsers(users) {
            localStorage.setItem('taskflow_users', JSON.stringify(users));
        },
        findUser(username) {
            return this.getUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
        },
        createUser(username, password) {
            const users = this.getUsers();
            const newUser = {
                id: 'u_' + Date.now(),
                username,
                passwordHash: hashPassword(password),
                createdAt: Date.now()
            };
            users.push(newUser);
            this.saveUsers(users);
            return newUser;
        },
        verifyUser(username, password) {
            const user = this.findUser(username);
            if (!user) return null;
            return user.passwordHash === hashPassword(password) ? user : null;
        },

        // Tasks table: keyed per user id
        getTasks(userId) {
            return JSON.parse(localStorage.getItem(`taskflow_tasks_${userId}`)) || null;
        },
        saveTasks(userId, tasks) {
            localStorage.setItem(`taskflow_tasks_${userId}`, JSON.stringify(tasks));
        },

        // Session
        getSession() {
            const raw = sessionStorage.getItem('taskflow_session');
            return raw ? JSON.parse(raw) : null;
        },
        setSession(user) {
            sessionStorage.setItem('taskflow_session', JSON.stringify({ id: user.id, username: user.username }));
        },
        clearSession() {
            sessionStorage.removeItem('taskflow_session');
        }
    };

    // Simple deterministic hash (djb2) — good enough for a local JSON DB
    function hashPassword(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        }
        return (hash >>> 0).toString(16); // unsigned 32-bit hex
    }

    // ─────────────────────────────────────────────
    //  Auth UI
    // ─────────────────────────────────────────────

    const loginOverlay   = document.getElementById('login-overlay');
    const appContainer   = document.getElementById('app-container');
    const authForm       = document.getElementById('auth-form');
    const tabLogin       = document.getElementById('tab-login');
    const tabRegister    = document.getElementById('tab-register');
    const authTitle      = document.getElementById('auth-title');
    const authSubtitle   = document.getElementById('auth-subtitle');
    const authSubmitBtn  = document.getElementById('auth-submit-btn');
    const authError      = document.getElementById('auth-error');
    const logoutBtn      = document.getElementById('logout-btn');
    const userNameEl     = document.getElementById('user-name');
    const userAvatarEl   = document.getElementById('user-avatar');

    let isLoginMode = true;
    let currentUser = DB.getSession(); // { id, username }

    if (currentUser) {
        bootApp(currentUser);
    }

    // Tab switching
    tabLogin.addEventListener('click', () => switchTab(true));
    tabRegister.addEventListener('click', () => switchTab(false));

    function switchTab(loginMode) {
        isLoginMode = loginMode;
        authError.style.display = 'none';

        tabLogin.classList.toggle('active', loginMode);
        tabLogin.style.borderBottomColor = loginMode ? 'var(--accent-primary)' : 'transparent';
        tabLogin.style.color = loginMode ? 'var(--accent-primary)' : 'var(--text-secondary)';

        tabRegister.classList.toggle('active', !loginMode);
        tabRegister.style.borderBottomColor = !loginMode ? 'var(--accent-primary)' : 'transparent';
        tabRegister.style.color = !loginMode ? 'var(--accent-primary)' : 'var(--text-secondary)';

        authTitle.textContent    = loginMode ? 'Welcome Back'    : 'Create Account';
        authSubtitle.textContent = loginMode ? 'Sign in to access your tasks.' : 'Sign up to start managing your tasks.';
        authSubmitBtn.textContent = loginMode ? 'Login In' : 'Sign In';
    }

    authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('auth-username').value.trim();
        const password = document.getElementById('auth-password').value;

        if (!username || !password) {
            showAuthError('Please enter both username and password.');
            return;
        }
        if (password.length < 4) {
            showAuthError('Password must be at least 4 characters.');
            return;
        }

        if (isLoginMode) {
            const user = DB.verifyUser(username, password);
            if (user) {
                DB.setSession(user);
                bootApp(user);
            } else {
                showAuthError('Invalid username or password.');
            }
        } else {
            if (DB.findUser(username)) {
                showAuthError('Username already taken. Please choose another.');
                return;
            }
            const user = DB.createUser(username, password);
            DB.setSession(user);
            bootApp(user);
        }
    });

    function showAuthError(msg) {
        authError.textContent = msg;
        authError.style.display = 'block';
    }

    function bootApp(user) {
        currentUser = user;
        loginOverlay.classList.remove('active');
        appContainer.style.display = 'flex';
        authError.style.display = 'none';
        document.getElementById('auth-username').value = '';
        document.getElementById('auth-password').value = '';

        // Show user info in sidebar
        userNameEl.textContent = user.username;
        userAvatarEl.textContent = user.username.charAt(0).toUpperCase();

        initTaskApp(user.id);
    }

    logoutBtn.addEventListener('click', () => {
        DB.clearSession();
        currentUser = null;
        appContainer.style.display = 'none';
        loginOverlay.classList.add('active');
        switchTab(true);
    });

    // ─────────────────────────────────────────────
    //  Task App (per-user)
    // ─────────────────────────────────────────────

    function initTaskApp(userId) {
        // Load tasks for this user — start empty for new accounts
        let tasks = DB.getTasks(userId) || [];

        let currentFilter = 'all';
        let currentSort   = 'date-desc';
        let searchQuery   = '';

        // DOM Elements
        const taskListEl        = document.getElementById('task-list');
        const categoryListEl    = document.getElementById('category-list');
        const categoryOptionsEl = document.getElementById('category-options');
        const addTaskBtn        = document.getElementById('add-task-btn');
        const taskModal         = document.getElementById('task-modal');
        const closeModals       = document.querySelectorAll('.close-modal');
        const taskForm          = document.getElementById('task-form');
        const searchInput       = document.getElementById('search-input');
        const sortSelect        = document.getElementById('sort-select');
        const filterNavs        = document.querySelectorAll('.sidebar-nav li');
        const currentViewTitle  = document.getElementById('current-view-title');
        const themeToggle       = document.getElementById('theme-toggle');
        const themeToggleMobile = document.getElementById('theme-toggle-mobile');
        const htmlEl            = document.documentElement;
        const statTotal         = document.getElementById('stat-total');
        const statPending       = document.getElementById('stat-pending');
        const statCompleted     = document.getElementById('stat-completed');
        const statRate          = document.getElementById('stat-rate');

        // Theme
        const savedTheme = localStorage.getItem('taskflow_theme') || 'dark';
        htmlEl.setAttribute('data-theme', savedTheme);
        updateThemeButtons(savedTheme);

        function toggleTheme() {
            const next = htmlEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            htmlEl.setAttribute('data-theme', next);
            localStorage.setItem('taskflow_theme', next);
            updateThemeButtons(next);
        }

        if (themeToggle)       themeToggle.addEventListener('click', toggleTheme);
        if (themeToggleMobile) themeToggleMobile.addEventListener('click', toggleTheme);

        function updateThemeButtons(theme) {
            const icon = theme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
            const text = theme === 'dark' ? ' Light Mode' : ' Dark Mode';
            if (themeToggle)       themeToggle.innerHTML       = icon + text;
            if (themeToggleMobile) themeToggleMobile.innerHTML = icon;
        }

        // ── Persistence ──────────────────────────
        function saveTasks() {
            DB.saveTasks(userId, tasks);
            render();
        }

        // ── Render ───────────────────────────────
        function render() {
            renderTasks();
            renderStats();
            renderCategories();
        }

        function renderTasks() {
            let filtered = [...tasks];

            if (searchQuery) {
                filtered = filtered.filter(t =>
                    t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (t.category && t.category.toLowerCase().includes(searchQuery.toLowerCase()))
                );
            }

            const today = new Date().toISOString().split('T')[0];

            if (currentFilter.startsWith('cat-')) {
                const catName = currentFilter.replace('cat-', '');
                filtered = filtered.filter(t => t.category === catName);
                currentViewTitle.textContent = `Category: ${catName}`;
            } else {
                switch (currentFilter) {
                    case 'today':
                        filtered = filtered.filter(t => t.dueDate === today);
                        currentViewTitle.textContent = "Today's Tasks";
                        break;
                    case 'upcoming':
                        filtered = filtered.filter(t => t.dueDate && t.dueDate > today);
                        currentViewTitle.textContent = "Upcoming Tasks";
                        break;
                    case 'important':
                        filtered = filtered.filter(t => t.priority === 'high');
                        currentViewTitle.textContent = "Important Tasks";
                        break;
                    case 'completed':
                        filtered = filtered.filter(t => t.completed);
                        currentViewTitle.textContent = "Completed Tasks";
                        break;
                    default:
                        currentViewTitle.textContent = "All Tasks";
                }
            }

            filtered.sort((a, b) => {
                switch (currentSort) {
                    case 'date-asc':  return a.createdAt - b.createdAt;
                    case 'due-date':
                        if (!a.dueDate) return 1;
                        if (!b.dueDate) return -1;
                        return new Date(a.dueDate) - new Date(b.dueDate);
                    case 'priority':
                        const pMap = { high: 3, medium: 2, low: 1 };
                        return pMap[b.priority] - pMap[a.priority];
                    default: return b.createdAt - a.createdAt;
                }
            });

            if (filtered.length === 0) {
                taskListEl.innerHTML = `
                    <div style="text-align:center;padding:40px;color:var(--text-secondary);">
                        <i class="fa-solid fa-clipboard-list" style="font-size:3rem;margin-bottom:16px;opacity:0.5;"></i>
                        <p>No tasks found for this view.</p>
                    </div>`;
                return;
            }

            taskListEl.innerHTML = filtered.map(task => `
                <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
                    <div class="checkbox" onclick="toggleTask(${task.id})">
                        <i class="fa-solid fa-check"></i>
                    </div>
                    <div class="task-content">
                        <div class="task-title">${escapeHtml(task.title)}</div>
                        <div class="task-meta">
                            ${task.dueDate ? `<span><i class="fa-regular fa-calendar"></i> ${formatDate(task.dueDate)}${task.dueTime ? ' ' + task.dueTime : ''}</span>` : ''}
                            <span class="badge priority-${task.priority}">${task.priority}</span>
                            ${task.category ? `<span class="badge category"><i class="fa-solid fa-folder"></i> ${escapeHtml(task.category)}</span>` : ''}
                        </div>
                    </div>
                    <div class="task-actions">
                        <button class="action-btn" onclick="editTask(${task.id})" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button class="action-btn delete-btn" onclick="deleteTask(${task.id})" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `).join('');
        }

        function renderStats() {
            const total     = tasks.length;
            const completed = tasks.filter(t => t.completed).length;
            const pending   = total - completed;
            const rate      = total === 0 ? 0 : Math.round((completed / total) * 100);
            statTotal.textContent     = total;
            statPending.textContent   = pending;
            statCompleted.textContent = completed;
            statRate.textContent      = `${rate}%`;
        }

        function renderCategories() {
            const categories = [...new Set(tasks.filter(t => t.category).map(t => t.category))];

            categoryListEl.innerHTML = categories.map(cat => `
                <li data-filter="cat-${cat}" class="${currentFilter === 'cat-' + cat ? 'active' : ''}">
                    <i class="fa-solid fa-folder"></i> ${escapeHtml(cat)}
                </li>
            `).join('');

            categoryOptionsEl.innerHTML = categories.map(cat => `<option value="${escapeHtml(cat)}">`).join('');

            document.querySelectorAll('#category-list li').forEach(li => {
                li.addEventListener('click', (e) => {
                    setFilter(e.currentTarget.getAttribute('data-filter'), e.currentTarget);
                });
            });
        }

        // ── Helpers ──────────────────────────────
        function formatDate(dateString) {
            const date = new Date(dateString + 'T12:00:00Z');
            return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        }

        function escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        // ── Modal ────────────────────────────────
        function openModal() {
            taskModal.classList.add('active');
            document.getElementById('task-title').focus();
        }

        function closeModal() {
            taskModal.classList.remove('active');
            taskForm.reset();
            document.getElementById('task-id').value = '';
            document.getElementById('modal-title').textContent = 'Create New Task';
        }

        addTaskBtn.addEventListener('click', openModal);
        closeModals.forEach(btn => btn.addEventListener('click', closeModal));
        taskModal.addEventListener('click', (e) => { if (e.target === taskModal) closeModal(); });

        // ── CRUD ─────────────────────────────────
        taskForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id       = document.getElementById('task-id').value;
            const title    = document.getElementById('task-title').value.trim();
            const category = document.getElementById('task-category').value.trim();
            const priority = document.getElementById('task-priority').value;
            const dueDate  = document.getElementById('task-due-date').value;
            const dueTime  = document.getElementById('task-due-time').value;

            if (!title) return;

            if (id) {
                const idx = tasks.findIndex(t => t.id == id);
                if (idx !== -1) {
                    tasks[idx] = { ...tasks[idx], title, category, priority, dueDate, dueTime, updatedAt: Date.now() };
                }
            } else {
                tasks.push({ id: Date.now(), title, category, priority, dueDate, dueTime, completed: false, createdAt: Date.now() });
            }

            saveTasks();
            closeModal();
        });

        window.toggleTask = function (id) {
            const task = tasks.find(t => t.id === id);
            if (task) { task.completed = !task.completed; saveTasks(); }
        };

        window.deleteTask = function (id) {
            if (confirm('Delete this task?')) {
                tasks = tasks.filter(t => t.id !== id);
                saveTasks();
            }
        };

        window.editTask = function (id) {
            const task = tasks.find(t => t.id === id);
            if (task) {
                document.getElementById('task-id').value        = task.id;
                document.getElementById('task-title').value     = task.title;
                document.getElementById('task-category').value  = task.category || '';
                document.getElementById('task-priority').value  = task.priority;
                document.getElementById('task-due-date').value  = task.dueDate || '';
                document.getElementById('task-due-time').value  = task.dueTime || '';
                document.getElementById('modal-title').textContent = 'Edit Task';
                openModal();
            }
        };

        // ── Filtering & Sorting ──────────────────
        function setFilter(filterId, element) {
            currentFilter = filterId;
            document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
            if (element) {
                element.classList.add('active');
            } else {
                const el = document.querySelector(`.sidebar-nav li[data-filter="${filterId}"]`);
                if (el) el.classList.add('active');
            }
            renderTasks();
        }

        filterNavs.forEach(li => {
            li.addEventListener('click', (e) => {
                setFilter(e.currentTarget.getAttribute('data-filter'), e.currentTarget);
            });
        });

        sortSelect.addEventListener('change', (e) => { currentSort = e.target.value; renderTasks(); });
        searchInput.addEventListener('input',  (e) => { searchQuery = e.target.value; renderTasks(); });

        // ── Initial Render ───────────────────────
        render();
    }

});
