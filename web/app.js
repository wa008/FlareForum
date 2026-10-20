const urlParams = new URLSearchParams(location.search);

const state = {
  me: null,
  sort: 'new',
  activePostId: null,
  inviteToken: urlParams.get('invite'),
  setupAdminToken: urlParams.get('setup_admin'),
  setupAdminEmail: urlParams.get('email')
};

const authArea = document.getElementById('authArea');
const loginPanel = document.getElementById('loginPanel');
const adminSetupPanel = document.getElementById('adminSetupPanel');
const registerPanel = document.getElementById('registerPanel');
const invitePanel = document.getElementById('invitePanel');
const postPanel = document.getElementById('postPanel');
const adminPanel = document.getElementById('adminPanel');
const detailPanel = document.getElementById('detailPanel');
const messageBox = document.getElementById('message');

const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const sendLinkBtn = document.getElementById('sendLinkBtn');
const adminSetupForm = document.getElementById('adminSetupForm');
const registerForm = document.getElementById('registerForm');
const inviteForm = document.getElementById('inviteForm');
const postForm = document.getElementById('postForm');
const commentForm = document.getElementById('commentForm');

const toggleInvitesBtn = document.getElementById('toggleInvitesBtn');
const banUserIdInput = document.getElementById('banUserIdInput');
const banUserBtn = document.getElementById('banUserBtn');
const adminInvitesContainer = document.getElementById('adminInvitesContainer');
const adminInviteList = document.getElementById('adminInviteList');

const postList = document.getElementById('postList');
const commentList = document.getElementById('commentList');

function message(text) {
  messageBox.textContent = text;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    throw new Error(body?.error || `Request failed: ${res.status}`);
  }
  return body;
}

function renderAuth() {
  if (!state.me) {
    authArea.innerHTML = '<span>not logged in</span>';
    if (!state.setupAdminToken) {
      loginPanel.hidden = false;
    }
    invitePanel.hidden = true;
    postPanel.hidden = true;
    adminPanel.hidden = true;
    commentForm.hidden = true;
    return;
  }

  const isAdmin = state.me.role === 'admin';
  authArea.innerHTML = `<span><strong>${escapeHtml(state.me.username)}</strong> (${state.me.role})</span> <button id="logoutBtn" class="small">logout</button>`;
  document.getElementById('logoutBtn').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  };

  loginPanel.hidden = true;
  adminSetupPanel.hidden = true;
  invitePanel.hidden = false;
  postPanel.hidden = false;
  adminPanel.hidden = !isAdmin;
  if (state.activePostId) commentForm.hidden = false;
}

async function refreshMe() {
  const data = await api('/api/auth/me');
  state.me = data.user;
  renderAuth();
}

function renderPosts(items) {
  postList.innerHTML = '';
  const isAdmin = state.me?.role === 'admin';

  for (const post of items) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="post-title">${escapeHtml(post.title)}</div>
      <div class="post-meta">
        by ${escapeHtml(post.username)} | ${post.comment_count} comments | ${new Date(post.created_at).toLocaleString()}
        ${isAdmin ? `<button data-del-post-id="${post.id}" class="small" style="color:#b00;margin-left:8px;">delete</button>` : ''}
      </div>
      ${post.url ? `<div><a href="${encodeURI(post.url)}" target="_blank" rel="noreferrer">${escapeHtml(post.url)}</a></div>` : ''}
      <button data-post-id="${post.id}" class="small">view</button>
    `;

    li.querySelector('button[data-post-id]').onclick = () => loadPost(post.id);

    if (isAdmin) {
      const delBtn = li.querySelector(`button[data-del-post-id="${post.id}"]`);
      if (delBtn) {
        delBtn.onclick = async () => {
          if (!confirm(`Delete post "${post.title}"?`)) return;
          try {
            await api(`/api/admin/posts/${post.id}`, { method: 'DELETE' });
            message('Post deleted by admin.');
            await loadPosts();
          } catch (err) {
            message(err.message);
          }
        };
      }
    }

    postList.appendChild(li);
  }
}

async function loadPosts() {
  const data = await api(`/api/posts?sort=${state.sort}`);
  renderPosts(data.items || []);
}

async function loadPost(postId) {
  const data = await api(`/api/posts/${postId}`);
  state.activePostId = postId;
  detailPanel.hidden = false;
  document.getElementById('detailTitle').textContent = data.post.title;
  document.getElementById('detailMeta').textContent = `by ${data.post.username} at ${new Date(data.post.created_at).toLocaleString()}`;
  document.getElementById('detailBody').textContent = data.post.body || '';
  commentList.innerHTML = '';

  for (const c of data.comments || []) {
    const li = document.createElement('li');
    li.textContent = `${c.username}: ${c.body}`;
    commentList.appendChild(li);
  }

  commentForm.hidden = !state.me;
}

// 1. 发送 Magic Link 或管理员首次设密链接
sendLinkBtn.onclick = async () => {
  const email = loginEmail.value.trim();
  if (!email) {
    message('Please enter an email address first.');
    loginEmail.focus();
    return;
  }
  try {
    const res = await api('/api/auth/request-login', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    message(res.message || 'Login / Setup link sent! Check your inbox.');
  } catch (err) {
    message(err.message);
  }
};

// 2. 管理员密码直接登录
loginForm.onsubmit = async (e) => {
  e.preventDefault();
  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email) {
    message('Please enter your email address.');
    return;
  }

  if (!password) {
    message('For password login, please enter your admin password. Or click "Send Magic / Setup Link".');
    loginPassword.focus();
    return;
  }

  try {
    const res = await api('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    message('Admin login successful!');
    loginForm.reset();
    await refreshMe();
    await loadPosts();
  } catch (err) {
    message(err.message);
  }
};

// 3. 管理员首次激活并设置密码
if (adminSetupForm) {
  adminSetupForm.onsubmit = async (e) => {
    e.preventDefault();
    const p1 = document.getElementById('adminSetupPassword').value;
    const p2 = document.getElementById('adminSetupPasswordConfirm').value;

    if (p1 !== p2) {
      message('Passwords do not match. Please re-enter.');
      return;
    }
    if (p1.length < 8) {
      message('Password must be at least 8 characters.');
      return;
    }

    try {
      const res = await api('/api/auth/admin/setup-password', {
        method: 'POST',
        body: JSON.stringify({
          token: state.setupAdminToken,
          password: p1
        })
      });
      message(res.message || 'Admin password configured! Logged in.');
      history.replaceState(null, '', '/');
      state.setupAdminToken = null;
      adminSetupPanel.hidden = true;
      await refreshMe();
      await loadPosts();
    } catch (err) {
      message(err.message);
    }
  };
}

// 4. 普通用户通过邀请链接注册
registerForm.onsubmit = async (e) => {
  e.preventDefault();
  const username = document.getElementById('registerUsername').value;
  try {
    await api('/api/auth/register-invite', {
      method: 'POST',
      body: JSON.stringify({ token: state.inviteToken, username })
    });
    message('Registration complete, logged in.');
    history.replaceState(null, '', '/');
    state.inviteToken = null;
    registerPanel.hidden = true;
    await refreshMe();
    await loadPosts();
  } catch (err) {
    message(err.message);
  }
};

// 5. 发送邀请链接
inviteForm.onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById('inviteEmail').value;
  try {
    await api('/api/invites', { method: 'POST', body: JSON.stringify({ email }) });
    message('Invite sent.');
    inviteForm.reset();
  } catch (err) {
    message(err.message);
  }
};

// 6. 发布帖子
postForm.onsubmit = async (e) => {
  e.preventDefault();
  const title = document.getElementById('postTitle').value;
  const url = document.getElementById('postUrl').value;
  const body = document.getElementById('postBody').value;

  try {
    await api('/api/posts', { method: 'POST', body: JSON.stringify({ title, url, body }) });
    message('Post created.');
    postForm.reset();
    await loadPosts();
  } catch (err) {
    message(err.message);
  }
};

// 7. 发布评论
commentForm.onsubmit = async (e) => {
  e.preventDefault();
  const body = document.getElementById('commentBody').value;
  if (!state.activePostId) return;

  try {
    await api(`/api/posts/${state.activePostId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body })
    });
    document.getElementById('commentBody').value = '';
    await loadPost(state.activePostId);
    await loadPosts();
  } catch (err) {
    message(err.message);
  }
};

// 8. 管理员控制面板功能
if (toggleInvitesBtn) {
  toggleInvitesBtn.onclick = async () => {
    if (!adminInvitesContainer.hidden) {
      adminInvitesContainer.hidden = true;
      toggleInvitesBtn.textContent = 'View Invite Logs';
      return;
    }
    try {
      const data = await api('/api/admin/invites');
      adminInviteList.innerHTML = '';
      for (const item of data.items || []) {
        const li = document.createElement('li');
        li.innerHTML = `
          <div><strong>${escapeHtml(item.invitee_email)}</strong> (by ${escapeHtml(item.inviter_username)})</div>
          <div class="post-meta">Sent: ${new Date(item.created_at).toLocaleString()} | Used: ${item.used_at ? 'Yes (' + new Date(item.used_at).toLocaleString() + ')' : 'No'} | Expires: ${new Date(item.expires_at).toLocaleString()}</div>
        `;
        adminInviteList.appendChild(li);
      }
      adminInvitesContainer.hidden = false;
      toggleInvitesBtn.textContent = 'Hide Invite Logs';
    } catch (err) {
      message(err.message);
    }
  };
}

if (banUserBtn) {
  banUserBtn.onclick = async () => {
    const uid = banUserIdInput.value.trim();
    if (!uid) {
      message('Please enter a user ID to ban.');
      return;
    }
    if (!confirm(`Are you sure you want to ban user #${uid}?`)) return;
    try {
      await api(`/api/admin/users/${uid}/ban`, { method: 'POST' });
      message(`User #${uid} banned successfully.`);
      banUserIdInput.value = '';
    } catch (err) {
      message(err.message);
    }
  };
}

document.getElementById('sortNew').onclick = async () => {
  state.sort = 'new';
  await loadPosts();
};

document.getElementById('sortHot').onclick = async () => {
  state.sort = 'hot';
  await loadPosts();
};

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function init() {
  try {
    if (state.setupAdminToken) {
      adminSetupPanel.hidden = false;
      loginPanel.hidden = true;
      if (state.setupAdminEmail) {
        message(`Admin account detected: ${state.setupAdminEmail}. Please set your password below.`);
      }
    } else if (state.inviteToken) {
      registerPanel.hidden = false;
    }

    await refreshMe();
    await loadPosts();
    setInterval(loadPosts, 30000);
  } catch (err) {
    message(err.message);
  }
}

init();
