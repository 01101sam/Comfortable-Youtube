// ==UserScript==
// @name         Comfortable Youtube
// @description  Make Youtube be more comfortable to use
// @namespace    https://github.com/01101sam
// @homepage     https://github.com/01101sam/Comfortable-Youtube
// @supportURL   https://github.com/01101sam/Comfortable-Youtube/issues
// @author       Sam01101
// @version      1.2.1
// @icon         https://www.google.com/s2/favicons?domain=youtube.com
// @license      MIT
// @match        https://youtube.com/*
// @match        https://www.youtube.com/*
// @exclude      https://studio.youtube.com/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==


// region Player JSON

// Remove Ads
function removeAds(json) {
  if (json.adPlacements) {
    console.debug("adPlacements removed.");
    delete json.adPlacements;
  }
  if (json.playerAds) {
    console.debug("playersAds removed.");
    delete json.playerAds;
  }
}

// Remove "Are you there? (youThere)" Asking
function removeYouThere(json) {
  if (json.messages) {
    for (const [k, v] of Object.entries(json.messages)) {
      if ("youThereRenderer" in v) {
        console.debug('"Are you there (youThere)" asking removed.');
        json.messages.splice(k, 1);
        break;
      }
    }
  }
}

// Remove tracking
function removeTracking(json) {
  if (json.playbackTracking) {
    ["ptrackingUrl", "atrUrl", "qoeUrl"].forEach(urlName => {
      delete json.playbackTracking[urlName];
    });
    console.debug("Youtube tracking removed.");
  }
}

// Modify player
function handlePlayer(playerJson) {
  const liveBroadcastDetails =
    playerJson.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
  if (liveBroadcastDetails && liveBroadcastDetails?.isLiveNow) {
    isLive = true;
  }
  removeAds(playerJson);
  removeYouThere(playerJson);
  removeTracking(playerJson);
}

// endregion

// region Browse JSON

// Remove promoion overlay
function removePromoOverlay(json) {
  if (json.overlay?.mealbarPromoRenderer) {
    delete json.overlay.mealbarPromoRenderer;
    console.debug("Chrome recommendion removed.");
  }
}

// Remove home page banner promotion
function removeHeaderMasterThreadPromo(json) {
  if (json.contents?.twoColumnBrowseResultsRenderer?.tabs) {
    for (const [key, tab] of Object.entries(json.contents.twoColumnBrowseResultsRenderer.tabs)) {
      if (
        tab.tabRenderer?.selected &&
        tab.tabRenderer?.content?.richGridRenderer?.masthead
      ) {
        const masterThread = tab.tabRenderer.content.richGridRenderer.masthead;
        if (masterThread.bannerPromoRenderer) {
          delete masterThread.bannerPromoRenderer;
          console.debug("Header master thread promo removed.");
        }
        break;
      }
    }
  }
}

// Modify browse
function handleBrowse(browseJson) {
  removeHeaderMasterThreadPromo(browseJson);
  removePromoOverlay(browseJson);
}

// endregion

function removeNextWatchColAd(json) {
  if (json.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results) {
    for (const [key, result] of Object.entries(json.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results)) {
      if (result.adSlotRenderer) {
        json.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results.splice(key, 1);
        console.debug(`Next watch col ${key} AD removed.`);
      }
    }
  }
}

// Modify next
function handleNext(nextJson) {
  removeNextWatchColAd(nextJson);
}


// endregion

(function (xmlReqFunc, fetchReqFunc) {
  "use strict";

  const wind = window.unsafeWindow;
  let lastAudioUrl;
  let isLive = false;

  // Add a option to settings panel
  function addSettingOption(text, idName, callback) {
    const elem = document.getElementById(idName);
    if (elem) {
      // Already exist, callback is added
      elem.onclick = function (e) {
        GM_setValue(idName, !GM_getValue(idName));
        this.setAttribute("aria-checked", GM_getValue(idName));
        callback(GM_getValue(idName));
      };
      return;
    }
    const divMenuItemElem = document.createElement("div");
    const divIconElem = document.createElement("div");
    const divLabelElem = document.createElement("div");
    const divContentElem = document.createElement("div");
    divMenuItemElem.classList.add("ytp-menuitem");
    divIconElem.classList.add("ytp-menuitem-icon");
    divLabelElem.classList.add("ytp-menuitem-label");
    divContentElem.classList.add("ytp-menuitem-content");
    divContentElem.innerHTML = '<div class="ytp-menuitem-toggle-checkbox">';
    divLabelElem.innerText = text;
    divMenuItemElem.id = idName;
    divMenuItemElem.setAttribute("aria-checked", GM_getValue(idName));
    divMenuItemElem.onclick = function (e) {
      GM_setValue(idName, !GM_getValue(idName));
      this.setAttribute("aria-checked", GM_getValue(idName));
      callback(GM_getValue(idName));
    };
    divMenuItemElem.appendChild(divIconElem);
    divMenuItemElem.appendChild(divLabelElem);
    divMenuItemElem.appendChild(divContentElem);
    document
      .getElementsByClassName("ytp-panel-menu")[0]
      .appendChild(divMenuItemElem);
  }

  // Listener to reset var
  wind.addEventListener("yt-navigate-start", function () {
    lastAudioUrl = undefined;
    isLive = false;
  });

  // Listener to load options
  wind.addEventListener("yt-navigate-finish", function () {
    const video = document.getElementsByTagName("video")[0];
    if (video) {
      addSettingOption("Audio Mode", "audio-mode", audioModeCall);

      // Init
      audioModeCall(GM_getValue("audio-mode"));
    }
  });

  // Audio Mode
  function audioModeCall(enabled) {
    // console.debug("Audio mode", enabled);
    if (isLive) {
      const container = document.getElementsByClassName(
        "html5-video-container"
      )[0];
      container.style.display = enabled ? "none" : "";
    } else audioReplaceSrcUrl();
  }

  // Audio Mode - Replace source url
  function audioReplaceSrcUrl() {
    const videoElem = document.getElementsByClassName("html5-main-video")[0];
    const isPuased = videoElem.paused;
    const currTime = videoElem.currentTime;
    const enabled = GM_getValue("audio-mode");
    if (enabled && !lastAudioUrl) videoElem.load();
    else if (enabled && lastAudioUrl && videoElem.src.startsWith("blob")) {
      // console.debug("Replaced to audio url");
      videoElem.src = lastAudioUrl;
      videoElem.pause();
      videoElem.currentTime = currTime;
      if (!isPuased) videoElem.play();
    } else if (!enabled && lastAudioUrl) {
      const player = document.getElementsByTagName("ytd-player")[0].getPlayer();
      // console.debug("Player refreshed");
      const videoId = player.getVideoData().video_id;
      player.cueVideoById(videoId);
      videoElem.pause();
      videoElem.currentTime = currTime;
      if (!isPuased) player.playVideo();
    }
  }

  // Apply network hook
  function applyNetworkHook() {
    wind.XMLHttpRequest.prototype.open = function (method, url) {
      if (url.startsWith("//")) url = `https:${url}`;
      else if (!url.startsWith("http")) url = `${location.origin}${url}`;
      if (!handleXMLRequest(method, url)) {
        return;
      }
      // console.debug("[Comfortable YT] XMLHttpRequest", method, url);
      this.onreadystatechange = function () {
        const resposneText = handleXMLResponse(this.readyState, this);
        if (resposneText) {
          Object.defineProperty(this, "responseText", {
            writable: true,
          });
          Object.defineProperty(this, "response", {
            writable: true,
          });
          this.responseText = resposneText;
          this.response = resposneText;
        }
      };
      xmlReqFunc.apply(this, arguments);
    };
    wind.fetch = async function (request) {
      try {
        const url = request.url || request;
        // console.debug("[Comfortable YT] fetch", url, request);
        if (!handleFetchRequest(url)) {
          return new Response();
        }
        const response = await fetchReqFunc.apply(this, arguments);
        if (["error", "opaqueredirect"].includes(response.type)) return response;
        return await handleFetchResponse(response);
      } catch (e) {
        console.error("[Comfortable YT] fetch error", e);
      }
    };
    wind.navigator.sendBeacon = function (url, data) {
      // Block analytics data send to Youtube
      return true;
    };
    console.info("[Comfortable YT] Network hook applied.");
  }

  // Handle xml request
  function handleXMLRequest(method, url) {
    if (url.startsWith("/youtubei/v1/log_event") || url.startsWith("/log")) return;
    try {
      const parsedUrl = new URL(url);
      if (GM_getValue("audio-mode")) {
        // Replace to audio source url
        if (
          (parsedUrl.searchParams.get("mime") || "").includes("audio") &&
          !isLive
        ) {
          parsedUrl.searchParams.delete("range");
          lastAudioUrl = parsedUrl.toString();
          audioReplaceSrcUrl();
        }
      }
    } catch (e) {
      console.error("[Comfortable YT] handleXMLRequest Error: ", e);
    }
    return true;
  }

  // Handle xml response
  function handleXMLResponse(state, self) {
    if (state === 4 && self.responseURL) {
      try {
        const url = new URL(self.responseURL);
        let jsonResp;
        // console.debug("[Comfortable YT] URL Path: ", url.pathname);
        switch (url.pathname) {
          case "/youtubei/v1/player":
            jsonResp = JSON.parse(self.responseText);
            handlePlayer(jsonResp);
            return JSON.stringify(jsonResp);
          default:
            // console.debug(url.pathname);
            break;
        }
      } catch (e) {
        console.error("[Comfortable YT] handleXMLResponse Error: ", e);
      }
    }
  }

  // Handle fetch request
  function handleFetchRequest(url) {
    if (url.startsWith("/youtubei/v1/log_event") || url.startsWith("/log")) return;
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (GM_getValue("audio-mode")) {
        // Replace to audio source url
        if (
          (parsedUrl.searchParams.get("mime") || "").includes("audio") &&
          !isLive
        ) {
          parsedUrl.searchParams.delete("range");
          lastAudioUrl = parsedUrl.toString();
          audioReplaceSrcUrl();
        }
      }
    } catch (e) {
      console.error("[Comfortable YT] handleFetchRequest Error: ", e);
    }
    return true;
  }

  // Handle fetch response
  async function handleFetchResponse(resp) {
    if (!resp.headers.get("Content-Type").includes("application/json")) return resp;
    try {
      const url = new URL(resp.url);
      let jsonResp;
      switch (url.pathname) {
        case "/youtubei/v1/player":
          jsonResp = await resp.json();
          handlePlayer(jsonResp);
          resp = createFetchResponse(jsonResp, resp);
          break;
        case "/youtubei/v1/browse":
          jsonResp = await resp.json();
          handleBrowse(jsonResp);
          resp = createFetchResponse(jsonResp, resp);
          break;
        case "/youtubei/v1/next":
          jsonResp = await resp.json();
          handleNext(jsonResp);
          resp = createFetchResponse(jsonResp, resp);
          break;
        default:
          // console.debug(url.pathname);
          break;
      }
    } catch (e) {
      console.error("[Comfortable YT] handleFetchResponse Error: ", e);
    }
    return resp;
  }

  // Handle fetch response body
  function createFetchResponse(json, data) {
    const response = new Response(JSON.stringify(json), {
      status: data.status,
      statusText: data.statusText,
      headers: data.headers,
    });
    ["ok", "redirected", "type", "url"].forEach(items => {
      Object.defineProperty(response, items, { value: data[items] });
    });
    return response;
  }

  // Hook ytInitialPlayerResponse before page is fully loaded
  Object.defineProperty(wind, "ytInitialPlayerResponse", {
    configurable: true,
    set: function (playerResponse) {
      delete wind.ytInitialPlayerResponse;
      handlePlayer(playerResponse);
      wind.ytInitialPlayerResponse = playerResponse;
    },
  });

  // Hook ytInitialData before page is fully loaded
  Object.defineProperty(wind, "ytInitialData", {
    configurable: true,
    set: function (browseJson) {
      delete wind.ytInitialData;
      handleBrowse(browseJson);
      wind.ytInitialData = browseJson;
    },
  });

  // Init
  applyNetworkHook();
})(XMLHttpRequest.prototype.open, fetch);