const HOST = "https://ask.fm";
const CORS_PROXY = "https://cors-proxy.snowwm.workers.dev?url=";

let gAbortController = new AbortController();
let gNumFetched = 0,
  gNumShown = 0;

// Setup the form.
const MESSAGE_ELEM = document.querySelector("#message");
const FORM_ELEM = document.querySelector("#form");
FORM_ELEM.onsubmit = handleClick;
// Prefill the form.
const _loc = new URL(window.location.href);
_loc.searchParams.forEach((val, name) =>
  FORM_ELEM.elements[name] ?.setAttribute("value", val));
// Remove params from the URL bar.
_loc.search = "";
window.history.replaceState(null, "", _loc);

// Create shadow DOM for results.
const _shadow = document
  .querySelector("#results")
  .attachShadow({ mode: "open" });
const _tmpl = document.querySelector("#shadowTemplate");
_shadow.append(_tmpl.content.cloneNode(true));
const RESULTS_ELEM = _shadow.querySelector("#results");

function handleClick(event) {
  event.preventDefault();
  if (FORM_ELEM.classList.contains("busy")) {
    abortSearch();
    showStats("Поиск ответов прерван");
  } else {
    startSearch().catch(handleError);
  }
}

async function startSearch() {
  // Abort previous search and clean up.
  abortSearch();
  RESULTS_ELEM.replaceChildren();
  gNumFetched = gNumShown = 0;

  // Collect input data.
  const where = FORM_ELEM.elements.where.value.replace("@", "");
  const who = FORM_ELEM.elements.who.value.replace("@", "");
  const what = FORM_ELEM.elements.what.value.trim();

  // Prepare.
  gAbortController = new AbortController();
  FORM_ELEM.classList.add("busy");
  FORM_ELEM.setAttribute("novalidate", true);
  showMessage("Начинаем поиск...");

  await doSearch(where, who, what);
  abortSearch(); // search has finished, but we need to adjust styles
  showStats("Поиск ответов завершён");
}

function abortSearch() {
  gAbortController.abort();
  FORM_ELEM.classList.remove("busy");
  FORM_ELEM.removeAttribute("novalidate");
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

async function doSearch(where, who, what) {
  for await (let chunk of fetchAnswerChunks(where, gAbortController.signal)) {
    gNumFetched += chunk.length;

    if (who) {
      chunk = chunk.filter(authorFilter(who));
    }
    if (what) {
      chunk = chunk.filter(textFilter(what));
    }

    RESULTS_ELEM.append(...chunk.map(postProcessAnswer));
    gNumShown += chunk.length;
    showStats("Идёт поиск ответов");
  }
}

function authorFilter(username) {
  username = username.toLowerCase();
  return (ans) => {
    const author = ans.querySelector(".author");
    return (
      author && author.getAttribute("href").toLowerCase() === `/${username}`
    );
  };
}

function textFilter(text) {
  text = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
  text = RegExp(text, "i"); // localized case-insensitive search is so hard in JS :(
  return (ans) => {
    let qText = "",
      aText = "";
    let el = ans.querySelector(".streamItem_content");
    if (el) {
      qText = el.textContent;
    }
    el = ans.querySelector("header h3");
    if (el) {
      aText = el.textContent;
    }
    return qText.search(text) !== -1 || aText.search(text) !== -1;
  };
}

function postProcessAnswer(ans) {
  ans.classList.remove("shorten");
  ans
    .querySelectorAll("a[href='#']")
    .forEach((el) => (el.href = "javascript:void(0)"));
  ans
    .querySelectorAll("a[href^='/']")
    .forEach((el) => (el.href = HOST + el.getAttribute("href")));
  return ans;
}

async function* fetchAnswerChunks(username, signal) {
  let nextUrl = `/${username}`;
  while (nextUrl && !signal.aborted) {
    const html = await fetchHtml(`${HOST}${nextUrl}`, signal);
    yield Array.from(html.querySelectorAll(".streamItem-answer"));

    const nextLink = html.querySelector(".item-page-next");
    nextUrl = nextLink && nextLink.getAttribute("href");
  }
}

async function fetchHtml(url, signal) {
  console.log(`Fetching ${url}...`);

  const resp = await fetch(`${CORS_PROXY}${encodeURIComponent(url)}`, {
    signal,
    headers: {
      "X-Requested-With": "XMLHttpRequest"
    }
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

class SearchError extends Error { }
