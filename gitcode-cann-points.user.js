// ==UserScript==
// @name         GitCode CANN 积分按日汇总
// @namespace    https://github.com/KaranocaVe/gitcode-cann-points
// @version      1.1.1
// @description  打开 CANN 积分明细即显示按日汇总，逐页更新每日及各积分类型的小计。
// @match        https://gitcode.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @downloadURL  https://raw.githubusercontent.com/KaranocaVe/gitcode-cann-points/main/gitcode-cann-points.user.js
// @updateURL    https://raw.githubusercontent.com/KaranocaVe/gitcode-cann-points/main/gitcode-cann-points.user.js
// ==/UserScript==

(() => {
  'use strict';

  const endpoint = new URL('https://web-api.gitcode.com/score-proxy/api/v1/shop/third-party/biz-score/logs');
  const pageSize = 100;
  const request = window.fetch.bind(window);
  const integer = new Intl.NumberFormat('zh-CN');
  const points = new Intl.NumberFormat('zh-CN', { signDisplay: 'exceptZero' });
  const requests = new WeakSet();
  let authorization;
  let observer;
  let active;
  const modalObserver = new MutationObserver(syncSummary);

  // Capture the authorization from the page's own CANN ledger request. Keep it only
  // in memory, and reuse it only for the same endpoint. Do not depend on the current
  // route: the request may be issued by a frame or during an SPA transition.
  function isLedgerRequest(method, url) {
    if (String(method).toUpperCase() !== 'GET') return false;
    try {
      const target = new URL(url, location.href);
      return target.origin === endpoint.origin && target.pathname === endpoint.pathname
        && target.searchParams.get('score_type') === 'CANN';
    } catch {
      return false;
    }
  }

  function captureAuthorization(value) {
    if (typeof value !== 'string' || !value.trim()) return;
    authorization = value;
    syncSummary();
  }

  const xhr = XMLHttpRequest.prototype;
  const open = xhr.open;
  const setRequestHeader = xhr.setRequestHeader;

  xhr.open = function (method, url, ...options) {
    const result = Reflect.apply(open, this, [method, url, ...options]);
    requests.delete(this);
    if (isLedgerRequest(method, url)) requests.add(this);
    return result;
  };

  xhr.setRequestHeader = function (name, value) {
    const result = Reflect.apply(setRequestHeader, this, [name, value]);
    if (requests.has(this) && String(name).toLowerCase() === 'authorization') {
      captureAuthorization(String(value));
    }
    return result;
  };

  // Some site versions use fetch instead of XMLHttpRequest.
  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' || input instanceof URL ? input : input?.url;
      const method = init?.method ?? input?.method ?? 'GET';
      if (isLedgerRequest(method, url)) {
        const headers = init?.headers ?? input?.headers;
        if (headers) captureAuthorization(new Headers(headers).get('authorization'));
      }
    } catch {
      // Instrumentation must never break the website's own requests.
    }
    return Reflect.apply(nativeFetch, this, [input, init]);
  };

  // Start DOM observation on entry to the page, not only after an API request.
  // pushState/replaceState do not trigger popstate in single-page applications.
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = Reflect.apply(original, this, args);
      syncSummary();
      return result;
    };
  }
  window.addEventListener('popstate', syncSummary);
  window.addEventListener('pageshow', syncSummary);
  document.addEventListener('DOMContentLoaded', syncSummary, { once: true });
  syncSummary();

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (tag === 'button') node.type = 'button';
    return node;
  }

  function isOpen(modal) {
    return modal.isConnected && !modal.classList.contains('devui-modal--wipe-leave-active');
  }

  function syncSummary() {
    const onPointsPage = /^\/setting\/points\/?$/.test(location.pathname);
    if (onPointsPage && !observer) {
      observer = new MutationObserver(syncSummary);
      observer.observe(document, { childList: true, subtree: true });
    }
    if (active && (!onPointsPage || !isOpen(active.modal) || !active.panel.isConnected)) {
      active.cancel.abort();
      modalObserver.disconnect();
      active.modal.classList.remove('gc-cann-summary-modal');
      active = undefined;
    }
    if (!onPointsPage) {
      observer?.disconnect();
      observer = undefined;
      return;
    }
    if (active || !authorization) return;

    for (const modal of document.querySelectorAll('.points-modal')) {
      if (!isOpen(modal) || modal.classList.contains('gc-cann-summary-modal')) continue;
      const title = modal.querySelector('.devui-modal__header')?.textContent.trim() ?? '';
      const body = modal.querySelector('.devui-modal__body');
      const isDetails = /积分.{0,8}(?:明细|记录)|(?:points?|score).{0,16}(?:details?|records?|history)/i.test(title);
      const isCann = /CANN/i.test(title)
        || new URLSearchParams(location.search).get('tid')?.toLowerCase() === 'cann';
      if (!body || !isDetails || !isCann) continue;
      const cancel = new AbortController();
      installStyle();
      modal.classList.add('gc-cann-summary-modal');
      const panel = mountSummary(body, authorization, cancel.signal);
      active = { modal, panel, cancel };
      modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
      return;
    }
  }

  async function fetchPage(page, authorization, signal) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ score_type: 'CANN', page, per_page: pageSize });
    const response = await request(url, {
      headers: { Authorization: authorization },
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        throw new Error('请重新打开 CANN 积分明细，让网页更新登录状态。');
      }
      throw new Error(`接口返回 HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data.page_num !== page || data.page_size !== pageSize || !Array.isArray(data.content)
        || !Number.isSafeInteger(data.total) || data.total < 0
        || Math.max(1, data.page_count) !== Math.max(1, Math.ceil(data.total / pageSize))) {
      throw new Error('积分接口返回了无法识别的分页数据');
    }
    return data;
  }

  function readEntries(records) {
    // Validate the whole page before applying it so that a retry cannot double-count it.
    return records.map(record => {
      if (!Number.isSafeInteger(record.change_amount)) throw new Error('积分明细包含无效的积分变动');
      return {
        day: record.create_time?.match(/^\d{4}-\d{2}-\d{2}(?=T| |$)/)?.[0] ?? '',
        reason: record.reason?.trim() || '未注明类型',
        amount: record.change_amount,
      };
    });
  }

  function updateSummary(days, entries, list) {
    const changed = new Set();
    let addedDay = false;
    for (const { day, reason, amount } of entries) {
      let daily = days.get(day);
      if (!daily) {
        daily = makeDay(day);
        days.set(day, daily);
        addedDay = true;
      }
      daily.amount += amount;
      daily.count += 1;
      const category = daily.categories.get(reason) ?? { amount: 0, count: 0 };
      category.amount += amount;
      category.count += 1;
      daily.categories.set(reason, category);
      changed.add(daily);
    }
    for (const daily of changed) {
      daily.countNode.textContent = `${integer.format(daily.count)} 笔`;
      showAmount(daily.amountNode, daily.amount);
      if (daily.details.open) renderCategories(daily);
    }
    if (addedDay) {
      const sorted = [...days.keys()].sort().reverse();
      // Insert new dates around existing rows without replacing open disclosure controls.
      let position = list.firstElementChild;
      for (const key of sorted) {
        const row = days.get(key).details;
        if (row === position) {
          position = position.nextElementSibling;
        } else {
          list.insertBefore(row, position);
        }
      }
    }
  }

  function showAmount(node, value) {
    node.textContent = points.format(value);
    node.dataset.sign = value > 0 ? 'positive' : value < 0 ? 'negative' : 'zero';
  }

  function makeDay(day) {
    const details = element('details', 'gc-cann-day');
    const summary = element('summary', 'gc-cann-day-summary');
    const amountNode = element('strong', 'gc-cann-amount');
    const countNode = element('span', 'gc-cann-count');
    const categoriesNode = element('ul', 'gc-cann-categories');
    summary.append(element('span', '', day || '日期未知'), countNode, amountNode);
    details.append(summary, categoriesNode);
    const daily = {
      details, amountNode, countNode, categoriesNode, amount: 0, count: 0, categories: new Map(),
    };
    details.addEventListener('toggle', () => {
      if (details.open) renderCategories(daily);
    });
    return daily;
  }

  function renderCategories(daily) {
    const rows = [];
    for (const [reason, category] of daily.categories) {
      const row = element('li', 'gc-cann-category');
      const amount = element('span', 'gc-cann-amount');
      showAmount(amount, category.amount);
      row.append(
        element('span', '', reason),
        element('span', 'gc-cann-count', `${integer.format(category.count)} 笔`),
        amount,
      );
      rows.push(row);
    }
    daily.categoriesNode.replaceChildren(...rows);
  }

  function mountSummary(body, authorization, signal) {
    const panel = element('div', 'gc-cann-panel');
    const status = element('p', 'gc-cann-status');
    status.setAttribute('role', 'status');
    const retry = element('button', 'gc-cann-retry', '重试');
    const toolbar = element('div', 'gc-cann-toolbar');
    toolbar.append(status, retry);
    const list = element('div', 'gc-cann-list');
    panel.append(toolbar, list);
    body.append(panel);

    const days = new Map();
    let page = 1;
    let total;
    let read = 0;
    let restart = false;
    retry.addEventListener('click', load);
    void load();
    return panel;

    async function load() {
      retry.hidden = true;
      if (restart) {
        days.clear();
        list.replaceChildren();
        page = 1;
        total = undefined;
        read = 0;
        restart = false;
      }
      status.textContent = page === 1 ? '正在读取第 1 页…' : progress();
      try {
        do {
          const data = await fetchPage(page, authorization, signal);
          if (signal.aborted || !panel.isConnected) return;
          total ??= data.total;
          if (data.total !== total || data.content.length !== Math.min(pageSize, total - read)) {
            restart = true;
            throw new Error('读取期间积分明细发生变化');
          }
          updateSummary(days, readEntries(data.content), list);
          read += data.content.length;
          page += 1;
          status.textContent = progress();
        } while (read < total);
      } catch (error) {
        if (signal.aborted || !panel.isConnected) return;
        status.textContent = `第 ${page} 页读取失败 · ${error.message} · 已汇总 ${integer.format(read)} 笔`;
        retry.textContent = restart ? '重新读取' : '重试本页';
        retry.hidden = false;
      }
    }

    function progress() {
      if (!total) return '暂无积分明细';
      const loaded = `${integer.format(read)} / ${integer.format(total)} 笔`;
      if (read === total) return `已汇总全部 ${loaded} · ${integer.format(days.size)} 天`;
      return `已汇总 ${loaded} · 正在读取第 ${page} / ${Math.ceil(total / pageSize)} 页…`;
    }
  }

  function installStyle() {
    if (document.getElementById('gc-cann-style')) return;
    const style = element('style');
    style.id = 'gc-cann-style';
    style.textContent = `
      .points-modal.gc-cann-summary-modal { max-width: calc(100vw - 24px); }
      .gc-cann-summary-modal > .devui-modal__body > :not(.gc-cann-panel) { display: none !important; }
      .gc-cann-panel {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: clamp(140px, calc(100dvh - 130px), 520px);
        font-size: 14px;
      }
      .gc-cann-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0 0 12px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      }
      .gc-cann-retry {
        flex: none;
        padding: 6px 12px;
        border: 1px solid #2458c5;
        border-radius: 5px;
        color: #fff;
        background: #2458c5;
        font: inherit;
        cursor: pointer;
      }
      .gc-cann-retry:hover { background: #1c479f; }
      .gc-cann-status { margin: 0; font-size: 13px; color: inherit; }
      .gc-cann-list { overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
      .gc-cann-day { border-bottom: 1px solid color-mix(in srgb, currentColor 13%, transparent); }
      .gc-cann-day:last-child { border-bottom: 0; }
      .gc-cann-day-summary, .gc-cann-category {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(6ch, auto);
        gap: 14px;
        align-items: baseline;
        font-variant-numeric: tabular-nums;
      }
      .gc-cann-day-summary { padding: 10px 8px 10px 2px; cursor: pointer; list-style: none; }
      .gc-cann-day-summary::-webkit-details-marker { display: none; }
      .gc-cann-day-summary > span:first-child::before {
        content: '▸';
        display: inline-block;
        width: 1.35em;
      }
      .gc-cann-day[open] > summary > span:first-child::before { content: '▾'; }
      .gc-cann-categories { margin: 0 0 8px; padding: 0 8px 0 calc(1.35em + 2px); list-style: none; }
      .gc-cann-category { padding: 5px 0; overflow-wrap: anywhere; }
      .gc-cann-count { opacity: .72; white-space: nowrap; }
      .gc-cann-amount { text-align: right; white-space: nowrap; }
      .gc-cann-amount[data-sign="positive"] { color: light-dark(#146b48, #77d9ac); }
      .gc-cann-amount[data-sign="negative"] { color: light-dark(#9d2940, #ffa6ac); }
    `;
    document.head.append(style);
  }
})();
