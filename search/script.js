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
};
const FILTER_ABORT = {};

let gAbortController = new AbortController();
let gNumFetched = 0,
  gNumShown = 0;

setup();

function setup() {
  window.addEventListener("hashchange", (e) => syncUrlToForm(e.newURL));
  FORM_ELEM.onsubmit = handleClick;
  FORM_ELEM.dateFrom.addEventListener("input", adjustDates);
  FORM_ELEM.dateTo.addEventListener("input", adjustDates);

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

function syncUrlToForm(url) {
  url = new URL(url);
  const params = new URLSearchParams(url.hash.substr(1));

  for (const el of FORM_ELEM.elements) {
    if (el.name) {
      const val = params.get(el.name);
      el.value = val;

      // Open the spoler if there's one and the value is valid.
      // Assume there are no nested spoilers.
      const spoiler = el.closest("#form details");
      if (spoiler) spoiler.open = !!el.value;
    }
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
  const data = {};
  for (const el of FORM_ELEM.elements) {
    const spoiler = el.closest("#form details");
    // Ignore unnamed/invalid elems and closed spoilers.
    if (
      el.name &&
      el.value &&
      el.checkValidity() &&
      (!spoiler || spoiler.open)
    ) {
      data[el.name] = el.value;
    }
  }
  return data;
}

function handleClick(event) {
  event.preventDefault();
  if (FORM_ELEM.classList.contains("busy")) {
    abortSearch();
    showStats("Поиск ответов прерван");
  } else {
    const formData = getFormData();
    syncFormToUrl(formData);
    if (FORM_ELEM.reportValidity()) {
      startSearch(formData).catch(handleError);
    }
  }
}

async function startSearch(formData) {
  // Abort previous search and clean up.
  abortSearch();
  RESULTS_ELEM.replaceChildren();
  gNumFetched = gNumShown = 0;

  // Prepare.
  gAbortController = new AbortController();
  FORM_ELEM.classList.add("busy");

  // Run.
  showMessage("Начинаем поиск...");
  await doSearch(formData);
  abortSearch(); // search has finished, but we need to adjust styles
  showStats("Поиск ответов завершён");
}

function abortSearch() {
  gAbortController.abort();
  FORM_ELEM.classList.remove("busy");
}

function handleError(e) {
  abortSearch();
  if (e instanceof SearchError) {
    showMessage(e.message, "", true);
  } else if (e.name !== "AbortError") {
    showMessage("Упс, что-то пошло не так :(", "", true);
    throw e;
  }
}

function showStats(state) {
  showMessage(`${state}:`, `обработано ${gNumFetched}, показано ${gNumShown}`);
}

function showMessage(part1, part2 = "", isError = false) {
  MESSAGE_ELEM.classList.toggle("error", isError);
  MESSAGE_ELEM.replaceChildren(
    `${part1} `,
    document.createElement("br"),
    part2
  );
}

async function doSearch(formData) {
  const filters = prepareFilters(formData);
  const where = formData["where"].replace("@", "");

  for await (let ans of fetchAnswers(where, gAbortController.signal)) {
    const res = processAnswer(ans, filters);
    showStats("Идёт поиск ответов");
    if (res === FILTER_ABORT) break;
  }
}

function processAnswer(ans, filters) {
  for (const filter of filters) {
    const res = filter(ans);
    if (res === FILTER_ABORT) return FILTER_ABORT;
    if (!res) return false;
  }

  RESULTS_ELEM.append(postProcessAnswer(ans));
  gNumShown++;
  return true;
}

function postProcessAnswer(ans) {
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

function prepareFilters(formData) {
  const filters = [];
  // Make sure we add filters preserving their order.
  for (const key of Object.keys(FILTERS)) {
    if (formData[key]) {
      filters.push(FILTERS[key](formData[key]));
    }
  }
  return filters;
}

function authorFilter(username) {
  username = username.replace("@", "").toLowerCase();
  return (ans) => {
    const elem = ans.querySelector(".author");
    if (!elem) return false;
    return elem.href.toLowerCase() === `/${username}`;
  };
}

function textFilter(text) {
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

function dateFilter(isFrom, queryDate) {
  queryDate = new Date(queryDate); // in local time
  if (isFrom) {
    queryDate.setHours(0, 0, 0, 0); // midnight / start of the day
  } else {
    queryDate.setHours(24, 0, 0, 0); // next midnight / end of the day
  }

  return (ans) => {
    const dateEl = ans.querySelector("time");
    if (!dateEl || !dateEl.dateTime) return false;

    // This date is in UTC.
    // ASKfm currently doesn't add this Z.
    const ansDate = new Date(dateEl.dateTime + "Z");

    if (isFrom) {
      return ansDate >= queryDate ? true : FILTER_ABORT;
    } else {
      return ansDate <= queryDate;
    }
  };
}

async function* fetchAnswers(username, signal) {
  let nextUrl = `/${username}`;
  while (nextUrl && !signal.aborted) {
    const html = await fetchHtml(`${HOST}${nextUrl}`, signal);
    const chunk = Array.from(html.querySelectorAll(".streamItem-answer"));
    gNumFetched += chunk.length;
    yield* chunk;

    const nextLink = html.querySelector(".item-page-next");
    nextUrl = nextLink && nextLink.getAttribute("href");
  }
}

async function fetchHtml(url, signal) {
  console.log(`Fetching ${url}...`);

  const resp = await fetch(`${CORS_PROXY}${encodeURIComponent(url)}`, {
    signal,
    headers: {
      // Fetch only answers, not the full page.
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  if (resp.status === 404) {
    throw new SearchError(`Пользователь ${url} не найден!`);
  }

  if (!resp.ok) {
    throw new Error(`Fetch status ${resp.status}: ${resp.statusText}`);
  }

  const htmlString = await resp.text();
  const htmlDoc = new DOMParser().parseFromString(htmlString, "text/html");
  return htmlDoc.body;
}

class SearchError extends Error {}
