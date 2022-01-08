// Warn about unsupported browser. Regex from:
// npx browserslist-useragent-regexp "supports flexbox-gap" --allowHigherVersions
const BROWSER_RE =
  /((CPU[ +]OS|iPhone[ +]OS|CPU[ +]iPhone|CPU IPhone OS)[ +]+(14[_.]5|14[_.]([6-9]|\d{2,})|14[_.]8|14[_.](9|\d{2,})|(1[5-9]|[2-9]\d|\d{3,})[_.]\d+|15[_.]0|15[_.]([1-9]|\d{2,})|(1[6-9]|[2-9]\d|\d{3,})[_.]\d+)(?:[_.]\d+)?)|(Opera\/.+Opera Mobi.+Version\/(64\.0|64\.([1-9]|\d{2,})|(6[5-9]|[7-9]\d|\d{3,})\.\d+))|(Opera\/(64\.0|64\.([1-9]|\d{2,})|(6[5-9]|[7-9]\d|\d{3,})\.\d+).+Opera Mobi)|(Opera Mobi.+Opera(?:\/|\s+)(64\.0|64\.([1-9]|\d{2,})|(6[5-9]|[7-9]\d|\d{3,})\.\d+))|((?:Chrome).*OPR\/(73\.0|73\.([1-9]|\d{2,})|(7[4-9]|[8-9]\d|\d{3,})\.\d+)\.\d+)|(SamsungBrowser\/(14\.0|14\.([1-9]|\d{2,})|(1[5-9]|[2-9]\d|\d{3,})\.\d+))|(Edge\/(84(?:\.0)?|84(?:\.([1-9]|\d{2,}))?|(8[5-9]|9\d|\d{3,})(?:\.\d+)?))|((Chromium|Chrome)\/(84\.0|84\.([1-9]|\d{2,})|(8[5-9]|9\d|\d{3,})\.\d+)(?:\.\d+)?)|(Version\/(14\.1|14\.([2-9]|\d{2,})|(1[5-9]|[2-9]\d|\d{3,})\.\d+|15\.0|15\.([1-9]|\d{2,})|(1[6-9]|[2-9]\d|\d{3,})\.\d+)(?:\.\d+)? Safari\/)|(Firefox\/(63\.0|63\.([1-9]|\d{2,})|(6[4-9]|[7-9]\d|\d{3,})\.\d+)\.\d+)|(Firefox\/(63\.0|63\.([1-9]|\d{2,})|(6[4-9]|[7-9]\d|\d{3,})\.\d+)(pre|[ab]\d+[a-z]*)?)/;

if (!BROWSER_RE.test(navigator.userAgent)) {
  document.querySelector("#browserWarning").hidden = false;
}

const HOST = "https://ask.fm";
const CORS_PROXY = "https://cors-proxy.snowwm.workers.dev?url=";
const MESSAGE_ELEM = document.querySelector("#message");
const FORM_ELEM = document.querySelector("#form");
const RESULTS_ELEM = setupShadow().querySelector("#results");

const FILTERS = {
  // Filter order here is optimized, not arbitrary.
  dateFrom: dateFilter.bind(null, true),
  dateTo: dateFilter.bind(null, false),
  who: authorFilter,
  what: textFilter,
  reactionFrom: reactionFilter,
};
const FILTER_ABORT = {};

let gCurSearch = null;
setup();

function setup() {
  window.addEventListener("hashchange", (e) => syncUrlToForm(e.newURL));
  FORM_ELEM.addEventListener("submit", handleClick);
  FORM_ELEM.dateFrom.addEventListener("input", adjustDates);
  FORM_ELEM.dateTo.addEventListener("input", adjustDates);

  FORM_ELEM.querySelectorAll("[autocomplete='username']").forEach((el) =>
    el.addEventListener(
      "invalid",
      (e) => (e.target.value = normalizeUsername(e.target.value))
    )
  );

  syncUrlToForm(window.location);
  adjustDates();
}

function setupShadow() {
  const shadow = document.querySelector("#results").attachShadow({
    mode: "open",
  });
  const tmpl = document.querySelector("#shadowTemplate");
  shadow.append(tmpl.content.cloneNode(true));
  return shadow;
}

function adjustDates() {
  const dateFrom = FORM_ELEM.dateFrom;
  const dateTo = FORM_ELEM.dateTo;
  dateFrom.removeAttribute("max");
  dateTo.removeAttribute("min");

  if (dateFrom.value) {
    dateTo.min = dateFrom.value;
  } else if (dateTo.value) {
    dateFrom.max = dateTo.value;
  }
}

function normalizeUsername(name) {
  let match = name.match(/^https?:\/\/ask\.fm\/([a-zA-Z0-9_]+)(\/.*)?$/);
  if (match) return match[1];
  match = name.match(/^@?([a-zA-Z0-9_]+)$/);
  if (match) return match[1];
  return name;
}

function* getFormElems() {
  for (const el of FORM_ELEM.elements) {
    if (el.name) {
      // Assume there are no nested spoilers.
      const spoiler = el.closest("#form details");
      yield [el, spoiler];
    }
  }
}

function syncUrlToForm(url) {
  url = new URL(url);
  const params = new URLSearchParams(url.hash.substr(1));

  for (const [el, spoiler] of getFormElems()) {
    el.value = params.get(el.name);
    if (spoiler && el.value) spoiler.open = true;
  }

  // Normalize the URL.
  syncFormToUrl(getFormData());
}

function syncFormToUrl(formData) {
  const url = new URL(window.location);
  const oldParams = new URLSearchParams(url.hash.substr(1));
  const newParams = new URLSearchParams(formData);
  url.hash = newParams;
  const oldWhere = oldParams.get("where");
  const newWhere = newParams.get("where");

  if (oldWhere === newWhere) {
    window.history.replaceState(null, "", url);
  } else {
    window.history.pushState(null, "", url);
  }

  if (newWhere) {
    document.title = `afh_search: поиск ответов от ${newWhere}`;
  } else {
    document.title = `afh_search: поиск ответов на ASKfm`;
  }
}

function getFormData() {
  FORM_ELEM.checkValidity();
  const data = {};

  for (const [el, spoiler] of getFormElems()) {
    if (el.value && el.validity.valid && (!spoiler || spoiler.open)) {
      data[el.name] = el.value;
    }
  }

  return data;
}

async function handleClick(event) {
  event.preventDefault();

  try {
    if (gCurSearch) {
      gCurSearch.showStats("Поиск ответов прерван");
    } else {
      const formData = getFormData();
      syncFormToUrl(formData);
      if (FORM_ELEM.reportValidity()) {
        gCurSearch = new SearchContext();
        await gCurSearch.doSearch(formData);
      }
    }
  } catch (e) {
    handleError(e);
  } finally {
    finishSearch();
  }
}

function handleError(e) {
  if (e.name !== "AbortError") {
    const msg = e.humanMessage || "Упс, что-то пошло не так :(";
    showMessage(msg, "", true);
    throw e; // let it show up in the console
  }
}

function finishSearch() {
  if (gCurSearch) gCurSearch.abCont.abort();
  gCurSearch = null;
  FORM_ELEM.classList.remove("busy");
}

function showMessage(part1, part2 = "", isError = false) {
  MESSAGE_ELEM.classList.toggle("error", isError);
  MESSAGE_ELEM.replaceChildren(part1, " ", document.createElement("br"), part2);
}

class SearchContext {
  constructor() {
    this.numFetched = this.numShown = 0;
    this.abCont = new AbortController();
    this.filters = [];
  }

  async doSearch(formData) {
    // Clean up and prepare.
    RESULTS_ELEM.replaceChildren();
    FORM_ELEM.classList.add("busy");
    showMessage("Начинаем поиск...");
    this.prepareFilters(formData);
    this.username = formData["where"];

    for await (const ans of this.fetchItems(
      this.username,
      ".streamItem-answer"
    )) {
      if ((await this.processAnswer(ans)) === FILTER_ABORT) break;
      this.showStats("Идёт поиск ответов");
    }

    this.showStats("Поиск ответов завершён");
  }

  prepareFilters(formData) {
    // Make sure we add filters preserving their order.
    for (const key of Object.keys(FILTERS)) {
      if (formData[key]) {
        this.filters.push(FILTERS[key](this, formData[key]));
      }
    }
  }

  showStats(state) {
    showMessage(
      `${state}:`,
      `обработано ${this.numFetched}, показано ${this.numShown}`
    );
  }

  async processAnswer(ans) {
    this.numFetched++;
    for (const filter of this.filters) {
      const res = await filter(ans);
      if (res === FILTER_ABORT) return FILTER_ABORT;
      if (!res) return false;
    }

    RESULTS_ELEM.append(this.postProcessAnswer(ans));
    this.numShown++;
    return true;
  }

  postProcessAnswer(ans) {
    ans.classList.remove("shorten");
    ans.querySelectorAll("a[href='#']").forEach((el) => {
      el.href = "javascript:void(0)";
    });
    ans.querySelectorAll("a[href^='/']").forEach((el) => {
      el.href = HOST + el.getAttribute("href");
    });
    ans.querySelectorAll("time").forEach((el) => {
      el.textContent = new Date(el.dateTime + "Z").toLocaleString();
      el.removeAttribute("title");
    });
    return ans;
  }

  async *fetchItems(nextUrl, selector) {
    while (nextUrl && !this.abCont.signal.aborted) {
      const html = await this.fetchHtml(nextUrl);
      yield* html.querySelectorAll(selector);

      const nextLink = html.querySelector(".item-page-next");
      nextUrl = nextLink && nextLink.getAttribute("href");
    }
  }

  async fetchHtml(url) {
    url = new URL(url, HOST);
    console.log(`Fetching ${url}...`);

    const resp = await fetch(`${CORS_PROXY}${encodeURIComponent(url)}`, {
      signal: this.abCont.signal,
      headers: {
        // Fetch only content, not the full page.
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!resp.ok) {
      const e = new Error(`Fetch status ${resp.status}: ${resp.statusText}`);
      if (resp.status === 404) {
        const userUrl = new URL(this.username, HOST);
        e.humanMessage = `Пользователь ${userUrl} не найден!`;
      }
      throw e;
    }

    const htmlString = await resp.text();
    const htmlDoc = new DOMParser().parseFromString(htmlString, "text/html");
    return htmlDoc.body;
  }
}

function authorFilter(ctx, username) {
  username = "/" + username.toLowerCase();

  return (ans) => {
    const elem = ans.querySelector(".author");
    if (!elem) return false;
    return elem.getAttribute("href").toLowerCase() === username;
  };
}

function textFilter(ctx, text) {
  // Localized case-insensitive search is so hard in JS :(
  // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
  text = text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  text = RegExp(text, "i");

  return (ans) => {
    const dummy = { textContent: "" };
    const qText = (ans.querySelector("header h3") || dummy).textContent;
    const aText = (ans.querySelector(".streamItem_content") || dummy)
      .textContent;
    return qText.search(text) !== -1 || aText.search(text) !== -1;
  };
}

function dateFilter(isFrom, ctx, queryDate) {
  queryDate = new Date(queryDate); // in local time
  queryDate.setHours(0, 0, 0, 0);

  return (ans) => {
    const dateEl = ans.querySelector("time");
    if (!dateEl || !dateEl.dateTime) return false;

    // This date is in UTC.
    // ASKfm currently doesn't add this Z.
    const ansDate = new Date(dateEl.dateTime + "Z");
    ansDate.setHours(0, 0, 0, 0);

    if (isFrom) {
      return ansDate >= queryDate ? true : FILTER_ABORT;
    } else {
      return ansDate <= queryDate;
    }
  };
}

function reactionFilter(ctx, username) {
  username = "@" + username.toLowerCase();

  async function checkList(ansUrl, listPath) {
    for await (const u of ctx.fetchItems(
      ansUrl + listPath,
      ".userName:nth-child(2)"
    )) {
      if (u.textContent.toLowerCase() === username) return true;
    }
    return false;
  }

  return async (ans) => {
    const ansUrl = ans.querySelector("a.streamItem_meta").getAttribute("href");
    // Fetch in parallel.
    const likes = checkList(ansUrl, "/fans/likes");
    const rewards = checkList(ansUrl, "/fans/rewards");
    return (await likes) || (await rewards);
  };
}
