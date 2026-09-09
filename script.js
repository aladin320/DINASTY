// ---------- Small helpers ----------
function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
}

function initials(name) {
  return name.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || '?';
}

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}`);
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `POST ${url} failed with ${res.status}`);
  }
  return res.json();
}

// ---------- Like button (persisted via /api/hero) ----------
const likeBtn = document.getElementById('likeBtn');
const likeCount = document.getElementById('likeCount');
let liked = false;
let likeBusy = false;

likeBtn.addEventListener('click', async () => {
  if (likeBusy) return;
  likeBusy = true;

  const nextLiked = !liked;
  const previousCount = parseInt(likeCount.textContent, 10);

  // Optimistic UI update, rolled back if the request fails.
  liked = nextLiked;
  likeBtn.classList.toggle('liked', liked);
  likeCount.textContent = previousCount + (nextLiked ? 1 : -1);

  try {
    const { likes } = await apiPost('/api/hero/like', { liked: nextLiked });
    likeCount.textContent = likes;
  } catch (err) {
    console.error('Like failed:', err);
    liked = !nextLiked;
    likeBtn.classList.toggle('liked', liked);
    likeCount.textContent = previousCount;
  } finally {
    likeBusy = false;
  }
});

// ---------- Comments (hero engagement bar) — persisted via /api/hero/comments ----------
const postCommentBtn = document.getElementById('postCommentBtn');
const commentInput = document.getElementById('commentInput');
const commentList = document.getElementById('commentList');
const commentCount = document.getElementById('commentCount');

function updateCommentCount() {
  const count = commentList.querySelectorAll('.comment').length;
  commentCount.textContent = `${count} comment${count === 1 ? '' : 's'}`;
}

function renderHeroComment(c, { prepend = false } = {}) {
  const item = document.createElement('div');
  item.className = 'comment';
  item.innerHTML = `
    <div class="avatar">${initials(c.author)}</div>
    <div class="comment-body">
      <div class="comment-top">
        <span class="comment-author"></span>
        <span class="comment-time"></span>
      </div>
      <p class="comment-text"></p>
    </div>`;
  item.querySelector('.comment-author').textContent = c.author;
  item.querySelector('.comment-time').textContent = timeAgo(c.created_at);
  item.querySelector('.comment-text').textContent = c.text;
  if (prepend) commentList.prepend(item); else commentList.appendChild(item);
}

async function loadHero() {
  try {
    const { likes, comments } = await apiGet('/api/hero');
    likeCount.textContent = likes;
    commentList.innerHTML = '';
    comments.forEach(c => renderHeroComment(c));
    updateCommentCount();
  } catch (err) {
    console.error('Failed to load hero data:', err);
  }
}

postCommentBtn.addEventListener('click', async () => {
  const text = commentInput.value.trim();
  if (!text) return;
  postCommentBtn.disabled = true;
  try {
    const saved = await apiPost('/api/hero/comments', { author: 'You', text });
    renderHeroComment(saved, { prepend: true });
    commentInput.value = '';
    updateCommentCount();
  } catch (err) {
    console.error('Failed to post comment:', err);
  } finally {
    postCommentBtn.disabled = false;
  }
});

// ---------- AI catalog info ----------
// Static app configuration (not user-generated content), so it stays in
// the frontend rather than the database. Base facts shown in the picker's
// detail view (how it works / why choose it). A few entries also carry
// extended "guide" content (bestFor, guide.*) used by the Docs tool pages
// further down this file.
const AI_INFO = {
  claude: {
    name: "Claude", vendor: "Anthropic", category: "writing", url: "https://claude.ai",
    how: "A large language model by Anthropic, strong at writing, reasoning, and following detailed instructions, with a large context window for long documents.",
    why: "Best when you need careful reasoning, nuanced writing, or to work through long files safely.",
    bestFor: ["Writing", "Research", "Analysis", "Brainstorming"],
    guide: {
      overview: "Claude can help users write, analyze information, summarize documents and reason through complex problems.",
      gettingStarted: "Start with a clear request and provide the necessary context.",
      tips: ["Give Claude enough context.", "Describe the desired output.", "Break complex tasks into smaller steps."]
    }
  },
  gpt: { name: "GPT-5", vendor: "OpenAI", category: "writing", url: "https://chatgpt.com", how: "OpenAI's flagship model, good at general problem-solving, coding, and multimodal tasks like image understanding.", why: "A strong all-rounder with wide plugin and tool support." },
  gemini: { name: "Gemini", vendor: "Google", category: "productivity", url: "https://gemini.google.com", how: "Google's model, tightly integrated with Search, Docs, and Google Workspace.", why: "Great if your work already lives in Gmail, Docs, or Sheets." },
  llama: { name: "Llama", vendor: "Meta", category: "coding", url: "https://llama.meta.com", how: "Meta's open-weight model family that can run on your own infrastructure.", why: "Choose it for privacy, customization, or running models locally." },
  mistral: { name: "Mistral", vendor: "Mistral AI", category: "coding", url: "https://mistral.ai", how: "A fast, efficient open-weight model line from Mistral AI.", why: "Good balance of speed and cost for lightweight tasks." },
  grok: { name: "Grok", vendor: "xAI", category: "research", url: "https://x.ai/grok", how: "xAI's model, integrated with X (Twitter) for real-time trends and conversation.", why: "Useful for real-time social context and casual research." },
  perplexity: { name: "Perplexity", vendor: "Research", category: "research", url: "https://www.perplexity.ai", how: "An AI search engine that answers questions with cited sources pulled live from the web.", why: "Best for fast fact-finding with sources you can verify." },
  deepseek: { name: "DeepSeek", vendor: "DeepSeek AI", category: "coding", url: "https://www.deepseek.com", how: "An open-weight reasoning-focused model known for strong performance on coding and math.", why: "Good low-cost option for technical and analytical tasks." },
  cohere: { name: "Command", vendor: "Cohere", category: "business", url: "https://cohere.com", how: "Enterprise-focused language models built for retrieval and business search.", why: "Choose it for building search or Q&A over your own company data." },
  "ms-copilot": { name: "Copilot", vendor: "Microsoft", category: "productivity", url: "https://copilot.microsoft.com", how: "Microsoft's assistant embedded across Word, Excel, and Teams.", why: "Ideal if your workspace runs on Microsoft 365." },
  "gh-copilot": { name: "GitHub Copilot", vendor: "GitHub", category: "coding", url: "https://github.com/features/copilot", how: "An AI pair programmer built into your code editor that suggests code as you type.", why: "Best for speeding up day-to-day coding inside your IDE." },
  cursor: {
    name: "Cursor", vendor: "Anysphere", category: "coding", url: "https://cursor.com",
    how: "An AI-powered code editor designed around intelligent coding assistance and agent workflows.",
    why: "Useful when you want AI deeply integrated into your development environment.",
    bestFor: ["Coding", "Refactoring", "Agents", "Codebase work"]
  },
  windsurf: {
    name: "Windsurf", vendor: "Windsurf", category: "coding", url: "https://windsurf.com",
    how: "An AI-powered development environment combining coding assistance with agentic workflows.",
    why: "Useful for developers who want AI assistance throughout the coding process.",
    bestFor: ["Coding", "Agents", "Refactoring"]
  },
  zed: {
    name: "Zed", vendor: "Zed Industries", category: "coding", url: "https://zed.dev",
    how: "A fast modern code editor with AI-assisted development capabilities.",
    why: "A good choice when speed and a modern developer experience are priorities.",
    bestFor: ["Fast coding", "AI assistance", "Collaboration"]
  },
  "notion-ai": { name: "Notion AI", vendor: "Notion", category: "productivity", url: "https://www.notion.com/product/ai", how: "An assistant built into Notion for drafting, summarizing, and organizing notes.", why: "Choose it if your docs and project notes already live in Notion." },
  notebooklm: { name: "NotebookLM", vendor: "Google", category: "research", url: "https://notebooklm.google", how: "Google's research tool that answers questions grounded only in documents you upload.", why: "Great for deep research on a specific set of sources without hallucination risk." },
  elicit: { name: "Elicit", vendor: "Research", category: "research", url: "https://elicit.com", how: "A research assistant that searches academic papers and extracts key findings into tables.", why: "Best for literature reviews and comparing study results." },
  consensus: { name: "Consensus", vendor: "Research", category: "research", url: "https://consensus.app", how: "A search engine that finds and summarizes findings from peer-reviewed research.", why: "Good for quickly checking what science says about a claim." },
  scite: { name: "Scite", vendor: "Research", category: "research", url: "https://scite.ai", how: "Shows how a paper has been cited elsewhere — supporting, contrasting, or just mentioning it.", why: "Useful for judging how reliable a research paper actually is." },
  "semantic-scholar": { name: "Semantic Scholar", vendor: "AI2", category: "research", url: "https://www.semanticscholar.org", how: "An academic search engine with AI-generated summaries and citation graphs.", why: "Good free option for exploring a research field broadly." },
  researchrabbit: { name: "ResearchRabbit", vendor: "Research", category: "research", url: "https://www.researchrabbit.ai", how: "Visualizes connections between papers and authors as an explorable network.", why: "Helpful for discovering related work you wouldn't find by keyword search." },
  scholarcy: { name: "Scholarcy", vendor: "Research", category: "research", url: "https://www.scholarcy.com", how: "Automatically summarizes academic papers into short digestible briefs.", why: "Saves time when you need the gist of many papers quickly." },
  explainpaper: { name: "Explainpaper", vendor: "Research", category: "education", url: "https://www.explainpaper.com", how: "Lets you highlight confusing parts of a paper and get a plain-language explanation.", why: "Good for reading dense papers outside your field." },
  humata: { name: "Humata", vendor: "Docs AI", category: "productivity", url: "https://www.humata.ai", how: "Lets you chat with long PDFs and get answers with page citations.", why: "Useful for extracting answers from long reports or contracts." },
  chatpdf: { name: "ChatPDF", vendor: "Docs AI", category: "productivity", url: "https://www.chatpdf.com", how: "A simple chat interface for asking questions about an uploaded PDF.", why: "Quick and lightweight for one-off document Q&A." },
  otter: { name: "Otter.ai", vendor: "Meetings", category: "productivity", url: "https://otter.ai", how: "Transcribes meetings live and summarizes action items automatically.", why: "Best for teams that want searchable meeting notes." },
  fireflies: { name: "Fireflies", vendor: "Meetings", category: "productivity", url: "https://fireflies.ai", how: "Records and transcribes calls, then syncs notes to your other apps.", why: "Good if you need meeting notes pushed into a CRM or task tool." },
  jasper: { name: "Jasper", vendor: "Writing", category: "marketing", url: "https://www.jasper.ai", how: "A writing assistant tuned for marketing copy and brand voice.", why: "Choose it for on-brand marketing content at scale." },
  copyai: { name: "Copy.ai", vendor: "Writing", category: "marketing", url: "https://www.copy.ai", how: "Generates marketing and sales copy from short prompts and templates.", why: "Fast for producing first drafts of ads or emails." },
  writesonic: { name: "Writesonic", vendor: "Writing", category: "marketing", url: "https://writesonic.com", how: "An AI writer for blog posts, ads, and product descriptions.", why: "Good for high-volume content production." },
  grammarly: { name: "Grammarly", vendor: "Writing", category: "writing", url: "https://www.grammarly.com", how: "Checks grammar, tone, and clarity as you write, across most apps.", why: "Best as a background editor rather than a content generator." },
  deepl: { name: "DeepL", vendor: "Translation", category: "writing", url: "https://www.deepl.com", how: "A translation engine known for more natural phrasing than typical machine translation.", why: "Choose it when translation quality matters more than speed." },
  midjourney: {
    name: "Midjourney", vendor: "Midjourney", category: "image", url: "https://www.midjourney.com",
    how: "Generates highly stylized images from text prompts.",
    why: "Best for artistic or concept visuals.",
    bestFor: ["Concept art", "Creative visuals", "Marketing images", "Design inspiration"],
    guide: {
      overview: "Midjourney generates images from natural-language descriptions.",
      gettingStarted: "Write a prompt describing the subject, style, composition and desired visual characteristics.",
      tips: ["Describe the subject clearly.", "Specify the visual style.", "Describe lighting and composition."]
    }
  },
  dalle: { name: "DALL·E", vendor: "OpenAI", category: "image", url: "https://chatgpt.com", how: "OpenAI's image generator, integrated directly into ChatGPT.", why: "Convenient if you're already working inside ChatGPT." },
  "stable-diffusion": { name: "Stable Diffusion", vendor: "Stability AI", category: "image", url: "https://stability.ai", how: "An open-weight image generator you can run and fine-tune yourself.", why: "Choose it for full control or running locally." },
  runway: { name: "Runway", vendor: "Video", category: "video", url: "https://runwayml.com", how: "AI video generation and editing tools, including text-to-video.", why: "Best for quick video content or effects without a full production pipeline." },
  elevenlabs: { name: "ElevenLabs", vendor: "Voice", category: "voice", url: "https://elevenlabs.io", how: "Generates realistic AI voices and can clone a voice from a sample.", why: "Good for voiceovers, narration, or accessibility features." },
  synthesia: { name: "Synthesia", vendor: "Video", category: "video", url: "https://www.synthesia.io", how: "Turns text scripts into videos with an AI avatar presenter.", why: "Useful for training videos without filming anyone." },
  "zapier-ai": { name: "Zapier AI", vendor: "Automation", category: "automation", url: "https://zapier.com/ai", how: "Connects your apps and uses AI to build automated workflows between them.", why: "Best for automating repetitive tasks across tools you already use." },
  glean: { name: "Glean", vendor: "Workspace search", category: "business", url: "https://www.glean.com", how: "An AI search layer over your company's internal tools and documents.", why: "Choose it to find internal information fast across many apps." },
  harvey: { name: "Harvey", vendor: "Legal AI", category: "business", url: "https://www.harvey.ai", how: "A legal-specific AI trained for contract review and legal research.", why: "Best for legal teams needing domain-specific accuracy." },
  you: { name: "You.com", vendor: "Search AI", category: "research", url: "https://you.com", how: "A search engine with an AI assistant that cites its sources.", why: "Good alternative to traditional search with built-in summarization." },
  poe: { name: "Poe", vendor: "Quora", category: "productivity", url: "https://poe.com", how: "A single app that gives access to many different AI models in one place.", why: "Useful if you want to compare answers from several models quickly." },
  "claude-code": {
    name: "Claude Code", vendor: "Anthropic", category: "coding", url: "https://claude.com/product/claude-code",
    how: "An AI coding agent that can read, write and work with code in a project.",
    why: "Best when you want an AI to work directly in your codebase, not just chat.",
    bestFor: ["Coding", "Debugging", "Refactoring", "Codebase analysis"],
    guide: {
      overview: "Claude Code can work with an existing codebase and help developers understand, modify and create code.",
      gettingStarted: "Open your project and give the agent a clear development task.",
      tips: ["Describe the desired behavior.", "Give the agent relevant project context.", "Review generated code before applying changes."]
    }
  },
  suno: { name: "Suno", vendor: "Music", category: "music", url: "https://suno.com", how: "Generates full songs — vocals, lyrics, and instrumentation — from a text prompt.", why: "Best for quickly producing original music without instruments or a studio." },
  uizard: { name: "Uizard", vendor: "App design", category: "design", url: "https://uizard.io", how: "Turns sketches or text prompts into clickable app and website mockups.", why: "Choose it to go from idea to prototype fast, without a designer." }
};

/* =========================================================
   DEV AI
========================================================= */

const DEV_AI_CATEGORIES = {
  "coding-assistant": { title: "AI Coding Assistants", tools: ["gh-copilot", "claude-code", "gpt", "deepseek"] },
  "code-editor": { title: "AI Code Editors", tools: ["cursor", "windsurf", "zed"] },
  "debugging": { title: "AI Debugging", tools: ["claude-code", "gpt", "deepseek"] },
  "code-generation": { title: "Code Generation", tools: ["claude-code", "gpt", "deepseek", "mistral"] },
  "code-review": { title: "AI Code Review", tools: ["gh-copilot", "claude-code"] },
  "agents": { title: "AI Agents", tools: ["claude-code", "cursor", "gpt"] },
  "terminal": { title: "Terminal / CLI AI", tools: ["claude-code", "gpt"] },
  "testing": { title: "AI Testing", tools: ["claude-code", "gpt"] },
  "documentation": { title: "AI Documentation", tools: ["claude", "gpt", "claude-code"] },
  "devops": { title: "DevOps / Cloud AI", tools: ["gpt", "claude", "gemini"] }
};

function getAiInfo(key) {
  return AI_INFO[key] || { name: key, vendor: "", how: "Details coming soon.", why: "Details coming soon.", category: "", url: null };
}

const CATEGORY_LABELS = {
  writing: "Writing", image: "Image Generation", video: "Video", music: "Music",
  coding: "Coding", productivity: "Productivity", education: "Education",
  research: "Research", marketing: "Marketing", business: "Business",
  automation: "Automation", voice: "Voice", design: "Design"
};

// The single best-fit AI shown immediately when someone picks a goal.
const CATEGORY_BEST = {
  writing: "claude", image: "midjourney", video: "runway", music: "suno",
  coding: "claude-code", productivity: "notion-ai", education: "explainpaper",
  research: "perplexity", marketing: "jasper", business: "glean",
  automation: "zapier-ai", voice: "elevenlabs", design: "uizard"
};

let currentCategory = null;

// ---------- AI performance reviews (persisted via /api/reviews/:aiKey) ----------
function renderReviews(reviews) {
  const list = document.getElementById('reviewList');
  const summary = document.getElementById('reviewSummary');

  if (reviews.length === 0) {
    summary.textContent = 'No reviews yet';
    list.innerHTML = '<p class="review-empty">Be the first to say how it performed.</p>';
    return;
  }

  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  summary.textContent = `${avg.toFixed(1)} ★ · ${reviews.length} review${reviews.length === 1 ? '' : 's'}`;

  list.innerHTML = '';
  reviews.forEach(r => {
    const item = document.createElement('div');
    item.className = 'review-item';
    item.innerHTML = `
      <div class="review-top">
        <span class="comment-author"></span>
        <span class="review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
        <span class="comment-time"></span>
      </div>
      <p class="comment-text"></p>`;
    item.querySelector('.comment-author').textContent = r.author;
    item.querySelector('.comment-time').textContent = timeAgo(r.created_at);
    item.querySelector('.comment-text').textContent = r.text;
    list.appendChild(item);
  });
}

async function loadReviews(aiKey) {
  const list = document.getElementById('reviewList');
  const summary = document.getElementById('reviewSummary');
  summary.textContent = '';
  list.innerHTML = '<p class="review-empty">Loading reviews…</p>';
  try {
    const reviews = await apiGet(`/api/reviews/${encodeURIComponent(aiKey)}`);
    renderReviews(reviews);
  } catch (err) {
    console.error('Failed to load reviews:', err);
    list.innerHTML = '<p class="review-empty">Couldn\'t load reviews right now.</p>';
  }
}

const starInput = document.getElementById('starInput');
const reviewInput = document.getElementById('reviewInput');
const postReviewBtn = document.getElementById('postReviewBtn');

function setStarRating(value) {
  starInput.dataset.rating = value;
  starInput.querySelectorAll('.star').forEach(star => {
    star.classList.toggle('filled', Number(star.dataset.value) <= value);
  });
}

starInput.addEventListener('click', (e) => {
  const star = e.target.closest('.star');
  if (!star) return;
  setStarRating(Number(star.dataset.value));
});

postReviewBtn.addEventListener('click', async () => {
  const text = reviewInput.value.trim();
  const rating = Number(starInput.dataset.rating);
  if (!text || !rating || !selectedAI) return;

  postReviewBtn.disabled = true;
  try {
    await apiPost(`/api/reviews/${encodeURIComponent(selectedAI)}`, { author: 'You', rating, text });
    await loadReviews(selectedAI);
    reviewInput.value = '';
    setStarRating(0);
  } catch (err) {
    console.error('Failed to post review:', err);
  } finally {
    postReviewBtn.disabled = false;
  }
});

// ---------- Modal accessibility: focus trap + focus restore ----------
let lastFocusedBeforeModal = null;

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

function handleModalTabKey(overlay, e) {
  if (e.key !== 'Tab') return;
  const focusables = getFocusableElements(overlay);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function onModalOpen(overlay, { autoFocus = true } = {}) {
  lastFocusedBeforeModal = document.activeElement;
  overlay._trapHandler = (e) => handleModalTabKey(overlay, e);
  overlay.addEventListener('keydown', overlay._trapHandler);

  if (autoFocus) {
    requestAnimationFrame(() => {
      const focusables = getFocusableElements(overlay);
      if (focusables.length) focusables[0].focus();
    });
  }
}

function onModalClose(overlay) {
  if (overlay._trapHandler) {
    overlay.removeEventListener('keydown', overlay._trapHandler);
    overlay._trapHandler = null;
  }
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
    lastFocusedBeforeModal.focus();
  }
  lastFocusedBeforeModal = null;
}

// ---------- Sign-in modal: browse by goal or search by name ----------
const signInBtn = document.getElementById('signInBtn');
const signInOverlay = document.getElementById('signInOverlay');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalSubtext = document.getElementById('modalSubtext');
const aiSearch = document.getElementById('aiSearch');
const aiGrid = document.getElementById('aiGrid');
const aiDetail = document.getElementById('aiDetail');
const detailBackBtn = document.getElementById('detailBackBtn');
const detailMark = document.getElementById('detailMark');
const detailName = document.getElementById('detailName');
const detailVendor = document.getElementById('detailVendor');
const detailHow = document.getElementById('detailHow');
const detailWhy = document.getElementById('detailWhy');
const requestSelectBtn = document.getElementById('requestSelectBtn');
const confirmBox = document.getElementById('confirmBox');
const confirmText = document.getElementById('confirmText');
const confirmYesBtn = document.getElementById('confirmYesBtn');
const confirmNoBtn = document.getElementById('confirmNoBtn');

let selectedAI = null;

function filterGridByCategory(category) {
  document.querySelectorAll('.ai-option').forEach(opt => {
    const match = !category || opt.dataset.category === category;
    opt.classList.toggle('hidden', !match);
  });
}

function resetGridView() {
  aiDetail.classList.remove('open');
  aiGrid.classList.remove('hidden-view');
  aiSearch.classList.remove('hidden-view');
  confirmBox.classList.remove('open');
}

function openSignInModal(category) {
  currentCategory = category || null;
  aiSearch.value = '';
  filterGridByCategory(currentCategory);
  resetGridView();
  signInOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  onModalOpen(signInOverlay);

  if (!currentCategory) {
    modalSubtext.textContent = "Pick the model that powers your workspace. You can change this later in settings.";
    return;
  }

  const bestKey = CATEGORY_BEST[currentCategory];
  const bestOption = bestKey && aiGrid.querySelector(`.ai-option[data-ai="${bestKey}"]`);
  const label = CATEGORY_LABELS[currentCategory];

  if (bestOption) {
    modalSubtext.textContent = `Here's the best fit for ${label}.`;
    showDetail(bestOption);
    detailBackBtn.textContent = `← See other ${label} tools`;
  } else {
    modalSubtext.textContent = label
      ? `Showing tools for ${label}. Pick the one that fits your project.`
      : "Browse the full catalog and pick the one that fits your project.";
  }
}

function closeSignInModal() {
  signInOverlay.classList.remove('open');
  document.body.style.overflow = '';
  onModalClose(signInOverlay);
}

signInBtn.addEventListener('click', () => openSignInModal(null));
modalCloseBtn.addEventListener('click', closeSignInModal);

signInOverlay.addEventListener('click', (e) => {
  if (e.target === signInOverlay) closeSignInModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && signInOverlay.classList.contains('open')) closeSignInModal();
});

aiSearch.addEventListener('input', () => {
  const q = aiSearch.value.trim().toLowerCase();
  document.querySelectorAll('.ai-option').forEach(opt => {
    const name = opt.querySelector('.ai-name').textContent.toLowerCase();
    const vendor = opt.querySelector('.ai-vendor').textContent.toLowerCase();
    opt.classList.toggle('hidden', Boolean(q) && !name.includes(q) && !vendor.includes(q));
  });
});

// "Dev AI" isn't a real catalog category — it scrolls to the dedicated
// Dev AI section instead of opening an empty modal.
document.querySelectorAll('.category-card').forEach(card => {
  card.addEventListener('click', () => {
    if (card.dataset.category === 'dev-ai') {
      const devAiSectionEl = document.getElementById('devAiSection');
      if (devAiSectionEl) devAiSectionEl.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    openSignInModal(card.dataset.category);
  });
});

const productQuoteBtn = document.getElementById('productQuoteBtn');
const productTryBtn = document.getElementById('productTryBtn');
if (productQuoteBtn) productQuoteBtn.addEventListener('click', () => requestQuoteBtn.click());
if (productTryBtn) productTryBtn.addEventListener('click', () => openSignInModal(null));

function showDetail(option) {
  selectedAI = option.dataset.ai;
  const name = option.querySelector('.ai-name').textContent;
  const vendor = option.querySelector('.ai-vendor').textContent;
  const markStyle = option.querySelector('.ai-mark').getAttribute('style');
  const markLetter = option.querySelector('.ai-mark').textContent;
  const info = getAiInfo(selectedAI);

  detailMark.setAttribute('style', markStyle);
  detailMark.textContent = markLetter;
  detailName.textContent = name;
  detailVendor.textContent = vendor;
  detailHow.textContent = info.how;
  detailWhy.textContent = info.why;
  confirmText.textContent = `This opens ${name}'s site in a new tab — continue?`;
  confirmBox.classList.remove('open');

  reviewInput.value = '';
  setStarRating(0);
  loadReviews(selectedAI);

  aiGrid.classList.add('hidden-view');
  aiSearch.classList.add('hidden-view');
  aiDetail.classList.add('open');
}

// Opens the sign-in modal directly to one AI's detail view, whether or not
// that AI has a matching .ai-option button in the catalog grid (e.g. tools
// only listed under Dev AI).
function openAiDetailModal(aiKey) {
  currentCategory = null;
  aiSearch.value = '';
  filterGridByCategory(null);
  signInOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  onModalOpen(signInOverlay);

  const option = aiGrid.querySelector(`.ai-option[data-ai="${aiKey}"]`);
  if (option) {
    showDetail(option);
  } else {
    const info = getAiInfo(aiKey);
    selectedAI = aiKey;
    detailMark.setAttribute('style', '--c:#5C7C6C');
    detailMark.textContent = info.name.charAt(0).toUpperCase();
    detailName.textContent = info.name;
    detailVendor.textContent = info.vendor;
    detailHow.textContent = info.how;
    detailWhy.textContent = info.why;
    confirmText.textContent = `This opens ${info.name}'s site in a new tab — continue?`;
    confirmBox.classList.remove('open');
    reviewInput.value = '';
    setStarRating(0);
    loadReviews(selectedAI);
    aiGrid.classList.add('hidden-view');
    aiSearch.classList.add('hidden-view');
    aiDetail.classList.add('open');
  }
  modalSubtext.textContent = "Here's what you picked.";
  detailBackBtn.textContent = '← Back to list';
}

aiGrid.addEventListener('click', (e) => {
  const option = e.target.closest('.ai-option');
  if (!option) return;
  showDetail(option);
  detailBackBtn.textContent = '← Back to list';
});

detailBackBtn.addEventListener('click', resetGridView);

requestSelectBtn.addEventListener('click', () => {
  confirmBox.classList.add('open');
});

confirmNoBtn.addEventListener('click', () => {
  confirmBox.classList.remove('open');
});

confirmYesBtn.addEventListener('click', () => {
  const info = getAiInfo(selectedAI);
  confirmBox.classList.remove('open');
  closeSignInModal();

  if (info.url) {
    window.open(info.url, '_blank', 'noopener,noreferrer');
  } else {
    console.warn('No destination URL configured for AI:', selectedAI);
  }
});

// ---------- Request a quote modal (persisted via /api/quote) ----------
const requestQuoteBtn = document.getElementById('requestQuoteBtn');
const quoteOverlay = document.getElementById('quoteOverlay');
const quoteCloseBtn = document.getElementById('quoteCloseBtn');
const quoteForm = document.getElementById('quoteForm');
const quoteSuccess = document.getElementById('quoteSuccess');

function openQuoteModal() {
  quoteOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  quoteForm.style.display = '';
  quoteSuccess.classList.remove('open');
  quoteSuccess.querySelector('p').textContent = "Thanks — your request has been sent. We'll be in touch shortly.";
  onModalOpen(quoteOverlay);
}

function closeQuoteModal() {
  quoteOverlay.classList.remove('open');
  document.body.style.overflow = '';
  onModalClose(quoteOverlay);
}

requestQuoteBtn.addEventListener('click', openQuoteModal);
quoteCloseBtn.addEventListener('click', closeQuoteModal);

quoteOverlay.addEventListener('click', (e) => {
  if (e.target === quoteOverlay) closeQuoteModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && quoteOverlay.classList.contains('open')) closeQuoteModal();
});

quoteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(quoteForm).entries());
  const submitBtn = quoteForm.querySelector('.quote-submit');
  submitBtn.disabled = true;

  try {
    await apiPost('/api/quote', data);
    quoteForm.style.display = 'none';
    quoteSuccess.classList.add('open');
    quoteForm.reset();
  } catch (err) {
    console.error('Failed to submit quote request:', err);
    quoteSuccess.querySelector('p').textContent = "Something went wrong sending your request — please try again.";
    quoteSuccess.classList.add('open');
    quoteForm.style.display = 'none';
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- AI Agent: real, model-backed onboarding guide ----------
const agentOverlay = document.getElementById('agentOverlay');
const agentCloseBtn = document.getElementById('agentCloseBtn');
const agentMessages = document.getElementById('agentMessages');
const agentQuickReplies = document.getElementById('agentQuickReplies');
const agentInput = document.getElementById('agentInput');
const agentSendBtn = document.getElementById('agentSendBtn');
const aiAgentBtn = document.getElementById('aiAgentBtn');

const AGENT_API_URL = '/api/agent-chat';

const AGENT_STARTER_PROMPTS = [
  'How do I find the right AI for my goal?',
  'How do performance reviews work?',
  "What's the Community section?",
  'How do I request a quote?'
];

let agentStarted = false;
let agentBusy = false;
let agentHistory = [];

function scrollAgentToBottom() {
  agentMessages.scrollTop = agentMessages.scrollHeight;
}

function addAgentMessage(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `agent-msg ${role}`;
  bubble.textContent = text;
  agentMessages.appendChild(bubble);
  scrollAgentToBottom();
  return bubble;
}

function showAgentTyping() {
  const typing = document.createElement('div');
  typing.className = 'agent-msg bot typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  agentMessages.appendChild(typing);
  scrollAgentToBottom();
  return typing;
}

function renderAgentStarters() {
  agentQuickReplies.innerHTML = '';
  AGENT_STARTER_PROMPTS.forEach(prompt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-reply-btn';
    btn.textContent = prompt;
    btn.addEventListener('click', () => sendAgentMessage(prompt));
    agentQuickReplies.appendChild(btn);
  });
}

function renderAgentFollowUp() {
  agentQuickReplies.innerHTML = '';
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'quick-reply-btn';
  moreBtn.textContent = 'Suggest a question';
  moreBtn.addEventListener('click', renderAgentStarters);
  agentQuickReplies.appendChild(moreBtn);
}

function setAgentInputEnabled(enabled) {
  agentInput.disabled = !enabled;
  agentSendBtn.disabled = !enabled;
}

async function sendAgentMessage(text) {
  const trimmed = text.trim();
  if (agentBusy || !trimmed) return;

  agentBusy = true;
  setAgentInputEnabled(false);
  agentQuickReplies.innerHTML = '';

  addAgentMessage('user', trimmed);
  agentHistory.push({ role: 'user', content: trimmed });

  const typing = showAgentTyping();

  try {
    const res = await fetch(AGENT_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: agentHistory })
    });

    if (!res.ok) throw new Error(`Agent backend responded with ${res.status}`);

    const data = await res.json();
    typing.remove();

    const reply = data.reply || "Sorry, I didn't get a reply that time — try again?";
    addAgentMessage('bot', reply);
    agentHistory.push({ role: 'assistant', content: reply });
  } catch (err) {
    typing.remove();
    addAgentMessage(
      'bot',
      "I can't reach the AI backend right now. Make sure the server is running and you're viewing this page through it (e.g. http://localhost:3000), not opened as a local file."
    );
    console.error('Agent chat error:', err);
  } finally {
    agentBusy = false;
    setAgentInputEnabled(true);
    renderAgentFollowUp();
    agentInput.focus();
  }
}

function openAgentModal() {
  agentOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  onModalOpen(agentOverlay, { autoFocus: false });

  if (!agentStarted) {
    agentStarted = true;
    addAgentMessage('bot', "Hi! I'm the DINASTY guide. Ask me anything — about using this platform or anything else — or pick a question below to get started.");
    renderAgentStarters();
  }

  agentInput.focus();
}

function closeAgentModal() {
  agentOverlay.classList.remove('open');
  document.body.style.overflow = '';
  onModalClose(agentOverlay);
}

aiAgentBtn.addEventListener('click', openAgentModal);
agentCloseBtn.addEventListener('click', closeAgentModal);
agentOverlay.addEventListener('click', (e) => {
  if (e.target === agentOverlay) closeAgentModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && agentOverlay.classList.contains('open')) closeAgentModal();
});

agentSendBtn.addEventListener('click', () => {
  const text = agentInput.value;
  agentInput.value = '';
  sendAgentMessage(text);
});
agentInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const text = agentInput.value;
    agentInput.value = '';
    sendAgentMessage(text);
  }
});

// ---------- Community: shared projects + comments (persisted via /api/projects) ----------
const projectGrid = document.getElementById('projectGrid');

async function renderProjectGrid() {
  let projects;
  try {
    projects = await apiGet('/api/projects');
  } catch (err) {
    console.error('Failed to load projects:', err);
    projectGrid.innerHTML = '<p class="review-empty">Couldn\'t load community projects right now.</p>';
    return;
  }

  projectGrid.innerHTML = '';
  projects.forEach(project => {
    const info = getAiInfo(project.aiKey);
    const card = document.createElement('button');
    card.className = 'project-card';
    card.dataset.projectId = project.id;
    card.innerHTML = `
      <div class="project-card-top">
        <span class="ai-mark project-ai-mark">${info.name.charAt(0)}</span>
        <span class="project-ai-name">${info.name}</span>
      </div>
      <h3 class="project-card-title"></h3>
      <p class="project-card-desc"></p>
      <div class="project-card-foot">
        <span class="project-card-author"></span>
        <span class="project-card-comments">${project.commentCount} comment${project.commentCount === 1 ? '' : 's'}</span>
      </div>`;
    card.querySelector('.project-card-title').textContent = project.title;
    card.querySelector('.project-card-desc').textContent = project.description;
    card.querySelector('.project-card-author').textContent = `by ${project.author}`;
    card.addEventListener('click', () => openProjectModal(project.id));
    projectGrid.appendChild(card);
  });
}

// ---------- Project detail modal ----------
const projectOverlay = document.getElementById('projectOverlay');
const projectCloseBtn = document.getElementById('projectCloseBtn');
const projectAiPill = document.getElementById('projectAiPill');
const projectDetailTitle = document.getElementById('projectDetailTitle');
const projectAuthorLine = document.getElementById('projectAuthorLine');
const projectDetailDesc = document.getElementById('projectDetailDesc');
const projectDetailLink = document.getElementById('projectDetailLink');
const projectCommentList = document.getElementById('projectCommentList');
const projectCommentInput = document.getElementById('projectCommentInput');
const postProjectCommentBtn = document.getElementById('postProjectCommentBtn');

let activeProjectId = null;

function renderProjectComments(comments) {
  projectCommentList.innerHTML = '';
  if (comments.length === 0) {
    projectCommentList.innerHTML = '<p class="review-empty">No comments yet — say what you think.</p>';
    return;
  }
  comments.forEach(c => {
    const item = document.createElement('div');
    item.className = 'comment';
    item.innerHTML = `
      <div class="avatar">${initials(c.author)}</div>
      <div class="comment-body">
        <div class="comment-top">
          <span class="comment-author"></span>
          <span class="comment-time"></span>
        </div>
        <p class="comment-text"></p>
      </div>`;
    item.querySelector('.comment-author').textContent = c.author;
    item.querySelector('.comment-time').textContent = timeAgo(c.created_at);
    item.querySelector('.comment-text').textContent = c.text;
    projectCommentList.appendChild(item);
  });
}

async function openProjectModal(id) {
  activeProjectId = id;
  projectCommentInput.value = '';
  projectCommentList.innerHTML = '<p class="review-empty">Loading…</p>';

  projectOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  onModalOpen(projectOverlay);

  try {
    const project = await apiGet(`/api/projects/${id}`);
    const info = getAiInfo(project.aiKey);

    projectAiPill.textContent = `Built with ${info.name}`;
    projectDetailTitle.textContent = project.title;
    projectAuthorLine.textContent = `by ${project.author}`;
    projectDetailDesc.textContent = project.description;

    if (project.link) {
      projectDetailLink.href = project.link;
      projectDetailLink.style.display = '';
    } else {
      projectDetailLink.style.display = 'none';
    }

    renderProjectComments(project.comments);
  } catch (err) {
    console.error('Failed to load project:', err);
    projectCommentList.innerHTML = '<p class="review-empty">Couldn\'t load this project right now.</p>';
  }
}

function closeProjectModal() {
  projectOverlay.classList.remove('open');
  document.body.style.overflow = '';
  activeProjectId = null;
  onModalClose(projectOverlay);
}

projectCloseBtn.addEventListener('click', closeProjectModal);
projectOverlay.addEventListener('click', (e) => {
  if (e.target === projectOverlay) closeProjectModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && projectOverlay.classList.contains('open')) closeProjectModal();
});

postProjectCommentBtn.addEventListener('click', async () => {
  const text = projectCommentInput.value.trim();
  if (!text || !activeProjectId) return;

  postProjectCommentBtn.disabled = true;
  try {
    await apiPost(`/api/projects/${activeProjectId}/comments`, { author: 'You', text });
    const project = await apiGet(`/api/projects/${activeProjectId}`);
    renderProjectComments(project.comments);
    projectCommentInput.value = '';
    renderProjectGrid(); // keep the grid's comment count in sync
  } catch (err) {
    console.error('Failed to post comment:', err);
  } finally {
    postProjectCommentBtn.disabled = false;
  }
});

// ---------- Share a project modal ----------
const shareProjectBtn = document.getElementById('shareProjectBtn');
const shareOverlay = document.getElementById('shareOverlay');
const shareCloseBtn = document.getElementById('shareCloseBtn');
const shareForm = document.getElementById('shareForm');
const shareSuccess = document.getElementById('shareSuccess');
const pAiSelect = document.getElementById('pAi');

// Populate the "AI you used" dropdown from the full catalog, alphabetically by name.
Object.keys(AI_INFO)
  .sort((a, b) => AI_INFO[a].name.localeCompare(AI_INFO[b].name))
  .forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = AI_INFO[key].name;
    pAiSelect.appendChild(opt);
  });

function openShareModal() {
  shareOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  shareForm.style.display = '';
  shareSuccess.classList.remove('open');
  onModalOpen(shareOverlay);
}

function closeShareModal() {
  shareOverlay.classList.remove('open');
  document.body.style.overflow = '';
  onModalClose(shareOverlay);
}

shareProjectBtn.addEventListener('click', openShareModal);
shareCloseBtn.addEventListener('click', closeShareModal);
shareOverlay.addEventListener('click', (e) => {
  if (e.target === shareOverlay) closeShareModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && shareOverlay.classList.contains('open')) closeShareModal();
});

shareForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(shareForm).entries());
  const submitBtn = shareForm.querySelector('.quote-submit');
  submitBtn.disabled = true;

  try {
    await apiPost('/api/projects', {
      title: data.title,
      author: data.author,
      aiKey: data.ai,
      description: data.description,
      link: data.link || ''
    });
    await renderProjectGrid();

    shareForm.style.display = 'none';
    shareSuccess.classList.add('open');
    shareForm.reset();

    setTimeout(closeShareModal, 1400);
  } catch (err) {
    console.error('Failed to share project:', err);
  } finally {
    submitBtn.disabled = false;
  }
});

// =========================================================
// DOCUMENTATION
// =========================================================

const docsOverlay = document.getElementById('docsOverlay');
const docsCloseBtn = document.getElementById('docsCloseBtn');
const docsBackBtn = document.getElementById('docsBackBtn');
const docsDetail = document.getElementById('docsDetail');
const docsGrid = document.querySelector('.docs-grid');
const docsPopular = document.querySelector('.docs-popular');
const docsDetailIcon = document.getElementById('docsDetailIcon');
const docsDetailLabel = document.getElementById('docsDetailLabel');
const docsDetailTitle = document.getElementById('docsDetailTitle');
const docsDetailText = document.getElementById('docsDetailText');
const docsDetailSections = document.getElementById('docsDetailSections');
const docsTools = document.getElementById('docsTools');
const docsCategories = document.getElementById('docsCategories');
const docsBtn = document.getElementById('docsBtn');

const DOCS_CONTENT = {
  documentation: {
    icon: "📖", label: "DOCUMENTATION", title: "Understand DINASTY",
    description: "Learn how DINASTY helps you discover, understand, and choose AI tools based on what you want to accomplish.",
    sections: [
      { title: "Getting Started", text: "Start by choosing a goal such as writing, coding, research, design, productivity, or automation. DINASTY then helps you identify AI tools that match that goal." },
      { title: "Discover AI Tools", text: "Explore AI tools by category instead of searching for a specific product name. This makes AI easier to understand for beginners and experienced users." },
      { title: "Tool Profiles", text: "Each AI tool can be explained through what it does, how it works, what it is best for, and why you might choose it." },
      { title: "AI Categories", text: "Explore AI across Writing, Image Generation, Video, Music, Coding, Productivity, Education, Research, Marketing, Business, Automation, Voice, and Design." }
    ]
  },
  learning: {
    icon: "🧠", label: "AI LEARNING", title: "Learn Artificial Intelligence",
    description: "Build your understanding of AI from fundamental concepts to modern generative AI systems.",
    sections: [
      { title: "AI Fundamentals", text: "Learn the basic ideas behind Artificial Intelligence, machine learning, models, data, and automated decision-making." },
      { title: "Generative AI", text: "Understand how AI can generate text, images, audio, video, code, and other types of content from instructions or prompts." },
      { title: "Prompt Engineering", text: "Learn how to communicate effectively with AI systems by writing clear instructions, providing context, defining constraints, and describing the desired result." },
      { title: "AI Agents", text: "Understand how AI agents can use tools, reason through tasks, and perform multiple steps toward a goal." },
      { title: "Responsible AI", text: "Learn about AI limitations, verification, privacy, bias, copyright, and responsible use of AI-generated information." }
    ]
  },
  guides: {
    icon: "🛠️", label: "TOOL GUIDES", title: "Learn How to Use AI Tools",
    description: "Practical guides that help you understand what AI tools do and how to use them effectively. Pick a category below to browse the tools in it.",
    sections: [
      { title: "AI Writing Tools", text: "Learn how AI can help with articles, emails, summaries, brainstorming, rewriting, translation, and content creation." },
      { title: "AI Coding Tools", text: "Discover how AI coding assistants can help generate code, explain code, debug problems, refactor projects, and accelerate development." },
      { title: "AI Image Tools", text: "Learn how text-to-image systems work and how to create better prompts for illustrations, concepts, marketing visuals, and UI inspiration." },
      { title: "AI Research Tools", text: "Learn how AI research assistants can help find information, summarize papers, organize sources, and explore a topic." },
      { title: "AI Productivity Tools", text: "Discover how AI can summarize meetings, organize information, automate repetitive work, and assist with everyday tasks." }
    ]
  },
  comparisons: {
    icon: "⚖️", label: "AI COMPARISONS", title: "Compare AI Tools",
    description: "Compare AI products based on their purpose, capabilities, usability, pricing, and strengths.",
    sections: [
      { title: "Chat & Writing", text: "Compare general AI assistants and writing tools based on writing quality, reasoning, context handling, research capabilities, and workflow integration." },
      { title: "Coding", text: "Compare AI coding assistants based on code generation, debugging, IDE integration, repository understanding, and developer workflow." },
      { title: "Image Generation", text: "Compare image generation tools based on visual quality, prompt control, style, editing capabilities, and creative flexibility." },
      { title: "Video", text: "Compare AI video platforms based on generation quality, editing features, avatars, animation, and production workflows." },
      { title: "Research", text: "Compare AI research tools based on source quality, citations, academic coverage, summarization, and research workflows." }
    ]
  }
};

function openDocs() {
  docsOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  onModalOpen(docsOverlay);
  showDocsHome();
}

function closeDocs() {
  docsOverlay.classList.remove('open');
  document.body.style.overflow = '';
  onModalClose(docsOverlay);
}

function showDocsHome() {
  docsGrid.classList.remove('hidden');
  docsPopular.classList.remove('hidden');
  docsDetail.classList.remove('open');
  docsCategories.innerHTML = '';
  docsTools.innerHTML = '';
}

function showDocsDetail(type) {
  const content = DOCS_CONTENT[type];
  if (!content) return;

  docsGrid.classList.add('hidden');
  docsPopular.classList.add('hidden');
  docsDetail.classList.add('open');

  docsDetailIcon.textContent = content.icon;
  docsDetailLabel.textContent = content.label;
  docsDetailTitle.textContent = content.title;
  docsDetailText.textContent = content.description;

  docsDetailSections.innerHTML = '';
  content.sections.forEach(section => {
    const sectionElement = document.createElement('div');
    sectionElement.className = 'docs-content-section';
    sectionElement.innerHTML = `<h3>${section.title}</h3><p>${section.text}</p>`;
    docsDetailSections.appendChild(sectionElement);
  });

  if (type === 'guides') {
    docsTools.innerHTML = '';
    renderDocCategories();
  } else {
    docsCategories.innerHTML = '';
    docsTools.innerHTML = '';
  }
}

function renderToolsByCategory(category) {
  docsTools.innerHTML = '';

  const tools = document.querySelectorAll('.ai-option');
  tools.forEach(tool => {
    if (tool.dataset.category !== category) return;

    const aiKey = tool.dataset.ai;
    const info = AI_INFO[aiKey];
    if (!info) return;

    const card = document.createElement('button');
    card.className = 'docs-tool-card';
    card.dataset.ai = aiKey;
    card.innerHTML = `
      <div class="docs-tool-icon">${info.name.charAt(0)}</div>
      <div class="docs-tool-info">
        <h3>${info.name}</h3>
        <span>${info.vendor}</span>
        <p>${info.how}</p>
      </div>
      <div class="docs-tool-arrow">→</div>
    `;
    card.addEventListener('click', () => openToolDocumentation(aiKey));
    docsTools.appendChild(card);
  });

  if (docsTools.children.length === 0) {
    docsTools.innerHTML = '<p class="review-empty">No tools in this category yet.</p>';
  }
}

function openToolDocumentation(aiKey) {
  const info = AI_INFO[aiKey];
  if (!info) return;

  docsGrid.classList.add('hidden');
  docsPopular.classList.add('hidden');
  docsDetail.classList.add('open');

  docsDetailIcon.textContent = info.name.charAt(0);
  docsDetailLabel.textContent = `${CATEGORY_LABELS[info.category] || 'AI'} GUIDE`;
  docsDetailTitle.textContent = info.name;
  docsDetailText.textContent = info.how;

  docsDetailSections.innerHTML = `
    <div class="docs-content-section">
      <h3>Why use ${info.name}?</h3>
      <p>${info.why}</p>
    </div>
    <div class="docs-content-section">
      <h3>Best for</h3>
      <div class="docs-content-list">
        ${info.bestFor ? info.bestFor.map(item => `<span>${item}</span>`).join('') : '<span>Information coming soon.</span>'}
      </div>
    </div>
    ${info.guide ? `
      <div class="docs-content-section">
        <h3>Overview</h3>
        <p>${info.guide.overview}</p>
      </div>
      <div class="docs-content-section">
        <h3>Getting Started</h3>
        <p>${info.guide.gettingStarted}</p>
      </div>
      <div class="docs-content-section">
        <h3>Tips</h3>
        <div class="docs-content-list">
          ${info.guide.tips.map(tip => `<span>${tip}</span>`).join('')}
        </div>
      </div>
    ` : ''}
  `;

  docsCategories.innerHTML = '';
  docsTools.innerHTML = '';
}

function renderDocCategories() {
  docsCategories.innerHTML = '';
  Object.entries(CATEGORY_LABELS).forEach(([key, label]) => {
    const button = document.createElement('button');
    button.className = 'docs-category';
    button.textContent = label;
    button.addEventListener('click', () => {
      docsCategories.querySelectorAll('.docs-category').forEach(b => b.classList.remove('active'));
      button.classList.add('active');
      renderToolsByCategory(key);
    });
    docsCategories.appendChild(button);
  });
}

if (docsBtn) {
  docsBtn.addEventListener('click', (event) => {
    event.preventDefault();
    openDocs();
  });
}

if (docsCloseBtn) docsCloseBtn.addEventListener('click', closeDocs);
if (docsBackBtn) docsBackBtn.addEventListener('click', showDocsHome);

if (docsOverlay) {
  docsOverlay.addEventListener('click', (event) => {
    if (event.target === docsOverlay) closeDocs();
  });
}

document.addEventListener('keydown', (event) => {
  if (docsOverlay && event.key === 'Escape' && docsOverlay.classList.contains('open')) {
    closeDocs();
  }
});

document.querySelectorAll('.docs-card').forEach(card => {
  card.addEventListener('click', () => showDocsDetail(card.dataset.doc));
});

const POPULAR_TOPIC_TARGETS = ['learning', 'learning', 'learning', 'guides', 'guides', 'guides'];
document.querySelectorAll('.docs-topic').forEach((topic, i) => {
  topic.addEventListener('click', () => showDocsDetail(POPULAR_TOPIC_TARGETS[i] || 'documentation'));
});

/* =========================================================
   DEV AI INTERACTION
========================================================= */

const devAiSection = document.getElementById("devAiSection");
const devCategoryGrid = document.getElementById("devCategoryGrid");
const devResults = document.getElementById("devResults");
const devResultsTitle = document.getElementById("devResultsTitle");
const devToolGrid = document.getElementById("devToolGrid");
const devAiBackBtn = document.getElementById("devAiBackBtn");
const devResultsBack = document.getElementById("devResultsBack");

function renderDevTools(categoryKey) {
  const category = DEV_AI_CATEGORIES[categoryKey];
  if (!category) return;

  devResultsTitle.textContent = category.title;
  devToolGrid.innerHTML = "";

  category.tools.forEach(aiKey => {
    const info = getAiInfo(aiKey);
    const card = document.createElement("article");
    card.className = "dev-tool-card";
    card.innerHTML = `
      <div class="dev-tool-top">
        <div class="dev-tool-logo">${info.name.charAt(0)}</div>
        <div>
          <div class="dev-tool-name">${info.name}</div>
          <div class="dev-tool-vendor">${info.vendor}</div>
        </div>
      </div>
      <p class="dev-tool-description">${info.how}</p>
      <div class="dev-tool-footer">
        <span class="dev-tool-rating">★ Recommended</span>
        <button class="dev-view-tool" data-dev-ai="${aiKey}">View AI →</button>
      </div>
    `;
    devToolGrid.appendChild(card);
  });

  devCategoryGrid.style.display = "none";
  devResults.classList.add("active");
}

devCategoryGrid.addEventListener("click", event => {
  const card = event.target.closest(".dev-category-card");
  if (!card) return;
  renderDevTools(card.dataset.devCategory);
});

devResultsBack.addEventListener("click", () => {
  devResults.classList.remove("active");
  devCategoryGrid.style.display = "grid";
});

devAiBackBtn.addEventListener("click", () => {
  devAiSection.scrollIntoView({ behavior: "smooth" });
  devResults.classList.remove("active");
  devCategoryGrid.style.display = "grid";
});

devToolGrid.addEventListener("click", event => {
  const button = event.target.closest(".dev-view-tool");
  if (!button) return;
  openAiDetailModal(button.dataset.devAi);
});

// ---------- Initial data load ----------
loadHero();
renderProjectGrid();