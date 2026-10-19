const state = {
  me: null,
  sort: 'new',
  activePostId: null,
  inviteToken: new URLSearchParams(location.search).get('invite')
};

const authArea = document.getElementById('authArea');
const loginPanel = document.getElementById('loginPanel');
const registerPanel = document.getElementById('registerPanel');
const invitePanel = document.getElementById('invitePanel');
const postPanel = document.getElementById('postPanel');
const detailPanel = document.getElementById('detailPanel');
const messageBox = document.getElementById('message');

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const inviteForm = document.getElementById('inviteForm');
const postForm = document.getElementById('postForm');
const commentForm = document.getElementById('commentForm');

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
    loginPanel.hidden = false;
    invitePanel.hidden = true;
    postPanel.hidden = true;
    commentForm.hidden = true;
    return;
  }

  authArea.innerHTML = `<span>${state.me.username} (${state.me.role})</span> <button id="logoutBtn">logout</button>`;
  document.getElementById('logoutBtn').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  };

  loginPanel.hidden = true;
  invitePanel.hidden = false;
  postPanel.hidden = false;
  if (state.activePostId) commentForm.hidden = false;
}

async function refreshMe() {
  const data = await api('/api/auth/me');
  state.me = data.user;
  renderAuth();
}

function renderPosts(items) {
  postList.innerHTML = '';
  for (const post of items) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="post-title">${escapeHtml(post.title)}</div>
      <div class="post-meta">by ${escapeHtml(post.username)} | ${post.comment_count} comments | ${new Date(post.created_at).toLocaleString()}</div>
      ${post.url ? `<div><a href="${encodeURI(post.url)}" target="_blank" rel="noreferrer">${escapeHtml(post.url)}</a></div>` : ''}
      <button data-post-id="${post.id}" class="small">view</button>
    `;

    li.querySelector('button').onclick = () => loadPost(post.id);
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

loginForm.onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  try {
    await api('/api/auth/request-login', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    message('Login link sent. Check your email.');
  } catch (err) {
    message(err.message);
  }
};

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
    await refreshMe();
    await loadPosts();
  } catch (err) {
    message(err.message);
  }
};

inviteForm.onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById('inviteEmail').value;
  try {
    await api('/api/invites', { method: 'POST', body: JSON.stringify({ email }) });
    message('Invite sent.');
  } catch (err) {
    message(err.message);
  }
};

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
    if (state.inviteToken) registerPanel.hidden = false;
    await refreshMe();
    await loadPosts();
    setInterval(loadPosts, 30000);
  } catch (err) {
    message(err.message);
  }
}

init();
