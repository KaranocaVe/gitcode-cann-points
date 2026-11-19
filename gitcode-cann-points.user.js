// ==UserScript==
// @name         GitCode CANN 积分按日汇总
// @namespace    https://github.com/KaranocaVe/gitcode-cann-points
// @version      1.0.0
// @description  顺序读取 CANN 积分明细，逐页更新每日及各积分类型的小计。
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

  // The growth center runs in a same-origin frame. Its ledger XHR supplies the session header.
  // Keep it in this closure and reuse it only for that same endpoint.
  const xhr = XMLHttpRequest.prototype;
  const open = xhr.open;
  const setRequestHeader = xhr.setRequestHeader;

  xhr.open = function (method, url, ...options) {
    const result = Reflect.apply(open, this, [method, url, ...options]);
    requests.delete(this);
    if (location.pathname !== '/setting/points' || String(method).toUpperCase() !== 'GET') {
      return result;
    }
    const request = new URL(url, location.href);
    if (request.origin === endpoint.origin && request.pathname === endpoint.pathname
        && request.searchParams.get('score_type') === 'CANN') {
      requests.add(this);
    }
    return result;
  };

  xhr.setRequestHeader = function (name, value) {
    const result = Reflect.apply(setRequestHeader, this, [name, value]);
    if (requests.has(this) && String(name).toLowerCase() === 'authorization') {
      authorization = String(value);
      if (!observer) {
        observer = new MutationObserver(mountButton);
        observer.observe(document, { childList: true, subtree: true });
      }
      mountButton();
    }
    return result;
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (tag === 'button') node.type = 'button';
    return node;
  }

  function mountButton() {
    if (location.pathname !== '/setting/points') {
      observer?.disconnect();
      observer = undefined;
      authorization = undefined;
      return;
    }
    for (const modal of document.querySelectorAll('.points-modal')) {
      if (modal.querySelector('.gc-cann-launch')) continue;
      const title = modal.querySelector('.devui-modal__header')?.textContent.trim();
      const body = modal.querySelector('.devui-modal__body');
      if (!body || !/CANN.*(?:积分.*明细|points.*details)/i.test(title ?? '')) continue;
      installStyle();
      const toolbar = element('div', 'gc-cann-toolbar');
      const button = element('button', 'gc-cann-launch', '按日汇总');
      button.addEventListener('click', showSummary);
      toolbar.append(button);
      body.prepend(toolbar);
    }
  }

  async function fetchPage(page, signal) {
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

  function showSummary() {
    const cancel = new AbortController();
    const dialog = element('dialog', 'gc-cann-dialog');
    dialog.setAttribute('aria-labelledby', 'gc-cann-title');
    const heading = element('h2', '', 'CANN 积分按日汇总');
    heading.id = 'gc-cann-title';
    const close = element('button', 'gc-cann-close', '关闭');
    close.addEventListener('click', () => dialog.close());
    const header = element('header', 'gc-cann-header');
    header.append(heading, close);
    const status = element('p', 'gc-cann-status');
    status.setAttribute('role', 'status');
    const retry = element('button', 'gc-cann-launch', '重试');
    const footer = element('footer', 'gc-cann-footer');
    footer.append(status, retry);
    const list = element('div', 'gc-cann-list');
    dialog.append(header, list, footer);
    dialog.addEventListener('close', () => {
      cancel.abort();
      dialog.remove();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();

    const days = new Map();
    let page = 1;
    let total;
    let read = 0;
    let restart = false;
    retry.addEventListener('click', load);
    void load();

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
          const data = await fetchPage(page, cancel.signal);
          if (cancel.signal.aborted || !dialog.open) return;
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
        if (cancel.signal.aborted || !dialog.open) return;
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
      .gc-cann-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
      .gc-cann-launch, .gc-cann-close {
        padding: 6px 12px;
        border: 1px solid #6b7280;
        border-radius: 5px;
        font: inherit;
        cursor: pointer;
      }
      .gc-cann-launch { color: #fff; background: #2458c5; border-color: #2458c5; }
      .gc-cann-launch:hover { background: #1c479f; }
      .gc-cann-close { color: inherit; background: transparent; }
      .gc-cann-dialog {
        box-sizing: border-box;
        position: fixed;
        inset: 0;
        margin: auto;
        width: min(660px, calc(100vw - 32px));
        height: min(650px, calc(100dvh - 36px));
        max-width: none;
        max-height: none;
        padding: 0;
        color-scheme: light dark;
        color: CanvasText;
        background: Canvas;
        border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
        border-radius: 10px;
        font: 14px/1.45 system-ui, sans-serif;
        box-shadow: 0 12px 46px #0004;
        overflow: hidden;
      }
      .gc-cann-dialog[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
      .gc-cann-dialog::backdrop { background: #12152778; }
      .gc-cann-header, .gc-cann-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 18px;
        border-color: color-mix(in srgb, CanvasText 16%, transparent);
        border-style: solid;
        border-width: 0;
      }
      .gc-cann-header { border-bottom-width: 1px; }
      .gc-cann-header h2 { margin: 0; font-size: 17px; font-weight: 650; color: inherit; }
      .gc-cann-footer { border-top-width: 1px; }
      .gc-cann-footer button { flex: none; }
      .gc-cann-status { margin: 0; font-size: 13px; color: inherit; }
      .gc-cann-list { overflow: auto; overscroll-behavior: contain; padding: 0 18px; }
      .gc-cann-day { border-bottom: 1px solid color-mix(in srgb, CanvasText 13%, transparent); }
      .gc-cann-day:last-child { border-bottom: 0; }
      .gc-cann-day-summary, .gc-cann-category {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(6ch, auto);
        gap: 14px;
        align-items: baseline;
        font-variant-numeric: tabular-nums;
      }
      .gc-cann-day-summary { padding: 10px 0; cursor: pointer; list-style: none; }
      .gc-cann-day-summary::-webkit-details-marker { display: none; }
      .gc-cann-day-summary > span:first-child::before {
        content: '▸';
        display: inline-block;
        width: 1.35em;
      }
      .gc-cann-day[open] > summary > span:first-child::before { content: '▾'; }
      .gc-cann-categories { margin: 0 0 8px; padding: 0 0 0 1.35em; list-style: none; }
      .gc-cann-category { padding: 5px 0; overflow-wrap: anywhere; }
      .gc-cann-count { opacity: .72; white-space: nowrap; }
      .gc-cann-amount { text-align: right; white-space: nowrap; }
      .gc-cann-amount[data-sign="positive"] { color: light-dark(#146b48, #77d9ac); }
      .gc-cann-amount[data-sign="negative"] { color: light-dark(#9d2940, #ffa6ac); }
    `;
    document.head.append(style);
  }
})();
