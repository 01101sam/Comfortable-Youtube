// ==UserScript==
// @name         Comfortable Youtube
// @description  Make Youtube be more comfortable to use
// @namespace    https://github.com/01101sam
// @homepage     https://github.com/01101sam/Comfortable-Youtube
// @supportURL   https://github.com/01101sam/Comfortable-Youtube/issues
// @author       Sam01101
// @version      1.3.5
// @icon         https://www.google.com/s2/favicons?domain=youtube.com
// @license      MIT
// @match        https://youtube.com/*
// @match        https://www.youtube.com/*
// @exclude      https://studio.youtube.com/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

// Utils
function getTime() {
  // Get the current time in seconds
  const now = Date.now() / 1000,
    // Extract the integer part (seconds since Unix epoch)
    seconds = Math.floor(now);
  return {
    seconds: seconds.toString(),
    // and fractional part (simulate nanoseconds)
    nanos: Math.floor((now - seconds) * 1e9)
  };
}


// region Player JSON

// Remove Ads
function removeAds(json) {
  for (const key of ["adPlacements", "playerAds"]) {
    if (json[key]) {
      console.debug(`Video ${key} removed.`);
      delete json[key];
    }
  }
}

// Remove "Are you there? (youThere)" Prompt
function removeYouThere(json) {
  if (json.messages)
    json.messages = json.messages.filter(message => {
      if ("youThereRenderer" in message)
        console.debug('"Are you there (youThere)" asking removed.');
      return !("youThereRenderer" in message);
    });
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

// Restore download feature
function restoreDownload(json) {
  if (json.frameworkUpdates.entityBatchUpdate?.mutations) {
    const payload = json.frameworkUpdates.entityBatchUpdate.mutations[0].payload;
    if (payload.offlineabilityEntity && payload.offlineabilityEntity.addToOfflineButtonState !== "ADD_TO_OFFLINE_BUTTON_STATE_ENABLED") {
      const entityKey = payload.offlineabilityEntity.key;
      payload.offlineabilityEntity = {
        addToOfflineButtonState: "ADD_TO_OFFLINE_BUTTON_STATE_ENABLED",
        contentCheckOk: false,
        key: entityKey,
        racyCheckOk: false,
        offlineabilityRenderer: "CAEaGQoVChMKEeWFqOmrmOa4hSAoMTA4MHApGAcaEgoOCgwKCumrmCAoNzIwcCkYAhoSCg4KDAoK5LitICgzNjBwKRgBGhIKDgoMCgrkvY4gKDE0NHApGAQiDTILb2ZmbGluZWxpc3Q="
      }
      if (!json.playabilityStatus.offlineability)
        json.playabilityStatus.offlineability = { "offlineabilityRenderer": { "offlineable": true } }
      console.debug("Download feature restored.");
    }
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
  restoreDownload(playerJson);
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
    const tab = json.contents.twoColumnBrowseResultsRenderer.tabs.find(tab => tab.tabRenderer?.selected && tab.tabRenderer.content.richGridRenderer)?.tabRenderer?.content;
    if (tab)
      tab.richGridRenderer.contents = tab.richGridRenderer.contents.filter(content => {
        if (content.richItemRenderer?.content?.adSlotRenderer)
          console.debug("Video slot AD removed.");
        return !content.richItemRenderer?.content?.adSlotRenderer;
      });
    if (
      tab &&
      tab.richGridRenderer.masthead &&
      tab.richGridRenderer.masthead.bannerPromoRenderer
    ) {
      delete tab.richGridRenderer.masthead;
      console.debug("Removed home page banner promotion.");
    }
  }
}

// Modify browse
function handleBrowse(browseJson) {
  removePromoOverlay(browseJson);
  removeHeaderMasterThreadPromo(browseJson);
}

// endregion

function removeNextWatchColAd(json) {
  if (json.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results) {
    const secondaryResults = json.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults, results = secondaryResults.results;
    const itemSectionRenderer = results.find(result => result.itemSectionRenderer)?.itemSectionRenderer;
    if (itemSectionRenderer)
      itemSectionRenderer.contents = itemSectionRenderer.contents.filter(content => {
        if (content.adSlotRenderer) console.debug("Next watch column AD removed.");
        return !content.adSlotRenderer;
      });
  }
}

// Modify next
function handleNext(nextJson) {
  removeNextWatchColAd(nextJson);
}


// endregion

// region Download handling

// Handle download action
function handleDownloadAction(requestJson, json) {
  const videoId = requestJson["videoId"],
    formatType = requestJson["preferredFormatType"],
    entityKey = btoa(atob("EgsAAAAAAAAAAAAAACDKASgB").replace("\x00".repeat(11), videoId));
  // debugger;
  if (json.onResponseReceivedCommand.openPopupAction?.popup?.offlinePromoRenderer) {  // Not premium
    const clickTrackingParams = json.onResponseReceivedCommand.clickTrackingParams;
    const commandOne = requestJson.preferredFormatType === "UNKNOWN_FORMAT_TYPE" ? {
      clickTrackingParams,
      openPopupAction: {
        popupType: "DIALOG",
        replacePopup: true,
        popup: {
          downloadQualitySelectorRenderer: {
            trackingParams: clickTrackingParams,
            downloadQualityPickerEntityKey: entityKey,
            premiumIcon: { "iconType": "SAD" },
            premiumDescription: { runs: [{ text: "You are not YouTube Premium" }] },
            onSubmitEndpoint: {
              clickTrackingParams,
              offlineVideoEndpoint: {
                action: "ACTION_ADD",
                videoId,
                actionParams: {
                  formatType,
                  settingsAction: "DOWNLOAD_QUALITY_SETTINGS_ACTION_SAVE"
                }
              }
            }
          }
        }
      }
    } : {
      clickTrackingParams,
      offlineVideoEndpoint: {
        videoId,
        action: "ACTION_ADD",
        actionParams: {
          "formatType": formatType,
          "settingsAction": "DOWNLOAD_QUALITY_SETTINGS_ACTION_ALREADY_SAVED"
        }
      }
    };
    if (requestJson.preferredFormatType === "UNKNOWN_FORMAT_TYPE") {  // Next, frameworkUpdates
      json.frameworkUpdates = {
        entityBatchUpdate: {
          timestamp: getTime(),
          mutations: [{
            entityKey,
            type: "ENTITY_MUTATION_TYPE_REPLACE",
            payload: {
              downloadQualityPickerEntity: {
                "key": entityKey,
                "formats": [
                  { "name": "HD (1080p)", "format": "HD_1080" },
                  { "name": "HD (720p)", "format": "HD" },
                  { "name": "SD (480p)", "format": "SD" },
                  { "name": "LD (144p)", "format": "LD" },
                  {
                    "name": "Use this feature at your risk!",
                    "availabilityType": "OFFLINEABILITY_AVAILABILITY_TYPE_PREMIUM_LOCKED",
                    "format": "UNKNOWN_FORMAT_TYPE"
                  }
                ]
              }
            }
          }]
        }
      }
    }
    json.onResponseReceivedCommand = {
      clickTrackingParams,
      commandExecutorCommand: {
        "commands": [
          commandOne,
          {
            clickTrackingParams,
            signalAction: {
              signal: "REQUEST_PERSISTENT_STORAGE"
            }
          }
        ]
      }
    }
    console.debug("Replaced download action from normal user to Premium.");
  }
}

// Handle Playback data entity
function handlePlaybackDataEntity(url, requestJson, json) {
  function toTransferKey(str) {
    // Step 1: URL decode
    const urlDecoded = decodeURIComponent(str);

    // Step 2: Base64 decode
    const base64Decoded = atob(urlDecoded);

    // Step 3: Convert to byte array
    const byteArray = new Uint8Array([...base64Decoded].map(c => c.charCodeAt(0)));

    // Step 4: Change the last third byte
    byteArray[14]++;

    // Step 5: Convert back to string
    const modifiedString = String.fromCharCode.apply(null, byteArray);

    // Step 6: Base64 encode
    const base64Encoded = btoa(modifiedString);

    // Step 7: URL encode
    return encodeURIComponent(base64Encoded);
  }

  const mutations = json.frameworkUpdates.entityBatchUpdate.mutations;

  // Only for download failed mode
  // if (mutations[0].payload.offlineVideoPolicy.action !== "OFFLINE_VIDEO_POLICY_ACTION_DOWNLOAD_FAILED")
  //   return;

  const entityKey = requestJson["videos"][0]["entityKey"],
    transferEntityKey = toTransferKey(entityKey),
    requestUrl = new URL(url.startsWith("/") ? `https://www.youtube.com${url}` : url),
    lastUpdatedTimestampSeconds = Number(mutations[0].payload.offlineVideoPolicy.lastUpdatedTimestampSeconds);
  requestUrl.pathname = "/youtubei/v1/player";


  // Fetch playerResponseJson
  let playerResponseJson;
  try {
    console.debug("[Comfortable YT]", "Download:", "Fetching player response");
    const xhr = window.unsafeWindow.XMLHttpRequest();
    xhr.open("POST", requestUrl.toString(), false);
    xhr.send(JSON.stringify({
      context: requestJson.context,
      videoId: atob(decodeURIComponent(entityKey)).substring(2, 13)
    }));
    if (xhr.status !== 200) throw new Error(`Player response status is ${xhr.status}`);
    else if (!xhr.responseText) throw new Error("Player response is empty");
    playerResponseJson = JSON.parse(xhr.responseText);
    if (playerResponseJson.playabilityStatus?.status !== "OK") {
      console.error("[Comfortable YT]", "Video download failed:", `Player response status is ${playerResponseJson.playabilityStatus?.status}`);
      return;
    }
  } catch (e) {
    console.error("[Comfortable YT]", "Video download failed:", "Failed to fetch player response:", e);
    return;
  }

  // Edit offlineVideoPolicy
  Object.assign(mutations[0].payload.offlineVideoPolicy, {
    action: "OFFLINE_VIDEO_POLICY_ACTION_OK",
    shortMessageForDisabledAction: undefined,
    expirationTimestamp: lastUpdatedTimestampSeconds + (1 * 60 * 60 * 24 * 365),  // 1 Year
  });

  // // Edit playbackData
  Object.assign(mutations[1].payload.playbackData, {
    transfer: transferEntityKey,
    streamDownloadTimestampSeconds: mutations[1].payload.playbackData.playerResponseTimestamp,
    playerResponseJson: JSON.stringify({
      responseContext: playerResponseJson.responseContext,
      attestation: playerResponseJson.attestation,
      microformat: playerResponseJson.microformat,
      offlineState: {
        action: "OK",
        expiresInSeconds: 10,  // 1 Year
        isOfflineSharingAllowed: true,
        refreshInSeconds: 37355,  // 37355
      },
      playabilityStatus: playerResponseJson.playabilityStatus,
      playbackTracking: playerResponseJson.playbackTracking,
      playerConfig: playerResponseJson.playerConfig,
      storyboards: playerResponseJson.storyboards,
      streamingData: playerResponseJson.streamingData,
      videoDetails: playerResponseJson.videoDetails,
      trackingParams: playerResponseJson.trackingParams
    })
  });

  // Add orchestrationActions
  Object.assign(json, {
    orchestrationActions: [{
      entityKey: transferEntityKey,
      actionType: "OFFLINE_ORCHESTRATION_ACTION_TYPE_ADD",
      actionMetadata: {
        priority: 1,
        transferEntityActionMetadata: requestJson["videos"][0].downloadParameters?.maximumDownloadQuality ? {
          maximumDownloadQuality: requestJson["videos"][0].downloadParameters.maximumDownloadQuality
        } : undefined
      }
    }]
  });

  console.debug("[Comfortable YT]", "Replaced playback data entity.");
  // debugger;
}

// endregion

(function () {
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
    const origXHR = wind.XMLHttpRequest, origFetch = wind.fetch;

    class XMLHttpRequestHook {
      constructor() {
        const xhr = new origXHR();

        // Hook original method
        this.origOpen = xhr.open.bind(xhr);
        this.origSend = xhr.send.bind(xhr);
        this.xhr = xhr;

        // Args store
        this.blocked = false;  // Block sending request
        this.requestBody = null;
        this.requestArgs = null;
        this.mockResponse = null;
        this.mockReadyState = null;

        // Hook
        this._onreadystatechange = null;

        return new Proxy(this, {
          get(target, prop) {
            if (prop in target)
              return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
            else
              return typeof target.xhr[prop] === 'function' ? xhr[prop].bind(xhr) : xhr[prop];
          },
          set(target, prop, value) {
            if (prop in target)
              target[prop] = value;
            else
              target.xhr[prop] = value;
            return true;
          }
        });

      }

      get readyState() {
        return this.mockReadyState !== null ? this.mockReadyState : this.xhr.readyState;
      }

      get response() {
        return this.mockResponse !== null && this.xhr.readyState === 4 ? this.mockResponse : this.xhr.response;
      }

      get responseText() {
        return this.mockResponse !== null && this.xhr.readyState === 4 ? this.mockResponse : this.xhr.responseText;
      }

      get onreadystatechange() {
        return this._onreadystatechange || undefined;
      }

      set onreadystatechange(callback) {
        this._onreadystatechange = callback;
      }

      _onreadystatechange() {
        this.mockResponse = handleXMLResponse.apply(xhr, body, requestArgs);
        this._onreadystatechange && this._onreadystatechange.apply(this.xhr);
      }

      open(method, url) {
        if (url.startsWith("//")) url = `https:${url}`;
        else if (!url.startsWith("http")) url = `${location.origin}${url}`;
        // console.debug("[Comfortable YT] XMLHttpRequest", method, url);

        this.requestArgs = arguments;
        this.origOpen.apply(this.xhr, arguments);

        this.blocked = !handleXMLRequest(method, new URL(url));
      }

      send(body) {
        if (this.blocked) return this.mockReadyState = 4;
        if (body) this.requestBody = body;
        this.xhr.onreadystatechange = this._onreadystatechange.bind(this);
        this.origSend.apply(this.xhr, arguments);
      }
    }

    wind.XMLHttpRequest = XMLHttpRequestHook;

    wind.fetch = async function (request) {
      try {
        let url = request.url || request;
        if (url.startsWith("//")) url = `https:${url}`;
        else if (!url.startsWith("http")) url = `${location.origin}${url}`;
        // console.debug("[Comfortable YT] fetch", url, request);
        if (!handleFetchRequest(url)) {
          return new Response();
        }
        const clonedRequest = request instanceof Request ? request.clone() : null;
        const response = await origFetch.apply(this, arguments);
        if (["error", "opaqueredirect"].includes(response.type) || response.status === 0) return response;
        return await handleFetchResponse(clonedRequest, response);
      } catch (e) {
        console.error("[Comfortable YT]", "fetch error:", e);
      }
    };
    wind.navigator.sendBeacon = function (..._) {
      // Block analytics data send to Youtube
      return true;
    };
    console.info("[Comfortable YT]", "Network hook applied.");
  }

  // Handle xml request
  function handleXMLRequest(method, url) {
    if (url.pathname.startsWith("/youtubei/v1/log_event") || url.pathname.startsWith("/log")) return;
    try {
      if (GM_getValue("audio-mode")) {
        // Replace to audio source url
        if (
          (url.searchParams.get("mime") || "").includes("audio") &&
          !isLive
        ) {
          url.searchParams.delete("range");
          lastAudioUrl = url.toString();
          audioReplaceSrcUrl();
        }
      }
    } catch (e) {
      console.error("[Comfortable YT]", "handleXMLRequest", "Error:", e);
    }
    return true;
  }

  // Handle xml response
  function handleXMLResponse(requestText, requestArgs) {
    if (this.readyState === 4 && this.responseURL) {
      try {
        const url = new URL(this.responseURL);
        let jsonResp;
        // console.debug("[Comfortable YT] URL Path: ", url.pathname);
        switch (url.pathname) {
          case "/youtubei/v1/player":
            jsonResp = JSON.parse(this.responseText);
            handlePlayer(jsonResp);
            return JSON.stringify(jsonResp);
          case "/youtubei/v1/browse":
            jsonResp = JSON.parse(this.responseText);
            handleBrowse(jsonResp);
            return JSON.stringify(jsonResp);
          case "/youtubei/v1/next":
            jsonResp = JSON.parse(this.responseText);
            handleNext(jsonResp);
            return JSON.stringify(jsonResp);
          case "/youtubei/v1/offline/get_download_action":
            jsonResp = JSON.parse(this.responseText);
            handleDownloadAction(null, jsonResp);
            return JSON.stringify(jsonResp);
          case "/youtubei/v1/offline/get_playback_data_entity":
            jsonResp = JSON.parse(this.responseText);
            handlePlaybackDataEntity(requestArgs[1], JSON.parse(requestText), jsonResp);
            return JSON.stringify(jsonResp);
          default:
            // console.debug(url.pathname);
            break;
        }
      } catch (e) {
        console.error("[Comfortable YT]", "handleXMLResponse", `URL(${this.responseURL})`, "Error:", e);
      }
    }
  }

  // Handle fetch request
  function handleFetchRequest(url) {
    try {
      const parsedUrl = new URL(url);
      if (url.startsWith("/youtubei/v1/log_event") || url.startsWith("/log")) return;
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
      console.error("[Comfortable YT]", "handleFetchRequest", "Error:", e);
    }
    return true;
  }

  // Handle fetch response
  async function handleFetchResponse(req, resp) {
    try {
      if (!(resp.headers.get("Content-Type") || "").includes("application/json")) return resp;
      const url = new URL(resp.url || (req && req.url));
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
        case "/youtubei/v1/offline/get_download_action":
          jsonResp = await resp.json();
          handleDownloadAction(await req.json(), jsonResp);
          resp = createFetchResponse(jsonResp, resp);
          break;
        case "/youtubei/v1/offline/get_playback_data_entity":
          jsonResp = await resp.json();
          handlePlaybackDataEntity(req.url, await req.json(), jsonResp);
          resp = createFetchResponse(jsonResp, resp);
          break;
        default:
          // console.debug(url.pathname);
          break;
      }
    } catch (e) {
      console.error("[Comfortable YT]", "handleFetchResponse", `URL(${resp.url})`, "Error:", e);
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
      handleNext(browseJson);  // The next video result also visible in Initial Data
      wind.ytInitialData = browseJson;
    },
  });

  // Init
  applyNetworkHook();
})();