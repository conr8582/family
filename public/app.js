// ── Category combobox ─────────────────────────────────────────────────────────

function initComboboxes() {
  const cats = window.CATEGORIES || [];

  // Build a lookup map for pre-filling text when a category_id is already set
  const catById = Object.fromEntries(cats.map(c => [String(c.id), c.name]));

  document.querySelectorAll('.combobox').forEach(box => {
    const textInput   = box.querySelector('.tx-category-text');
    const hiddenInput = box.querySelector('.tx-category');
    const list        = box.querySelector('.combobox-list');

    // Pre-fill if the transaction already has a category
    const preId = textInput.dataset.selectedId;
    if (preId && catById[preId]) textInput.value = catById[preId];

    let activeIdx = -1;

    function getMatches(query) {
      if (!query) return cats;
      const q = query.toLowerCase();
      return cats.filter(c => c.name.toLowerCase().includes(q));
    }

    function renderList(matches) {
      list.innerHTML = '';
      activeIdx = -1;
      if (!matches.length) { list.hidden = true; return; }

      matches.forEach((cat, i) => {
        const li = document.createElement('li');
        li.dataset.id   = cat.id;
        li.dataset.name = cat.name;
        li.innerHTML = `<span>${cat.name}</span><span class="cat-type">${cat.type}</span>`;
        li.addEventListener('mousedown', e => {
          e.preventDefault(); // prevent blur firing before click
          selectCategory(cat);
        });
        list.appendChild(li);
      });

      list.hidden = false;
    }

    function selectCategory(cat) {
      textInput.value   = cat.name;
      hiddenInput.value = cat.id;
      list.hidden = true;
      activeIdx = -1;
    }

    function highlightItem(idx) {
      const items = list.querySelectorAll('li');
      items.forEach(li => li.classList.remove('active'));
      if (idx >= 0 && idx < items.length) {
        items[idx].classList.add('active');
        items[idx].scrollIntoView({ block: 'nearest' });
      }
    }

    textInput.addEventListener('input', () => {
      hiddenInput.value = ''; // clear selection when user types
      renderList(getMatches(textInput.value));
    });

    textInput.addEventListener('focus', () => {
      renderList(getMatches(textInput.value));
    });

    textInput.addEventListener('blur', () => {
      // Short delay so mousedown on a list item fires first
      setTimeout(() => { list.hidden = true; activeIdx = -1; }, 150);
    });

    textInput.addEventListener('keydown', e => {
      const items = list.querySelectorAll('li');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        highlightItem(activeIdx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        highlightItem(activeIdx);
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        const li = items[activeIdx];
        selectCategory({ id: li.dataset.id, name: li.dataset.name });
      } else if (e.key === 'Escape') {
        list.hidden = true;
        activeIdx = -1;
      } else if (e.key === 'Tab' && activeIdx >= 0) {
        // Confirm the highlighted item on Tab
        const li = items[activeIdx];
        selectCategory({ id: li.dataset.id, name: li.dataset.name });
      }
    });
  });
}

// Run after DOM is ready (script is at bottom of body)
initComboboxes();
initAmountFields();

// ── Amount field — display/edit toggle ───────────────────────────────────────

function initAmountFields() {
  document.querySelectorAll('.amount-field').forEach(field => {
    const input = field.querySelector('.tx-amount-input');
    const display = field.querySelector('.tx-amount-display');
    display.textContent = parseFloat(input.value).toFixed(2);
  });
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.tx-amount-edit-btn');
  if (!btn) return;
  const field = btn.closest('.amount-field');
  field.querySelector('.tx-amount-display').hidden = true;
  btn.hidden = true;
  const input = field.querySelector('.tx-amount-input');
  input.hidden = false;
  input.focus();
  input.select();
});

document.addEventListener('focusout', e => {
  const input = e.target.closest('.tx-amount-input');
  if (!input) return;
  const field = input.closest('.amount-field');
  if (!field) return;
  const val = parseFloat(input.value);
  const display = field.querySelector('.tx-amount-display');
  if (!isNaN(val)) display.textContent = val.toFixed(2);
  input.hidden = true;
  display.hidden = false;
  field.querySelector('.tx-amount-edit-btn').hidden = false;
});


// ── Filed — Save button ───────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.tx-save');
  if (!btn) return;

  const row = btn.closest('.tx-row');
  const id  = row.dataset.id;

  const category_id  = row.querySelector('.tx-category').value;
  const reimbursable = row.querySelector('.tx-reimb').value;
  const notes        = row.querySelector('.tx-notes').value.trim();
  const amount       = row.querySelector('.tx-amount-input').value;

  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await fetch(`/api/transactions/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id, reimbursable, notes, amount }),
    });
    if (!res.ok) throw new Error();
    btn.textContent = 'Saved ✓';
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1500);
  } catch {
    btn.disabled = false;
    btn.textContent = prev;
    alert('Could not save — please try again.');
  }
});

// ── Filed — Re-open button ────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.tx-reopen');
  if (!btn) return;

  const row = btn.closest('.tx-row');
  const id  = row.dataset.id;

  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await fetch(`/api/transactions/${id}/reopen`, { method: 'POST' });
    if (!res.ok) throw new Error();

    row.classList.add('removing');
    row.addEventListener('transitionend', () => {
      const group = row.closest('.date-group');
      row.remove();
      if (group && group.querySelectorAll('.tx-row').length === 0) group.remove();
    }, { once: true });
  } catch {
    btn.disabled = false;
    btn.textContent = 'Re-open';
    alert('Could not re-open — please try again.');
  }
});

// ── Review — Done button ──────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.tx-done');
  if (!btn) return;

  const row = btn.closest('.tx-row');
  const id  = row.dataset.id;

  const category_id  = row.querySelector('.tx-category').value;
  const reimbursable = row.querySelector('.tx-reimb').value;
  const notes        = row.querySelector('.tx-notes').value.trim();
  const amount       = row.querySelector('.tx-amount-input').value;

  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await fetch(`/api/transactions/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id, reimbursable, notes, amount }),
    });

    if (!res.ok) throw new Error('Save failed');

    row.classList.add('removing');
    row.addEventListener('transitionend', () => {
      const group = row.closest('.date-group');
      row.remove();

      if (group && group.querySelectorAll('.tx-row').length === 0) {
        group.remove();
      }

      const badge = document.getElementById('reviewCount');
      if (badge) {
        const n = parseInt(badge.textContent, 10) - 1;
        if (n <= 0) {
          const list = document.getElementById('reviewList');
          if (list) list.outerHTML = '<div class="empty-state"><p>You\'re up to date.</p></div>';
          badge.remove();
        } else {
          badge.textContent = n;
        }
      }
    }, { once: true });

  } catch {
    btn.disabled = false;
    btn.textContent = 'Done';
    alert('Could not save — please try again.');
  }
});


// ── Budget category drill-down ────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  const row = e.target.closest('.budget-row');
  if (!row) return;

  const categoryId = row.dataset.categoryId;
  if (!categoryId) return;

  // Toggle: if already open, close it
  const existingDetail = row.nextElementSibling;
  if (existingDetail && existingDetail.classList.contains('drill-down-row')) {
    existingDetail.remove();
    row.classList.remove('open');
    return;
  }

  row.classList.add('open');

  // Insert a loading row
  const detailRow = document.createElement('tr');
  detailRow.className = 'drill-down-row';
  const colCount = row.cells.length;
  detailRow.innerHTML = `<td colspan="${colCount}"><div class="drill-down-list"><div class="drill-empty">Loading…</div></div></td>`;
  row.after(detailRow);

  try {
    const month = window.BUDGET_MONTH ? `?month=${window.BUDGET_MONTH}` : '';
    const res  = await fetch(`/api/budget/${categoryId}/transactions${month}`);
    const txns = await res.json();

    if (!txns.length) {
      detailRow.querySelector('.drill-down-list').innerHTML = '<div class="drill-empty">No transactions this month.</div>';
      return;
    }

    const items = txns.map(t => {
      const amt   = (Math.abs(t.amount_cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
      const sign  = t.amount_cents < 0 ? '-' : '+';
      const acct  = t.account_name.match(/\((\d+)\)$/) ? '···' + t.account_name.match(/\((\d+)\)$/)[1] : t.account_name.split(' ')[0];
      return `<div class="drill-down-item">
        <span class="drill-date">${t.date.slice(5)}</span>
        <span class="drill-desc">${t.description}</span>
        <span class="drill-acct">${acct}</span>
        <span class="drill-amt">${sign}$${amt}</span>
      </div>`;
    }).join('');

    detailRow.querySelector('.drill-down-list').innerHTML = items;
  } catch {
    detailRow.querySelector('.drill-down-list').innerHTML = '<div class="drill-empty">Failed to load.</div>';
  }
});

// ── Reimbursements — searchable expense combobox ─────────────────────────────

function initReimbComboboxes() {
  const expenses = window.UNLINKED_EXPENSES || [];

  document.querySelectorAll('.reimb-combobox').forEach(box => {
    const textInput   = box.querySelector('.reimb-expense-text');
    const hiddenInput = box.querySelector('.reimb-expense-id');
    const list        = box.querySelector('.reimb-expense-list');
    const paymentId   = box.dataset.paymentId;
    let activeIdx     = -1;

    function label(e) {
      return `${e.date_display} — ${e.description} ($${e.amount_display})`;
    }

    function getMatches(q) {
      if (!q) return expenses.slice(0, 50);
      const lq = q.toLowerCase();
      return expenses.filter(e =>
        e.description.toLowerCase().includes(lq) ||
        e.date_display.toLowerCase().includes(lq) ||
        String(e.amount_display).includes(lq)
      ).slice(0, 50);
    }

    function renderList(matches) {
      list.innerHTML = '';
      activeIdx = -1;
      if (!matches.length) { list.hidden = true; return; }
      matches.forEach(e => {
        const li = document.createElement('li');
        li.dataset.id = e.id;
        li.innerHTML = `
          <span class="ei-date">${e.date_display}</span>
          <span class="ei-desc">${e.description}</span>
          <span class="ei-amt">$${e.amount_display}</span>
        `;
        li.addEventListener('mousedown', ev => {
          ev.preventDefault();
          selectExpense(e);
        });
        list.appendChild(li);
      });
      list.hidden = false;
    }

    async function selectExpense(e) {
      textInput.value   = label(e);
      hiddenInput.value = e.id;
      list.hidden       = true;
      textInput.disabled = true;
      textInput.value   = 'Linking…';
      try {
        const res = await fetch('/api/reimbursements/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expenseId: e.id, paymentId }),
        });
        if (!res.ok) throw new Error();
        window.location.reload();
      } catch {
        textInput.disabled = false;
        textInput.value    = '';
        hiddenInput.value  = '';
        alert('Could not link expense — please try again.');
      }
    }

    function highlight(idx) {
      const items = list.querySelectorAll('li');
      items.forEach(li => li.classList.remove('active'));
      if (idx >= 0 && idx < items.length) {
        items[idx].classList.add('active');
        items[idx].scrollIntoView({ block: 'nearest' });
      }
    }

    textInput.addEventListener('focus', () => renderList(getMatches(textInput.value)));
    textInput.addEventListener('input', () => {
      hiddenInput.value = '';
      renderList(getMatches(textInput.value));
    });
    textInput.addEventListener('blur', () => {
      setTimeout(() => { list.hidden = true; activeIdx = -1; }, 150);
    });
    textInput.addEventListener('keydown', e => {
      const items = list.querySelectorAll('li');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        highlight(activeIdx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        highlight(activeIdx);
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        const li = items[activeIdx];
        const exp = expenses.find(x => String(x.id) === li.dataset.id);
        if (exp) selectExpense(exp);
      } else if (e.key === 'Escape') {
        list.hidden = true;
        activeIdx = -1;
      }
    });
  });
}

initReimbComboboxes();

// "Link to payment" select (on unlinked expense row)
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('.reimb-link-select');
  if (!sel) return;
  const expenseId = sel.dataset.expenseId;
  const paymentId = sel.value;
  if (!paymentId) return;

  sel.disabled = true;
  try {
    const res = await fetch('/api/reimbursements/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expenseId, paymentId }),
    });
    if (!res.ok) throw new Error();
    window.location.reload();
  } catch {
    sel.disabled = false;
    sel.value = '';
    alert('Could not link expense — please try again.');
  }
});

// × unlink button on a linked expense row
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.reimb-unlink-btn');
  if (!btn) return;
  const expenseId = btn.dataset.expenseId;

  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(`/api/reimbursements/unlink/${expenseId}`, { method: 'POST' });
    if (!res.ok) throw new Error();
    window.location.reload();
  } catch {
    btn.disabled = false;
    btn.textContent = '×';
    alert('Could not unlink — please try again.');
  }
});

// "Close" button on an open payment card — files it under the Closed tab
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.reimb-close-btn');
  if (!btn) return;
  const paymentId = btn.dataset.paymentId;

  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(`/api/reimbursements/close/${paymentId}`, { method: 'POST' });
    if (!res.ok) throw new Error();
    window.location.reload();
  } catch {
    btn.disabled = false;
    btn.textContent = 'Close';
    alert('Could not close — please try again.');
  }
});

// "Reopen" button on a closed payment card
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.reimb-reopen-btn');
  if (!btn) return;
  e.preventDefault(); // don't let the click also toggle the <details> disclosure
  const paymentId = btn.dataset.paymentId;

  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(`/api/reimbursements/reopen/${paymentId}`, { method: 'POST' });
    if (!res.ok) throw new Error();
    window.location.reload();
  } catch {
    btn.disabled = false;
    btn.textContent = 'Reopen';
    alert('Could not reopen — please try again.');
  }
});

// ── Filed — description search filter ────────────────────────────────────────

const filedSearch = document.getElementById('filedSearch');
if (filedSearch) {
  filedSearch.addEventListener('input', () => {
    const q = filedSearch.value.trim().toLowerCase();
    let visible = 0;

    document.querySelectorAll('#filedList .date-group').forEach(group => {
      let groupVisible = 0;
      group.querySelectorAll('.tx-row').forEach(row => {
        const desc = row.querySelector('.tx-desc')?.textContent.toLowerCase() || '';
        const show = !q || desc.includes(q);
        row.hidden = !show;
        if (show) groupVisible++;
      });
      group.hidden = groupVisible === 0;
      visible += groupVisible;
    });

    const badge = document.getElementById('filedCount');
    if (badge) badge.textContent = q ? visible : badge.dataset.total || visible;
  });

  // Store total so we can restore it when search is cleared
  const badge = document.getElementById('filedCount');
  if (badge) badge.dataset.total = badge.textContent;
}

// ── "What is this?" merchant lookup ──────────────────────────────────────────

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.tx-lookup-btn');
  if (!btn) return;
  if (btn.dataset.loading) return;

  const row = btn.closest('.tx-row');
  const id = row.dataset.id;
  const resultEl = row.querySelector('.tx-lookup-result');

  btn.dataset.loading = '1';
  btn.textContent = '…';
  resultEl.hidden = false;
  resultEl.textContent = 'Looking up…';

  try {
    const res = await fetch(`/api/transactions/${id}/lookup`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');
    resultEl.textContent = '(AI guess) ' + data.result;
  } catch {
    resultEl.textContent = 'Could not identify — try again later.';
  } finally {
    btn.textContent = '?';
    delete btn.dataset.loading;
  }
});

// ── Sync button + last-synced status ─────────────────────────────────────────

function formatSyncTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 2)   return 'Synced just now';
  if (mins < 60)  return `Synced ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `Synced ${hrs}h ago`;
  return `Synced ${Math.floor(hrs / 24)}d ago`;
}

const syncBtn    = document.getElementById('syncBtn');
const syncStatus = document.getElementById('syncStatus');

// Load last-synced time on every page
if (syncStatus) {
  fetch('/api/sync/status')
    .then(r => r.json())
    .then(d => { if (d.lastSyncedAt) syncStatus.textContent = formatSyncTime(d.lastSyncedAt); })
    .catch(() => {});
}

if (syncBtn) {
  syncBtn.addEventListener('click', async () => {
    syncBtn.classList.add('syncing');
    syncBtn.textContent = 'Syncing…';
    if (syncStatus) syncStatus.textContent = '';
    try {
      const res  = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (data.txAdded > 0) {
        window.location.reload();
      } else {
        syncBtn.textContent = 'Sync';
        syncBtn.classList.remove('syncing');
        if (syncStatus) syncStatus.textContent = `Synced just now · ${data.txSkipped} already up to date`;
      }
    } catch {
      syncBtn.textContent = 'Sync';
      syncBtn.classList.remove('syncing');
      if (syncStatus) syncStatus.textContent = 'Sync failed';
    }
  });
}
