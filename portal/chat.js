/**
 * VSI Chat Interface — Ask questions about the architecture
 *
 * Provides a floating chat panel where students can ask Claude Sonnet 4.6
 * questions about the project's architecture, AWS services, and design decisions.
 */

(function () {
  'use strict';

  var API_BASE_URL = (window.VSI_CONFIG && window.VSI_CONFIG.apiBaseUrl) || '';
  var chatHistory = [];
  var isOpen = false;

  // --- Create Chat UI ---

  function createChatUI() {
    // Chat toggle button
    var toggleBtn = document.createElement('button');
    toggleBtn.id = 'chat-toggle';
    toggleBtn.innerHTML = '💬';
    toggleBtn.title = 'Ask about the architecture';
    toggleBtn.setAttribute('aria-label', 'Open chat');
    document.body.appendChild(toggleBtn);

    // Chat panel
    var panel = document.createElement('div');
    panel.id = 'chat-panel';
    panel.className = 'chat-panel hidden';
    panel.innerHTML = [
      '<div class="chat-header">',
      '  <span class="chat-title">🤖 Architecture Assistant</span>',
      '  <button class="chat-close" aria-label="Close chat">&times;</button>',
      '</div>',
      '<div class="chat-messages" id="chat-messages">',
      '  <div class="chat-msg assistant">',
      '    <p>Hi! I\'m powered by Claude Sonnet 4.6. Ask me anything about how this application was built — the AWS services, the model routing, the RAG pipeline, or any architectural decisions.</p>',
      '  </div>',
      '</div>',
      '<div class="chat-input-area">',
      '  <input type="text" id="chat-input" placeholder="Ask about the architecture..." autocomplete="off">',
      '  <button id="chat-send" aria-label="Send">→</button>',
      '</div>',
    ].join('\n');
    document.body.appendChild(panel);

    // Event listeners
    toggleBtn.addEventListener('click', toggleChat);
    panel.querySelector('.chat-close').addEventListener('click', toggleChat);
    document.getElementById('chat-send').addEventListener('click', sendMessage);
    document.getElementById('chat-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  function toggleChat() {
    isOpen = !isOpen;
    var panel = document.getElementById('chat-panel');
    var toggle = document.getElementById('chat-toggle');
    if (isOpen) {
      panel.classList.remove('hidden');
      toggle.classList.add('active');
      document.getElementById('chat-input').focus();
    } else {
      panel.classList.add('hidden');
      toggle.classList.remove('active');
    }
  }

  function sendMessage() {
    var input = document.getElementById('chat-input');
    var message = input.value.trim();
    if (!message) return;

    // Add user message to UI
    appendMessage('user', message);
    chatHistory.push({ role: 'user', content: message });
    input.value = '';
    input.disabled = true;
    document.getElementById('chat-send').disabled = true;

    // Show typing indicator
    var typingId = showTyping();

    // Call API
    fetch(API_BASE_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message, history: chatHistory.slice(-10) }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        removeTyping(typingId);
        var response = data.response || data.error || 'No response received.';
        appendMessage('assistant', response);
        chatHistory.push({ role: 'assistant', content: response });
      })
      .catch(function (err) {
        removeTyping(typingId);
        appendMessage('assistant', 'Sorry, I encountered an error: ' + err.message);
      })
      .finally(function () {
        input.disabled = false;
        document.getElementById('chat-send').disabled = false;
        input.focus();
      });
  }

  function appendMessage(role, content) {
    var container = document.getElementById('chat-messages');
    var msg = document.createElement('div');
    msg.className = 'chat-msg ' + role;

    // Simple markdown-like rendering: bold, code, newlines
    var html = escapeHtml(content)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
    msg.innerHTML = '<p>' + html + '</p>';

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  }

  function showTyping() {
    var container = document.getElementById('chat-messages');
    var typing = document.createElement('div');
    typing.className = 'chat-msg assistant typing';
    typing.id = 'typing-' + Date.now();
    typing.innerHTML = '<p><span class="dot"></span><span class="dot"></span><span class="dot"></span></p>';
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
    return typing.id;
  }

  function removeTyping(id) {
    var el = document.getElementById(id);
    if (el) el.remove();
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Inject CSS ---

  function injectStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '#chat-toggle { position:fixed; bottom:24px; right:24px; width:56px; height:56px; border-radius:50%; background:var(--color-primary,#1a237e); color:#fff; border:none; font-size:24px; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.3); z-index:9999; transition:transform 0.2s; }',
      '#chat-toggle:hover { transform:scale(1.1); }',
      '#chat-toggle.active { background:var(--color-text-secondary,#616161); }',
      '.chat-panel { position:fixed; bottom:90px; right:24px; width:380px; max-height:500px; background:#fff; border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,0.2); z-index:9998; display:flex; flex-direction:column; overflow:hidden; }',
      '.chat-panel.hidden { display:none; }',
      '.chat-header { padding:12px 16px; background:var(--color-primary,#1a237e); color:#fff; display:flex; justify-content:space-between; align-items:center; }',
      '.chat-title { font-weight:600; font-size:0.9rem; }',
      '.chat-close { background:none; border:none; color:#fff; font-size:1.4rem; cursor:pointer; padding:0 4px; }',
      '.chat-messages { flex:1; overflow-y:auto; padding:12px; max-height:340px; }',
      '.chat-msg { margin-bottom:10px; }',
      '.chat-msg p { padding:8px 12px; border-radius:10px; font-size:0.85rem; line-height:1.5; margin:0; word-wrap:break-word; }',
      '.chat-msg.user p { background:#e3f2fd; margin-left:40px; border-bottom-right-radius:4px; }',
      '.chat-msg.assistant p { background:#f5f5f5; margin-right:40px; border-bottom-left-radius:4px; }',
      '.chat-msg p code { background:#e0e0e0; padding:1px 4px; border-radius:3px; font-size:0.8rem; }',
      '.chat-input-area { display:flex; padding:10px; border-top:1px solid #e0e0e0; gap:8px; }',
      '#chat-input { flex:1; padding:8px 12px; border:1px solid #e0e0e0; border-radius:20px; font-size:0.85rem; outline:none; }',
      '#chat-input:focus { border-color:var(--color-primary,#1a237e); }',
      '#chat-send { width:36px; height:36px; border-radius:50%; background:var(--color-primary,#1a237e); color:#fff; border:none; cursor:pointer; font-size:1.1rem; }',
      '#chat-send:disabled { opacity:0.5; cursor:not-allowed; }',
      '.typing .dot { display:inline-block; width:6px; height:6px; background:#999; border-radius:50%; margin:0 2px; animation:bounce 1.2s infinite; }',
      '.typing .dot:nth-child(2) { animation-delay:0.2s; }',
      '.typing .dot:nth-child(3) { animation-delay:0.4s; }',
      '@keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }',
      '@media(max-width:480px) { .chat-panel { width:calc(100vw - 32px); right:16px; bottom:80px; } }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // --- Initialize ---
  injectStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createChatUI);
  } else {
    createChatUI();
  }
})();
