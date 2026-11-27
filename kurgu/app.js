const sdkVersion = '13.4.0';
const sdkBase = `https://www.gstatic.com/firebasejs/${sdkVersion}`;
const elements = {
  signInPanel: document.querySelector('#signInPanel'),
  signInForm: document.querySelector('#signInForm'),
  emailInput: document.querySelector('#emailInput'),
  authStatus: document.querySelector('#authStatus'),
  workspace: document.querySelector('#workspace'),
  sessionLabel: document.querySelector('#sessionLabel'),
  signOutButton: document.querySelector('#signOutButton'),
  documentList: document.querySelector('#documentList'),
  newDraftButton: document.querySelector('#newDraftButton'),
  titleInput: document.querySelector('#titleInput'),
  sourceInput: document.querySelector('#sourceInput'),
  outlineInput: document.querySelector('#outlineInput'),
  draftInput: document.querySelector('#draftInput'),
  sourceCount: document.querySelector('#sourceCount'),
  draftCount: document.querySelector('#draftCount'),
  saveState: document.querySelector('#saveState'),
  editorStatus: document.querySelector('#editorStatus'),
  outlineButton: document.querySelector('#outlineButton'),
  saveButton: document.querySelector('#saveButton'),
  copyButton: document.querySelector('#copyButton'),
  downloadButton: document.querySelector('#downloadButton'),
  deleteButton: document.querySelector('#deleteButton')
};

let authApi = null;
let currentUser = null;
let documents = [];
let activeDocumentId = null;
let dirty = false;
let loading = false;

function setStatus(message, isError = false) {
  elements.editorStatus.textContent = message;
  elements.editorStatus.dataset.state = isError ? 'error' : 'ok';
}

function setDirty(value = true) {
  dirty = value;
  elements.saveState.textContent = value ? 'Kaydedilmedi' : activeDocumentId ? 'Kaydedildi' : 'Yeni taslak';
  elements.saveButton.disabled = !currentUser || !value || loading;
}

function currentFields() {
  return {
    title: elements.titleInput.value.trim(),
    sourceText: elements.sourceInput.value,
    outlineText: elements.outlineInput.value,
    draftText: elements.draftInput.value
  };
}

function updateCounters() {
  elements.sourceCount.textContent = `${elements.sourceInput.value.length.toLocaleString('tr-TR')} / 40.000`;
  elements.draftCount.textContent = `${elements.draftInput.value.length.toLocaleString('tr-TR')} / 40.000`;
}

function updateActions() {
  const hasContent = Boolean(elements.draftInput.value.trim());
  elements.copyButton.disabled = !hasContent;
  elements.downloadButton.disabled = !hasContent;
  elements.deleteButton.hidden = !activeDocumentId;
  elements.saveButton.disabled = !currentUser || !dirty || loading;
}

function escapeText(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderDocuments() {
  if (!documents.length) {
    elements.documentList.innerHTML = '<p class="empty-list">Henüz kayıtlı taslak yok. Yeni taslakla başlayın.</p>';
    return;
  }
  elements.documentList.innerHTML = documents.map((document) => {
    const date = new Date(document.updatedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    return `<button class="document-item" type="button" data-document-id="${escapeText(document.id)}" aria-current="${document.id === activeDocumentId}"><span class="document-title">${escapeText(document.title || 'Başlıksız taslak')}</span><span class="document-date">${escapeText(date)}</span></button>`;
  }).join('');
}

function setFields(document = null) {
  activeDocumentId = document?.id || null;
  elements.titleInput.value = document?.title || '';
  elements.sourceInput.value = document?.sourceText || '';
  elements.outlineInput.value = document?.outlineText || '';
  elements.draftInput.value = document?.draftText || '';
  updateCounters();
  setDirty(false);
  updateActions();
  renderDocuments();
}

async function getToken() {
  if (!currentUser) throw new Error('Oturum açmanız gerekiyor.');
  return currentUser.getIdToken();
}

async function apiRequest(method, body, id) {
  const token = await getToken();
  const url = id ? `/api/fiction-documents?id=${encodeURIComponent(id)}` : '/api/fiction-documents';
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'İstek tamamlanamadı.');
  return result;
}

async function loadDocuments() {
  loading = true;
  updateActions();
  try {
    const result = await apiRequest('GET');
    documents = Array.isArray(result.documents) ? result.documents : [];
    if (activeDocumentId) {
      const refreshed = documents.find((document) => document.id === activeDocumentId);
      if (refreshed) setFields(refreshed);
      else setFields();
    } else {
      setFields(documents[0] || null);
    }
    setStatus(documents.length ? `${documents.length} taslak yüklendi.` : 'Henüz kayıtlı taslak yok. Yeni taslakla başlayın.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    loading = false;
    updateActions();
  }
}

function makeOutline(source) {
  const facts = source.split(/(?:\r?\n|[.!?;])+/).map((line) => line.trim()).filter(Boolean).slice(0, 8);
  if (!facts.length) return '';
  const beats = [
    ['Açılış', facts[0]],
    ['İlk işaret', facts[1] || 'Ana karakter, görünürde sıradan bir ayrıntının izini sürer.'],
    ['Çatışma', facts[2] || 'Karakterin amacıyla çevresindeki beklentiler karşı karşıya gelir.'],
    ['Dönüm noktası', facts[3] || 'Yeni bir bilgi, olayların anlamını değiştirir.'],
    ['Kapanış fikri', facts[4] || 'Karakter, yaşananların ardından bir seçim yapmak zorunda kalır.']
  ];
  return beats.map(([heading, detail]) => `${heading}: ${detail}`).join('\n\n');
}

function createDraftText() {
  const source = elements.sourceInput.value.trim();
  const outline = elements.outlineInput.value.trim();
  if (!source) {
    setStatus('Önce kaynak bülteni ekleyin.', true);
    elements.sourceInput.focus();
    return;
  }
  const beats = (outline || makeOutline(source)).split(/\n\n+/).filter(Boolean);
  const labels = ['Bir ayrıntı, o günün akışında kimsenin önemsemediği küçük bir işaret gibi duruyordu.', 'Olaylar ilerledikçe, herkesin anlattığı hikâyenin eksik bir yanı olduğu ortaya çıktı.', 'Karakter, bildiğiyle kanıtlayabildiği arasındaki çizgide bir karar vermek zorunda kaldı.', 'Sonunda değişen yalnızca olayların sonucu değil, onlara bakan kişinin kendisiydi.'];
  const draft = [
    `# ${elements.titleInput.value.trim() || 'Başlıksız taslak'}`,
    '',
    '[Kurgu açılışı]',
    beats[0]?.replace(/^[^:]+:\s*/, '') || labels[0],
    '',
    '[Gelişme]',
    beats.slice(1, 3).map((beat) => beat.replace(/^[^:]+:\s*/, '')).filter(Boolean).join(' ') || labels[1],
    '',
    '[Dönüm noktası]',
    beats[3]?.replace(/^[^:]+:\s*/, '') || labels[2],
    '',
    '[Kapanış yönü]',
    beats[4]?.replace(/^[^:]+:\s*/, '') || labels[3],
    '',
    '[Yazar notu: Bu taslak bir kurgu iskeletidir; kaynak metindeki gerçek bilgilerle kurgu ayrımını son okumada kontrol edin.]'
  ].join('\n');
  elements.draftInput.value = draft;
  updateCounters();
  setDirty(true);
  updateActions();
  setStatus('Kurgu iskeleti yerel olarak oluşturuldu. Metni gözden geçirip kendinize göre düzenleyin.');
  elements.draftInput.focus();
}

async function handleAuth() {
  try {
    const configResponse = await fetch('/api/firebase-config', { cache: 'no-store' });
    const config = await configResponse.json();
    if (!configResponse.ok) throw new Error(config.error || 'Giriş yapılandırması alınamadı.');
    const [appSdk, authSdk] = await Promise.all([import(`${sdkBase}/firebase-app.js`), import(`${sdkBase}/firebase-auth.js`)]);
    const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(config);
    const auth = authSdk.getAuth(app);
    authApi = {
      onAuthStateChanged: (callback) => authSdk.onAuthStateChanged(auth, callback),
      isEmailSignInLink: (url) => authSdk.isSignInWithEmailLink(auth, url),
      sendEmailSignInLink: (email, url) => authSdk.sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true }),
      completeEmailSignIn: (email, url) => authSdk.signInWithEmailLink(auth, email, url),
      signOut: () => authSdk.signOut(auth)
    };

    elements.signInForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = elements.emailInput.value.trim();
      const button = elements.signInForm.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        if (authApi.isEmailSignInLink(window.location.href)) {
          const savedEmail = window.sessionStorage.getItem('fictionEmailForSignIn') || email;
          if (!savedEmail) throw new Error('Giriş bağlantısını açtığınız e-posta adresini girin.');
          await authApi.completeEmailSignIn(savedEmail, window.location.href);
          window.sessionStorage.removeItem('fictionEmailForSignIn');
          window.history.replaceState({}, document.title, window.location.pathname);
          elements.authStatus.textContent = 'Giriş tamamlandı.';
        } else {
          await authApi.sendEmailSignInLink(email, `${window.location.origin}${window.location.pathname}`);
          window.sessionStorage.setItem('fictionEmailForSignIn', email);
          elements.authStatus.textContent = 'Giriş bağlantısı e-posta adresinize gönderildi.';
        }
      } catch {
        elements.authStatus.textContent = 'Giriş bağlantısı gönderilemedi veya doğrulanamadı. E-posta adresini ve Firebase e-posta bağlantısı ayarını kontrol edin.';
      } finally {
        button.disabled = false;
      }
    });

    elements.signOutButton.addEventListener('click', async () => {
      if (dirty && !window.confirm('Kaydedilmemiş değişiklikleriniz var. Yine de oturumu kapatmak istiyor musunuz?')) return;
      await authApi.signOut();
      window.location.reload();
    });

    authApi.onAuthStateChanged(async (user) => {
      currentUser = user || null;
      elements.signInPanel.hidden = Boolean(user);
      elements.workspace.hidden = !user;
      elements.signOutButton.hidden = !user;
      elements.sessionLabel.textContent = user ? (user.email || 'Oturum açık') : 'Oturum kapalı';
      elements.saveButton.disabled = !user || !dirty;
      if (user) {
        elements.authStatus.textContent = '';
        await loadDocuments();
      } else {
        documents = [];
        setFields();
        setStatus('Taslaklarınızı görmek için giriş yapın.');
      }
    });

    if (authApi.isEmailSignInLink(window.location.href)) {
      const savedEmail = window.sessionStorage.getItem('fictionEmailForSignIn');
      if (savedEmail) {
        elements.emailInput.value = savedEmail;
        await authApi.completeEmailSignIn(savedEmail, window.location.href);
        window.sessionStorage.removeItem('fictionEmailForSignIn');
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        elements.authStatus.textContent = 'Bağlantıyı açtığınız e-posta adresini girip doğrulama düğmesine basın.';
      }
    }
  } catch {
    elements.sessionLabel.textContent = 'Giriş servisine ulaşılamıyor';
    elements.signInPanel.hidden = false;
    elements.authStatus.textContent = 'Giriş yapılandırması yüklenemedi. Biraz sonra yeniden deneyin.';
  }
}

for (const field of [elements.titleInput, elements.sourceInput, elements.outlineInput, elements.draftInput]) {
  field.addEventListener('input', () => {
    setDirty(true);
    updateCounters();
    updateActions();
  });
}

elements.documentList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-document-id]');
  if (!button) return;
  if (dirty && !window.confirm('Kaydedilmemiş değişiklikleriniz var. Başka taslağa geçilsin mi?')) return;
  const document = documents.find((item) => item.id === button.dataset.documentId);
  if (document) setFields(document);
});

elements.newDraftButton.addEventListener('click', () => {
  if (dirty && !window.confirm('Kaydedilmemiş değişiklikleriniz var. Yeni taslağa geçilsin mi?')) return;
  setFields();
  elements.titleInput.focus();
  setStatus('Yeni taslak hazır. Başlığı ve metinleri ekleyip kaydedin.');
});

elements.outlineButton.addEventListener('click', () => {
  const outline = makeOutline(elements.sourceInput.value);
  if (!outline) {
    setStatus('Önce kaynak bülteni ekleyin.', true);
    elements.sourceInput.focus();
    return;
  }
  elements.outlineInput.value = outline;
  setDirty(true);
  updateActions();
  setStatus('Olay örgüsü notları oluşturuldu. İsterseniz şimdi taslak alanına aktarın.');
});

elements.saveButton.addEventListener('click', async () => {
  const fields = currentFields();
  if (!fields.title) {
    elements.titleInput.focus();
    setStatus('Kaydetmeden önce taslağa bir başlık verin.', true);
    return;
  }
  loading = true;
  elements.saveButton.disabled = true;
  setStatus('Taslak güvenli veritabanına kaydediliyor…');
  try {
    const result = activeDocumentId
      ? await apiRequest('PUT', { ...fields, id: activeDocumentId })
      : await apiRequest('POST', fields);
    const saved = result.document;
    activeDocumentId = saved.id;
    documents = [saved, ...documents.filter((document) => document.id !== saved.id)].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    setDirty(false);
    renderDocuments();
    setStatus('Taslak hesabınıza kaydedildi.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    loading = false;
    updateActions();
  }
});

elements.copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.draftInput.value);
    setStatus('Kurgu taslağı panoya kopyalandı.');
  } catch {
    setStatus('Pano erişimi yok. Taslağı seçip elle kopyalayabilirsiniz.', true);
  }
});

elements.downloadButton.addEventListener('click', () => {
  const title = elements.titleInput.value.trim() || 'kurgu-taslagi';
  const safeName = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'kurgu-taslagi';
  const url = URL.createObjectURL(new Blob([elements.draftInput.value], { type: 'text/plain;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `${safeName}.txt` });
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Metin dosyası indirildi.');
});

elements.deleteButton.addEventListener('click', async () => {
  if (!activeDocumentId || !window.confirm('Bu taslağı kalıcı olarak silmek istiyor musunuz?')) return;
  loading = true;
  updateActions();
  try {
    await apiRequest('DELETE', null, activeDocumentId);
    documents = documents.filter((document) => document.id !== activeDocumentId);
    setFields(documents[0] || null);
    setStatus('Taslak silindi.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    loading = false;
    updateActions();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

authApi = null;
handleAuth();
