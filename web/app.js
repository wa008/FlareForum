// FlareForum - Lobste.rs-inspired Client Application
const urlParams = new URLSearchParams(window.location.search);

const state = {
  me: null,
  sort: 'hot',
  activePostId: null,
  inviteToken: urlParams.get('invite'),
  setupAdminToken: urlParams.get('setup_admin'),
  setupAdminEmail: urlParams.get('email'),
  posts: []
};

// DOM references
const headerAuthArea = document.getElementById('headerAuthArea');
const navHottest = document.getElementById('navHottest');
const navNewest = document.getElementById('navNewest');
const navTree = document.getElementById('navTree');
const navSubmit = document.getElementById('navSubmit');
const navAdmin = document.getElementById('navAdmin');

// Views
const views = {
  home: document.getElementById('homeView'),
  postDetail: document.getElementById('postDetailView'),
  tree: document.getElementById('treeView'),
  submit: document.getElementById('submitView'),
  invite: document.getElementById('inviteView'),
  login: document.getElementById('loginView'),
  admin: document.getElementById('adminView'),
  register: document.getElementById('registerView'),
  adminSetup: document.getElementById('adminSetupView')
};

// Flash Message
const flashBox = document.getElementById('flashMessage');
const flashText = document.getElementById('flashText');
const flashClose = document.getElementById('flashClose');

if (flashClose) {
  flashClose.onclick = () => {
    flashBox.hidden = true;
  };
}

function flash(msg, type = 'success') {
  if (!msg) {
    flashBox.hidden = true;
    return;
  }
  flashText.textContent = msg;
  flashBox.className = `flash-message ${type}`;
  flashBox.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Utility: API Client
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body;
}

// Utility: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Utility: Extract hostname/domain from URL
function extractDomain(urlStr) {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Utility: Relative time formatting (e.g. "2 hours ago")
function timeAgo(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

// View Switcher (SPA)
function switchView(viewName, params = {}) {
  // Hide all views
  for (const key in views) {
    if (views[key]) views[key].hidden = true;
  }

  // Reset active navbar states
  [navHottest, navNewest, navTree, navSubmit, navAdmin].forEach((el) => {
    if (el) el.classList.remove('active');
  });

  if (viewName === 'home') {
    views.home.hidden = false;
    if (state.sort === 'hot') {
      navHottest?.classList.add('active');
      document.getElementById('viewTitle').textContent = 'Hottest Stories';
    } else {
      navNewest?.classList.add('active');
      document.getElementById('viewTitle').textContent = 'Newest Stories';
    }
    loadStories();
  } else if (viewName === 'postDetail') {
    views.postDetail.hidden = false;
    if (params.id) loadPostDetail(params.id);
  } else if (viewName === 'tree') {
    views.tree.hidden = false;
    navTree?.classList.add('active');
    loadInvitationTree();
  } else if (viewName === 'submit') {
    if (!state.me) {
      flash('Please log in first to submit a story.', 'error');
      switchView('login');
      return;
    }
    views.submit.hidden = false;
    navSubmit?.classList.add('active');
  } else if (viewName === 'invite') {
    if (!state.me) {
      flash('Please log in first to send invitations.', 'error');
      switchView('login');
      return;
    }
    views.invite.hidden = false;
  } else if (viewName === 'login') {
    views.login.hidden = false;
  } else if (viewName === 'admin') {
    if (!state.me || state.me.role !== 'admin') {
      flash('Administrator privileges required.', 'error');
      switchView('home');
      return;
    }
    views.admin.hidden = false;
    navAdmin?.classList.add('active');
    loadAdminInvites();
  } else if (viewName === 'register') {
    views.register.hidden = false;
  } else if (viewName === 'adminSetup') {
    views.adminSetup.hidden = false;
  }
}

// Router for Hash Changes
function handleRoute() {
  const hash = window.location.hash.slice(1) || '';

  if (hash === 'hottest' || hash === '' || hash === '/') {
    state.sort = 'hot';
    switchView('home');
  } else if (hash === 'newest') {
    state.sort = 'new';
    switchView('home');
  } else if (hash.startsWith('post/')) {
    const id = hash.split('/')[1];
    switchView('postDetail', { id });
  } else if (hash === 'tree') {
    switchView('tree');
  } else if (hash === 'submit') {
    switchView('submit');
  } else if (hash === 'invite') {
    switchView('invite');
  } else if (hash === 'login') {
    switchView('login');
  } else if (hash === 'admin') {
    switchView('admin');
  } else if (hash === 'logout') {
    logoutUser();
  }
}

// Auth State Rendering
function renderAuth() {
  const isAdmin = state.me?.role === 'admin';

  // Toggle Admin link in header (Only visible to admins!)
  if (navAdmin) {
    navAdmin.hidden = !isAdmin;
  }

  if (!state.me) {
    headerAuthArea.innerHTML = `
      <a href="#login" class="nav-link" id="navLogin">Login</a>
    `;
    return;
  }

  headerAuthArea.innerHTML = `
    <span class="user-badge">${escapeHtml(state.me.username)}</span>
    ${isAdmin ? '<span class="user-role-label">(admin)</span>' : ''}
    <a href="#invite" class="nav-link">Invite</a>
    <a href="#logout" class="nav-link">Logout</a>
  `;
}

// Fetch current user session
async function refreshMe() {
  try {
    const data = await api('/api/auth/me');
    state.me = data.user;
  } catch {
    state.me = null;
  }
  renderAuth();
}

// Logout action
async function logoutUser() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    flash('You have been logged out.');
  } catch (err) {
    flash(err.message, 'error');
  }
  state.me = null;
  renderAuth();
  window.location.hash = '#hottest';
}

// 1. Stories List View
async function loadStories() {
  const listEl = document.getElementById('storyList');
  const emptyEl = document.getElementById('emptyStoryList');
  const summaryEl = document.getElementById('postCountSummary');

  try {
    const data = await api(`/api/posts?sort=${state.sort}`);
    const items = data.items || [];
    state.posts = items;

    summaryEl.textContent = `${items.length} ${items.length === 1 ? 'story' : 'stories'}`;
    listEl.innerHTML = '';

    if (items.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    const isAdmin = state.me?.role === 'admin';

    items.forEach((post, index) => {
      const li = document.createElement('li');
      li.className = 'story-item';

      const domain = extractDomain(post.url);
      const postUrl = post.url ? escapeHtml(post.url) : `#post/${post.id}`;
      const isExternal = Boolean(post.url);

      li.innerHTML = `
        <div class="story-rank">${index + 1}.</div>
        <div class="story-voter">
          <button class="upvote-btn" data-upvote-id="${post.id}" title="Upvote this story">▲</button>
          <span class="story-score" id="score-${post.id}">${post.score}</span>
        </div>
        <div class="story-details">
          <div class="story-title-line">
            <a href="${postUrl}" ${isExternal ? 'target="_blank" rel="noopener noreferrer"' : ''} class="story-title">
              ${escapeHtml(post.title)}
            </a>
            ${domain ? `<span class="story-domain">(${domain})</span>` : ''}
          </div>
          <div class="story-subline">
            submitted by <span class="story-author">${escapeHtml(post.username)}</span>
            <span>${timeAgo(post.created_at)}</span> |
            <a href="#post/${post.id}">${post.comment_count} ${post.comment_count === 1 ? 'comment' : 'comments'}</a>
            ${isAdmin ? `| <button class="subline-del-btn" data-del-id="${post.id}">delete</button>` : ''}
          </div>
        </div>
      `;

      // Upvote handler
      const upBtn = li.querySelector(`[data-upvote-id="${post.id}"]`);
      if (upBtn) {
        upBtn.onclick = async () => {
          if (!state.me) {
            flash('Please log in to upvote stories.', 'error');
            switchView('login');
            return;
          }
          try {
            const res = await api(`/api/posts/${post.id}/upvote`, { method: 'POST' });
            document.getElementById(`score-${post.id}`).textContent = res.score;
            upBtn.classList.add('voted');
          } catch (err) {
            flash(err.message, 'error');
          }
        };
      }

      // Admin Delete handler
      if (isAdmin) {
        const delBtn = li.querySelector(`[data-del-id="${post.id}"]`);
        if (delBtn) {
          delBtn.onclick = async () => {
            if (!confirm(`Delete story: "${post.title}"?`)) return;
            try {
              await api(`/api/admin/posts/${post.id}`, { method: 'DELETE' });
              flash('Story deleted successfully.');
              await loadStories();
            } catch (err) {
              flash(err.message, 'error');
            }
          };
        }
      }

      listEl.appendChild(li);
    });
  } catch (err) {
    flash(err.message, 'error');
  }
}

// 2. Story Detail & Comments View
async function loadPostDetail(postId) {
  state.activePostId = postId;
  const titleEl = document.getElementById('detailTitle');
  const metaEl = document.getElementById('detailMeta');
  const bodyBox = document.getElementById('detailBodyBox');
  const commentTree = document.getElementById('commentTree');
  const emptyComments = document.getElementById('emptyComments');
  const commentFormContainer = document.getElementById('commentFormContainer');
  const commentLoginPrompt = document.getElementById('commentLoginPrompt');

  if (state.me) {
    commentFormContainer.hidden = false;
    commentLoginPrompt.hidden = true;
  } else {
    commentFormContainer.hidden = true;
    commentLoginPrompt.hidden = false;
  }

  try {
    const data = await api(`/api/posts/${postId}`);
    const post = data.post;
    const comments = data.comments || [];

    const domain = extractDomain(post.url);
    const postUrl = post.url ? escapeHtml(post.url) : null;

    titleEl.innerHTML = `
      ${postUrl ? `<a href="${postUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(post.title)}</a>` : escapeHtml(post.title)}
      ${domain ? `<span class="story-domain" style="font-size:14px; font-weight:normal;">(${domain})</span>` : ''}
    `;

    metaEl.innerHTML = `
      <span>${post.score} points</span> |
      submitted by <span class="story-author">${escapeHtml(post.username)}</span>
      <span>${timeAgo(post.created_at)}</span>
    `;

    if (post.body && post.body.trim()) {
      bodyBox.textContent = post.body;
      bodyBox.hidden = false;
    } else {
      bodyBox.hidden = true;
    }

    commentTree.innerHTML = '';
    if (comments.length === 0) {
      emptyComments.hidden = false;
    } else {
      emptyComments.hidden = true;
      comments.forEach((c) => {
        const li = document.createElement('li');
        li.className = 'comment-item';
        li.innerHTML = `
          <div class="comment-meta">
            ▲ <span class="comment-author">${escapeHtml(c.username)}</span>
            <span>${timeAgo(c.created_at)}</span>
          </div>
          <div class="comment-text">${escapeHtml(c.body)}</div>
        `;
        commentTree.appendChild(li);
      });
    }
  } catch (err) {
    flash(err.message, 'error');
  }
}

// 3. User Invitation Tree View (Lobste.rs Tree Feature)
async function loadInvitationTree() {
  const container = document.getElementById('treeContainer');
  container.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">Loading community tree...</div>';

  try {
    const data = await api('/api/users/tree');
    const users = data.users || [];

    if (users.length === 0) {
      container.innerHTML = '<div class="empty-placeholder">No active members found.</div>';
      return;
    }

    // Build children mapping by invited_by_user_id
    const userMap = new Map();
    const childrenMap = new Map();

    users.forEach((u) => {
      userMap.set(u.id, u);
      if (!childrenMap.has(u.invited_by_user_id)) {
        childrenMap.set(u.invited_by_user_id, []);
      }
      childrenMap.get(u.invited_by_user_id).push(u);
    });

    // Root users (invited_by_user_id is null or not found in userMap)
    const roots = users.filter((u) => !u.invited_by_user_id || !userMap.has(u.invited_by_user_id));

    function renderNode(user) {
      const children = childrenMap.get(user.id) || [];
      const joinedDate = new Date(user.created_at).toLocaleDateString();
      const isAdmin = user.role === 'admin';

      const li = document.createElement('li');
      li.className = 'tree-node';

      li.innerHTML = `
        <div class="tree-node-content">
          <span style="font-size:14px;">👤</span>
          <span class="tree-username">${escapeHtml(user.username)}</span>
          <span class="tree-badge ${isAdmin ? 'admin' : 'user'}">${isAdmin ? 'admin' : 'member'}</span>
          <span class="tree-submeta">joined ${joinedDate}</span>
          ${user.inviter_username ? `<span class="tree-submeta">(invited by <strong>${escapeHtml(user.inviter_username)}</strong>)</span>` : '<span class="tree-submeta" style="color:#b00;">(founder)</span>'}
        </div>
      `;

      if (children.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'tree-children';
        children.forEach((child) => {
          ul.appendChild(renderNode(child));
        });
        li.appendChild(ul);
      }

      return li;
    }

    const rootUl = document.createElement('ul');
    rootUl.className = 'invitation-tree';
    roots.forEach((rootUser) => {
      rootUl.appendChild(renderNode(rootUser));
    });

    container.innerHTML = '';
    container.appendChild(rootUl);
  } catch (err) {
    container.innerHTML = `<div class="empty-placeholder" style="color:#b00;">Failed to load invitation tree: ${escapeHtml(err.message)}</div>`;
  }
}

// 4. Submit Story Handler
const submitForm = document.getElementById('submitPostForm');
if (submitForm) {
  submitForm.onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById('postTitle').value.trim();
    const url = document.getElementById('postUrl').value.trim();
    const body = document.getElementById('postBody').value.trim();

    if (!title) {
      flash('Title is required.', 'error');
      return;
    }

    try {
      const res = await api('/api/posts', {
        method: 'POST',
        body: JSON.stringify({ title, url, body })
      });
      flash('Story submitted successfully!');
      submitForm.reset();
      window.location.hash = `#post/${res.id}`;
    } catch (err) {
      flash(err.message, 'error');
    }
  };
}

// 5. Post Comment Handler
const commentForm = document.getElementById('commentForm');
if (commentForm) {
  commentForm.onsubmit = async (e) => {
    e.preventDefault();
    const commentBody = document.getElementById('commentBody').value.trim();
    if (!commentBody || !state.activePostId) return;

    try {
      await api(`/api/posts/${state.activePostId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentBody })
      });
      document.getElementById('commentBody').value = '';
      flash('Comment posted.');
      await loadPostDetail(state.activePostId);
    } catch (err) {
      flash(err.message, 'error');
    }
  };
}

// 6. Send Invitation Handler
const sendInviteForm = document.getElementById('sendInviteForm');
if (sendInviteForm) {
  sendInviteForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('inviteEmail').value.trim();
    if (!email) return;

    try {
      await api('/api/invites', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      flash(`Invitation successfully dispatched to ${email}!`);
      sendInviteForm.reset();
      window.location.hash = '#hottest';
    } catch (err) {
      flash(err.message, 'error');
    }
  };
}

// 7. Unified Login Handlers (Completely clean, identical interface for all users)
const unifiedLoginForm = document.getElementById('unifiedLoginForm');
const loginEmailInput = document.getElementById('loginEmail');
const loginPasswordInput = document.getElementById('loginPassword');
const magicLinkBtn = document.getElementById('magicLinkLoginBtn');

if (unifiedLoginForm) {
  unifiedLoginForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;

    if (!email) {
      flash('Please enter your email address.', 'error');
      return;
    }

    // If password provided: attempt direct password login
    if (password) {
      try {
        await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        flash('Successfully logged in!');
        unifiedLoginForm.reset();
        await refreshMe();
        window.location.hash = '#hottest';
        return;
      } catch (err) {
        flash(err.message, 'error');
        return;
      }
    }

    // If no password provided: trigger magic link / setup link
    try {
      const res = await api('/api/auth/request-login', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      flash(res.message || 'Login link dispatched! Check your email inbox.');
    } catch (err) {
      flash(err.message, 'error');
    }
  };
}

if (magicLinkBtn) {
  magicLinkBtn.onclick = async () => {
    const email = loginEmailInput.value.trim();
    if (!email) {
      flash('Please enter your email address first.', 'error');
      loginEmailInput.focus();
      return;
    }

    try {
      const res = await api('/api/auth/request-login', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      flash(res.message || 'Login link dispatched! Check your email inbox.');
    } catch (err) {
      flash(err.message, 'error');
    }
  };
}

// 8. Admin Management Handlers
const banUserBtn = document.getElementById('banUserBtn');
const banUserIdInput = document.getElementById('banUserIdInput');
const refreshAdminInvitesBtn = document.getElementById('refreshAdminInvitesBtn');

if (banUserBtn) {
  banUserBtn.onclick = async () => {
    const uid = banUserIdInput.value.trim();
    if (!uid) {
      flash('Please enter a user ID to ban.', 'error');
      return;
    }
    if (!confirm(`Are you sure you want to ban user #${uid}?`)) return;

    try {
      await api(`/api/admin/users/${uid}/ban`, { method: 'POST' });
      flash(`User #${uid} banned successfully.`);
      banUserIdInput.value = '';
    } catch (err) {
      flash(err.message, 'error');
    }
  };
}

if (refreshAdminInvitesBtn) {
  refreshAdminInvitesBtn.onclick = () => loadAdminInvites();
}

async function loadAdminInvites() {
  const tbody = document.getElementById('adminInvitesTableBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading audit records...</td></tr>';

  try {
    const data = await api('/api/admin/invites');
    const items = data.items || [];

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No invitation records found.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    items.forEach((item) => {
      const tr = document.createElement('tr');
      const isUsed = Boolean(item.used_at);
      const isExpired = !isUsed && new Date(item.expires_at) < new Date();

      let statusBadge = '<span style="color:#2b8a3e; font-weight:600;">Accepted</span>';
      if (!isUsed) {
        statusBadge = isExpired
          ? '<span style="color:#991b1b;">Expired</span>'
          : '<span style="color:#c27803;">Pending</span>';
      }

      tr.innerHTML = `
        <td>#${item.id}</td>
        <td><strong>${escapeHtml(item.inviter_username)}</strong></td>
        <td>${escapeHtml(item.invitee_email)}</td>
        <td>${statusBadge}</td>
        <td>${item.invitee_username ? escapeHtml(item.invitee_username) : '-'}</td>
        <td style="font-size:12px; color:var(--text-muted);">${new Date(item.created_at).toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#b00; text-align:center;">Error loading audit logs: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// 9. Handle Invitation Token Registration (?invite=...)
const acceptInviteForm = document.getElementById('acceptInviteForm');
if (acceptInviteForm && state.inviteToken) {
  switchView('register');
  acceptInviteForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    if (!username) return;

    try {
      await api('/api/auth/register-invite', {
        method: 'POST',
        body: JSON.stringify({ token: state.inviteToken, username })
      });
      flash(`Welcome to FlareForum, ${username}! Your account is active.`);
      await refreshMe();
      window.history.replaceState({}, document.title, window.location.pathname + '#hottest');
      switchView('home');
    } catch (err) {
      flash(err.message, 'error');
    }
  };
}

// 10. Handle First-time Admin Password Setup (?setup_admin=...)
const adminSetupPasswordForm = document.getElementById('adminSetupPasswordForm');
if (adminSetupPasswordForm && state.setupAdminToken) {
  switchView('adminSetup');
  adminSetupPasswordForm.onsubmit = async (e) => {
    e.preventDefault();
    const p1 = document.getElementById('setupPassword').value;
    const p2 = document.getElementById('setupPasswordConfirm').value;

    if (p1 !== p2) {
      flash('Passwords do not match. Please re-enter.', 'error');
      return;
    }
    if (p1.length < 8) {
      flash('Password must be at least 8 characters long.', 'error');
      return;
    }

    try {
      await api('/api/auth/admin/setup-password', {
        method: 'POST',
        body: JSON.stringify({ token: state.setupAdminToken, password: p1 })
      });
      flash('Admin password configured successfully! Welcome aboard.');
      await refreshMe();
      window.history.replaceState({}, document.title, window.location.pathname + '#hottest');
      switchView('home');
    } catch (err) {
      flash(err.message, 'error');
    }
  };
}

// Initialize Application
window.addEventListener('hashchange', handleRoute);

(async function init() {
  await refreshMe();

  // If URL has special query params for invite or admin setup, prioritize them
  if (state.inviteToken) {
    switchView('register');
  } else if (state.setupAdminToken) {
    switchView('adminSetup');
  } else {
    handleRoute();
  }
})();
