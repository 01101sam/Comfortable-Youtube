// ==UserScript==
// @name         Comfortable Youtube
// @description  Make Youtube be more comfortable to use
// @encoding     utf-8
// @namespace    https://github.com/01101sam/Comfortable-Youtube
// @homepage     https://github.com/01101sam/Comfortable-Youtube
// @supportURL   https://github.com/01101sam/Comfortable-Youtube/issues
// @downloadURL  https://github.com/01101sam/Comfortable-Youtube/raw/master/index.js
// @updateURL    https://github.com/01101sam/Comfortable-Youtube/raw/master/index.js
// @author       Sam01101
// @version      1.5.1
// @icon         https://www.youtube.com/favicon.ico
// @license      MIT
// @run-at       document-start
// @match        http*://youtube.com/*
// @match        http*://www.youtube.com/*
// @compatible   chrome
// @compatible   firefox
// @compatible   edge
// @connect      youtube.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// ==/UserScript==
// noinspection ExceptionCaughtLocallyJS

const wind = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

const AUDIO_MODE_KEY = "audio-mode";
let fetchingForDownload = false;

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

function numberFormat(numberState) {
    return getNumberFormatter().format(numberState);
}

// https://github.com/search?q=repo%3AAnarios/return-youtube-dislike%20getNumberFormatter&type=code
function getNumberFormatter() {
    let userLocales;
    if (document.documentElement.lang) {
        userLocales = document.documentElement.lang;
    } else if (navigator.language) {
        userLocales = navigator.language;
    } else {
        try {
            userLocales = new URL(
                Array.from(document.querySelectorAll("head > link[rel='search']"))
                    ?.find((n) => n?.getAttribute("href")?.includes("?locale="))
                    ?.getAttribute("href")
            )?.searchParams?.get("locale");
        } catch {
            userLocales = "en";
        }
    }

    return Intl.NumberFormat(userLocales, {
        notation: "compact",
        compactDisplay: "short",
    });
}

/** Runs a step, logging instead of throwing. Returns the step's result, or false on error. */
function runStep(name, step) {
    try {
        return step();
    } catch (e) {
        console.error("[Comfortable YT]", name, "Error:", e);
        return false;
    }
}

const AD_KEYS = new Set(["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"]);

const AD_RENDERERS = new Set([
    "adSlotRenderer",
    "searchPyvRenderer",
    "promotedSparklesWebRenderer",
    "promotedSparklesTextSearchRenderer",
    "promotedVideoRenderer",
    "compactPromotedVideoRenderer",
    "bannerPromoRenderer",
    "videoMastheadAdV3Renderer",
    "brandVideoShelfRenderer",
    "brandVideoSingletonRenderer",
    "mealbarPromoRenderer",
    "youThereRenderer",
    "guideSigninPromoRenderer",
]);

function isAdRendererEntry(key, value) {
    if (AD_RENDERERS.has(key)) return true;
    return key === "statementBannerRenderer" && value?.titleFontFamily === "PROMO_FONT_FAMILY_YOUTUBE_SANS_BOLD";
}

function hasAdRenderer(obj) {
    return Object.entries(obj).some(([key, value]) => isAdRendererEntry(key, value));
}

function isAdItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    if (hasAdRenderer(item)) return true;
    if (item.command?.reelWatchEndpoint?.adClientParams?.isAd) return true;
    return Object.values(item).some(value => {
        const content = value?.content;
        return content && typeof content === "object" && !Array.isArray(content) && hasAdRenderer(content);
    });
}

function removeTracking(playerJson) {
    const tracking = playerJson.playbackTracking;
    if (!tracking) return false;
    let modified = false;
    ["ptrackingUrl", "atrUrl", "qoeUrl"].forEach(urlName => {
        if (!(urlName in tracking)) return;
        delete tracking[urlName];
        modified = true;
    });
    return modified;
}

function keepBestAudioFormats(playerJson) {
    const formats = playerJson.streamingData?.adaptiveFormats;
    if (!formats || fetchingForDownload || !GM_getValue(AUDIO_MODE_KEY)) return false;
    const best = new Map();
    for (const format of formats) {
        if (!format.mimeType?.startsWith("audio/") || format.isDrc || format.audioTrack?.audioIsDefault === false) continue;
        const container = format.mimeType.split(";")[0];
        if (!best.has(container) || best.get(container).bitrate < format.bitrate) best.set(container, format);
    }
    if (!best.size) return false;
    const kept = new Set(best.values());
    const filtered = formats.filter(format => !format.mimeType?.startsWith("audio/") || kept.has(format));
    if (filtered.length === formats.length) return false;
    playerJson.streamingData.adaptiveFormats = filtered;
    console.debug("[Comfortable YT]", "Audio mode: kept audio formats", [...kept].map(format => format.itag).join(", "));
    return true;
}

function restoreDownload(playerJson) {
    const payload = playerJson.frameworkUpdates?.entityBatchUpdate?.mutations
        ?.find(mutation => mutation.payload?.offlineabilityEntity)?.payload;
    if (!payload || payload.offlineabilityEntity.addToOfflineButtonState === "ADD_TO_OFFLINE_BUTTON_STATE_ENABLED") return false;
    const entityKey = payload.offlineabilityEntity.key;
    payload.offlineabilityEntity = {
        addToOfflineButtonState: "ADD_TO_OFFLINE_BUTTON_STATE_ENABLED",
        contentCheckOk: false,
        key: entityKey,
        racyCheckOk: false,
        offlineabilityRenderer: "CAEaGQoVChMKEeWFqOmrmOa4hSAoMTA4MHApGAcaEgoOCgwKCumrmCAoNzIwcCkYAhoSCg4KDAoK5LitICgzNjBwKRgBGhIKDgoMCgrkvY4gKDE0NHApGAQiDTILb2ZmbGluZWxpc3Q="
    };
    if (playerJson.playabilityStatus && !playerJson.playabilityStatus.offlineability)
        playerJson.playabilityStatus.offlineability = { offlineabilityRenderer: { offlineable: true } };
    console.debug("Download feature restored.");
    return true;
}

/**
 * Non-Premium accounts get the download item only in the overflow menu, which hides download progress.
 * Move it to the front of the action bar with a download button, as Premium has it.
 * YouTube moves it back into the menu when the bar runs out of space.
 */
function moveDownloadToActions(menu) {
    if (!Array.isArray(menu.items) || !Array.isArray(menu.flexibleItems)) return false;
    if (menu.flexibleItems.some(item => item.menuFlexibleItemRenderer?.topLevelButton?.downloadButtonRenderer)) return false;
    const index = menu.items.findIndex(item => item.menuServiceItemDownloadRenderer?.serviceEndpoint?.offlineVideoEndpoint);
    if (index < 0) return false;
    const [{ menuServiceItemDownloadRenderer: menuItem }] = menu.items.splice(index, 1);
    delete menuItem.subtitleText;
    const endpoint = menuItem.serviceEndpoint;
    menu.flexibleItems.unshift({
        menuFlexibleItemRenderer: {
            menuItem: { menuServiceItemDownloadRenderer: menuItem },
            topLevelButton: {
                downloadButtonRenderer: {
                    trackingParams: menuItem.trackingParams,
                    style: "STYLE_DEFAULT",
                    size: "SIZE_DEFAULT",
                    targetId: "watch-download-button",
                    hasLabel: true,
                    command: { ...endpoint, offlineVideoEndpoint: { ...endpoint.offlineVideoEndpoint, action: "ACTION_ADD" } },
                },
            },
        },
    });
    console.debug("[Comfortable YT]", "Download:", "Moved download button to actions.");
    return true;
}

/**
 * Removes ads and applies the JSON tweaks in place. Returns whether anything changed.
 * A step that throws midway may change the node without reporting it.
 */
function cleanJson(node) {
    let modified = false;
    if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
            if (isAdItem(node[i])) {
                console.debug("[Comfortable YT]", "Removed:", Object.keys(node[i])[0]);
                node.splice(i, 1);
                modified = true;
            } else if (cleanJson(node[i])) modified = true;
        }
        return modified;
    }
    if (!node || typeof node !== "object") return false;

    if (Array.isArray(node.flexibleItems) && runStep("moveDownloadToActions", () => moveDownloadToActions(node))) modified = true;

    if ("playabilityStatus" in node) {
        if (runStep("removeTracking", () => removeTracking(node))) modified = true;
        if (runStep("restoreDownload", () => restoreDownload(node))) modified = true;
        if (runStep("keepBestAudioFormats", () => keepBestAudioFormats(node))) modified = true;
    }

    for (const key of Object.keys(node)) {
        const value = node[key];
        if (
            AD_KEYS.has(key) ||
            isAdRendererEntry(key, value) ||
            (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && hasAdRenderer(value))
        ) {
            console.debug("[Comfortable YT]", "Removed:", key);
            delete node[key];
            modified = true;
        } else if (cleanJson(value)) modified = true;
    }
    return modified;
}

// region Download

function fetchPlayerSync(url, context, videoId) {
    console.debug("[Comfortable YT]", "Download:", "Fetching video player response");

    const xhr = new wind.XMLHttpRequest();
    let playerResponseJson;

    fetchingForDownload = true;
    try {
        xhr.open("POST", url, false);
        xhr.withCredentials = true;
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify({
            context,
            videoId,
            playbackContext: { contentPlaybackContext: { signatureTimestamp: wind.ytcfg?.get?.("STS") } }
        }));
        if (xhr.status !== 200) throw new Error(`Player response status is ${xhr.status}`);
        else if (!xhr.responseText) throw new Error("Player response is empty");
        playerResponseJson = JSON.parse(xhr.responseText);
        if (playerResponseJson.playabilityStatus?.status !== "OK") {
            console.error("[Comfortable YT]", "Video player download failed:", `Player response status is ${playerResponseJson.playabilityStatus?.status}`);
            return;
        }
        return playerResponseJson;
    } catch (e) {
        console.error("[Comfortable YT]", "Video player download failed:", "Failed to fetch player response:", e);
    } finally {
        fetchingForDownload = false;
    }
}

// Handle offline video
function handleOfflineVideo(url, requestJson) {
    const requestUrl = new URL(url.startsWith("/") ? `https://www.youtube.com${url}` : url);

    requestUrl.pathname = "/youtubei/v1/player";

    // Fetch playerResponseJson
    const playerResponseJson = fetchPlayerSync(requestUrl.toString(), requestJson.context, requestJson.videoIds[0]);
    if (!playerResponseJson) return;

    console.debug("Replaced offline video data.");
    return {
        responseContext: playerResponseJson.responseContext,
        videos: [{
            offlineVideoData: {
                videoId: requestJson.videoIds[0],
                thumbnail: playerResponseJson.videoDetails.thumbnail,
                title: playerResponseJson.videoDetails.title,
                viewCount: playerResponseJson.videoDetails.viewCount,
                shareUrl: `https://youtu.be/${playerResponseJson.videoDetails.videoId}`,
                description: playerResponseJson.microformat?.playerMicroformatRenderer?.description,
                shortViewCountText: numberFormat(playerResponseJson.videoDetails.viewCount),
                lengthSeconds: playerResponseJson.videoDetails.lengthSeconds
            }
        }]
    }
}

// Handle download action
function handleDownloadAction(requestJson, json) {
    if (!json.onResponseReceivedCommand?.openPopupAction?.popup?.offlinePromoRenderer) return;
    const videoId = requestJson["videoId"],
        formatType = requestJson["preferredFormatType"],
        entityKey = btoa(atob("EgsAAAAAAAAAAAAAACDKASgB").replace("\x00".repeat(11), videoId)),
        // Clients send preferredFormatType (for example SD) even if the user never saved a quality setting,
        // so ask for the quality whenever no setting was saved.
        askQuality = formatType === "UNKNOWN_FORMAT_TYPE" || !Number(requestJson["lastOfflineQualitySettingsSavedMs"]);
    const clickTrackingParams = json.onResponseReceivedCommand.clickTrackingParams;
    const commandOne = askQuality ? {
        clickTrackingParams,
        openPopupAction: {
            popupType: "DIALOG",
            replacePopup: true,
            popup: {
                downloadQualitySelectorRenderer: {
                    trackingParams: clickTrackingParams,
                    downloadQualityPickerEntityKey: entityKey,
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
    if (askQuality) {
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
                                { "name": "LD (144p)", "format": "LD" }
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

const OFFLINE_ENTITY_TYPE = { playbackData: 119, transfer: 120, offlineVideoPolicy: 130, videoDownloadContextEntity: 461 };
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Builds an offline entity key: the URL-encoded base64 of the protobuf { 2: videoId, 4: entity type, 5: 1 }.
 */
function offlineEntityKey(videoId, type) {
    const varint = type < 0x80 ? [type] : [(type & 0x7f) | 0x80, type >> 7];
    const bytes = [0x12, videoId.length, ...[...videoId].map(c => c.charCodeAt(0)), 0x20, ...varint, 0x28, 0x01];
    return encodeURIComponent(btoa(String.fromCharCode(...bytes)));
}

/**
 * The offline downloader only downloads from each format's url. The web /player response has SABR
 * formats without urls; only Premium offline responses include them.
 * VISIONOS urls need no signature decryption and no GVS PO token, and they download fully in the browser (measured).
 * Send no cookies: a signed-in request returns no formats.
 */
async function fetchDirectStreamingData(videoId, client) {
    const context = {
        client: {
            clientName: "VISIONOS",
            clientVersion: "1.02",
            deviceMake: "Apple",
            deviceModel: "RealityDevice17,1",
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
            osName: "visionOS",
            osVersion: "26.5.23O471",
            hl: client?.hl,
            gl: client?.gl,
            visitorData: client?.visitorData,
        }
    };
    const response = await wind.fetch("/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json", "X-YouTube-Client-Name": "101", "X-YouTube-Client-Version": "1.02" },
        body: JSON.stringify({ context, videoId, contentCheckOk: true, racyCheckOk: true }),
    });
    const json = await response.json();
    const formats = json.streamingData?.adaptiveFormats;
    if (json.playabilityStatus?.status !== "OK" || !formats?.length || !formats.every(format => format.url))
        throw new Error(`Direct formats unavailable: ${json.playabilityStatus?.status} ${json.playabilityStatus?.reason || ""}`);
    return json.streamingData;
}

async function handlePlaybackDataEntity(url, requestJson, json) {
    const video = requestJson["videos"][0],
        entityKey = video["entityKey"],
        videoId = atob(decodeURIComponent(entityKey)).substring(2, 13),
        now = Math.floor(Date.now() / 1000),
        mutations = json.frameworkUpdates?.entityBatchUpdate?.mutations || [];
    let policy = mutations.find(mutation => mutation.payload?.offlineVideoPolicy)?.payload.offlineVideoPolicy,
        playbackData = mutations.find(mutation => mutation.payload?.playbackData)?.payload.playbackData;

    // On refresh (for example after the urls expire), the server deletes the entities of non-Premium accounts.
    // Return fresh playback data instead, otherwise the download is removed.
    if (!policy || !playbackData) {
        if (!video.refreshData) {
            console.error("[Comfortable YT]", "Download:", "offlineVideoPolicy / playbackData not found in playback data entity");
            return;
        }
        policy = { key: offlineEntityKey(videoId, OFFLINE_ENTITY_TYPE.offlineVideoPolicy), lastUpdatedTimestampSeconds: String(now) };
        playbackData = {
            key: entityKey,
            playerResponseTimestamp: String(now),
            offlineVideoPolicy: offlineEntityKey(videoId, OFFLINE_ENTITY_TYPE.offlineVideoPolicy),
            videoDownloadContextEntity: offlineEntityKey(videoId, OFFLINE_ENTITY_TYPE.videoDownloadContextEntity),
        };
        json.frameworkUpdates = {
            entityBatchUpdate: {
                mutations: [
                    { entityKey, type: "ENTITY_MUTATION_TYPE_REPLACE", payload: { playbackData }, options: { persistenceOption: "ENTITY_PERSISTENCE_OPTION_PERSIST" } },
                    { entityKey: policy.key, type: "ENTITY_MUTATION_TYPE_REPLACE", payload: { offlineVideoPolicy: policy }, options: { persistenceOption: "ENTITY_PERSISTENCE_OPTION_PERSIST" } },
                ],
                timestamp: { seconds: String(now), nanos: 0 },
            }
        };
    }

    const requestUrl = new URL(url.startsWith("/") ? `https://www.youtube.com${url}` : url);
    requestUrl.pathname = "/youtubei/v1/player";

    const playerResponseJson = fetchPlayerSync(requestUrl.toString(), requestJson.context, videoId);
    if (!playerResponseJson) return;
    let streamingData;
    try {
        streamingData = await fetchDirectStreamingData(videoId, requestJson.context?.client);
    } catch (e) {
        console.error("[Comfortable YT]", "Download:", e);
        return;
    }

    // The server's policy says the download failed because it needs Premium. Allow it, and drop
    // offlineStateBytes, which holds the same failure state.
    Object.assign(policy, {
        action: "OFFLINE_VIDEO_POLICY_ACTION_OK",
        shortMessageForDisabledAction: undefined,
        offlineStateBytes: undefined,
        expirationTimestamp: Number(policy.lastUpdatedTimestampSeconds || now) + ONE_YEAR_SECONDS,
    });

    const transferEntityKey = offlineEntityKey(videoId, OFFLINE_ENTITY_TYPE.transfer);
    Object.assign(playbackData, {
        transfer: transferEntityKey,
        playerResponsePlayabilityCanPlayStatus: "OK",
        streamDownloadTimestampSeconds: playbackData["playerResponseTimestamp"],
        playerResponseJson: JSON.stringify({
            responseContext: playerResponseJson['responseContext'],
            attestation: playerResponseJson['attestation'],
            microformat: playerResponseJson['microformat'],
            offlineState: {
                action: "OK",
                expiresInSeconds: ONE_YEAR_SECONDS,
                isOfflineSharingAllowed: true,
                refreshInSeconds: ONE_YEAR_SECONDS,
            },
            playabilityStatus: playerResponseJson['playabilityStatus'],
            playbackTracking: playerResponseJson['playbackTracking'],
            playerConfig: playerResponseJson['playerConfig'],
            storyboards: playerResponseJson['storyboards'],
            streamingData,
            videoDetails: playerResponseJson['videoDetails'],
            trackingParams: playerResponseJson['trackingParams']
        })
    });

    if (video.refreshData) {
        console.debug("[Comfortable YT]", "Download:", "Replaced offline video refresh playback data entity.");
        return;
    }

    // Add orchestrationActions
    Object.assign(json, {
        orchestrationActions: [{
            entityKey: transferEntityKey,
            actionType: "OFFLINE_ORCHESTRATION_ACTION_TYPE_ADD",
            actionMetadata: {
                priority: 1,
                transferEntityActionMetadata: video.downloadParameters?.maximumDownloadQuality ? {
                    maximumDownloadQuality: video.downloadParameters.maximumDownloadQuality
                } : undefined
            }
        }]
    });

    console.debug("[Comfortable YT]", "Download:", "Replaced playback data entity.");
}

// endregion

function handleApiResponse(pathname, json, getRequest) {
    switch (pathname) {
        case "/youtubei/v1/offline": {
            const { url, body } = getRequest();
            return handleOfflineVideo(url, body);
        }
        case "/youtubei/v1/offline/get_download_action":
            handleDownloadAction(getRequest().body, json);
            return json;
        case "/youtubei/v1/offline/get_playback_data_entity": {
            const { url, body } = getRequest();
            return handlePlaybackDataEntity(url, body, json).then(() => json);
        }
        default:
            // undefined keeps the original response untouched
            return cleanJson(json) ? json : undefined;
    }
}

(function () {
    "use strict";

    // Quality switching limits (measured against base.js):
    // - setPlaybackQualityRange always uses reason "m". Only a locked range (min === max) changes the quality,
    //   and the SABR loader then rebuilds the media (emptied, then loadstart), cutting playback for about 0.1s.
    //   An unlocked downgrade range has no effect.
    // - Unlocking to ("auto", "auto") does not rebuild the media, but the quality only rises after the buffered
    //   low quality media plays out (buffered seconds / playback rate). Live streams buffer about 20s even at
    //   the live edge, so turning audio mode off also locks the quality.

    const QUALITY_BACKUP_KEY = "audio-mode-quality-backup";
    const PLAYER_STATE_PAUSED = 2;
    const QUALITY_STORAGE_KEY = "yt-player-quality";
    const FORCE_DOWNGRADE_DELAY_MS = 2 * 60 * 1000;
    const FADE_MS = 80;

    let switchGeneration = 0;
    let cancelPendingDowngrade = () => {};

    const getVideo = player => player.querySelector("video");

    /**
     * Uses timers instead of requestAnimationFrame: rAF stops while the window is covered, which leaves
     * the volume halfway (measured). Background pages throttle timers to one run every 1s to 1min,
     * so a hidden page gets the final volume at once.
     */
    function fadeVolume(video, to, ms) {
        if (document.hidden) {
            video.volume = to;
            return Promise.resolve();
        }
        const from = video.volume, start = performance.now();
        return new Promise(resolve => {
            const step = () => {
                const k = Math.min(1, (performance.now() - start) / ms);
                video.volume = from + (to - from) * k;
                if (k < 1) setTimeout(step, 16); else resolve();
            };
            step();
        });
    }

    function waitResumed(video, timeoutMs) {
        return new Promise(resolve => {
            const done = () => { clearTimeout(timer); video.removeEventListener("playing", done); video.removeEventListener("seeked", done); resolve(); };
            const timer = setTimeout(done, timeoutMs);
            video.addEventListener("playing", done);
            video.addEventListener("seeked", done);
        });
    }

    function waitEvent(video, name, timeoutMs) {
        return new Promise(resolve => {
            const done = () => { clearTimeout(timer); video.removeEventListener(name, done); resolve(); };
            const timer = setTimeout(done, timeoutMs);
            video.addEventListener(name, done);
        });
    }

    async function lockQuality(player, quality, generation, fade) {
        const video = getVideo(player);
        const fading = fade && video && !video.paused;
        const volume = video?.volume;
        if (fading) {
            await fadeVolume(video, 0, FADE_MS);
            if (generation !== switchGeneration) {
                video.volume = volume;
                return false;
            }
        }
        // Only a real pause resets the position to 0. seekTo does not work before playback starts,
        // after it ends, or while it loads.
        const paused = player.getPlayerState?.() === PLAYER_STATE_PAUSED;
        const live = video && player.getVideoData?.()?.isLive;
        const playing = video && !video.paused;
        const time = player.getCurrentTime();
        player.setPlaybackQualityRange(quality, quality);
        // After a rebuild, a live stream (paused or not) restarts from the start of the current 5s segment,
        // and an immediate seekTo also snaps to that start. Seeking back after the rebuild's own seeked
        // event (about 0.1s later) restores the exact position (measured).
        if (live && (paused || playing)) {
            await waitEvent(video, "seeked", 1500);
            player.seekTo(time, true);
        } else if (paused) {
            player.seekTo(time, true);
        }
        if (fading) {
            await waitResumed(video, 1500);
            await fadeVolume(video, volume, FADE_MS * 2);
        }
        return true;
    }

    function writeQualityPreference(qualityOrdinal) {
        const now = Date.now();
        wind.localStorage.setItem(QUALITY_STORAGE_KEY, JSON.stringify({
            data: JSON.stringify({quality: qualityOrdinal, previousQuality: qualityOrdinal}),
            expiration: now + 31104000 * 1000,
            creation: now,
        }));
    }

    function restoreQualityStorage(storage) {
        if (storage === null) wind.localStorage.removeItem(QUALITY_STORAGE_KEY);
        else wind.localStorage.setItem(QUALITY_STORAGE_KEY, storage);
    }

    function scheduleDowngrade(player, generation) {
        cancelPendingDowngrade();
        const video = getVideo(player);
        if (!video) return;
        const events = ["pause", "seeking", "waiting"];
        const cleanup = () => {
            clearTimeout(timer);
            events.forEach(name => video.removeEventListener(name, onEvent));
            cancelPendingDowngrade = () => {};
        };
        // Remove the listeners before locking, because the rebuild itself fires seeking and waiting.
        const trigger = fade => {
            cleanup();
            if (generation === switchGeneration && player.getPlaybackQuality?.() !== "tiny") lockQuality(player, "tiny", generation, fade);
        };
        // The end of playback also fires pause. Skip it and ads, and wait for the next interruption.
        const onEvent = () => { if (!video.ended && !player.classList.contains("ad-showing")) trigger(false); };
        const timer = setTimeout(() => trigger(true), FORCE_DOWNGRADE_DELAY_MS);
        events.forEach(name => video.addEventListener(name, onEvent));
        cancelPendingDowngrade = cleanup;
    }

    function restoreTarget(player, backup) {
        const levels = (player.getAvailableQualityLevels?.() || []).filter(q => q !== "auto" && q !== "tiny");
        if (backup.preferred !== "auto" && levels.includes(backup.preferred)) return backup.preferred;
        if (levels.includes(backup.quality)) return backup.quality;
        return levels[0];
    }

    function updateAudioThumbnail(player) {
        const videoId = player.getVideoData?.()?.video_id;
        player.style.setProperty("--cyt-audio-thumb", videoId ? `url("https://i.ytimg.com/vi/${videoId}/hqdefault.jpg")` : "none");
    }

    // Injected on the first applyAudioMode call, because documentElement may be null at document-start.
    function injectAudioModeStyle() {
        if (document.getElementById("cyt-audio-mode-style")) return;
        const style = document.createElement("style");
        style.id = "cyt-audio-mode-style";
        style.textContent = `
            html.cyt-audio-mode #movie_player:not(.ad-showing) .html5-video-container { visibility: hidden; }
            html.cyt-audio-mode #movie_player { background: var(--cyt-audio-thumb, none) center / contain no-repeat #000; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    async function applyAudioMode(enabled) {
        injectAudioModeStyle();
        const generation = ++switchGeneration;
        cancelPendingDowngrade();
        const player = document.getElementById("movie_player");
        if (enabled || !player?.setPlaybackQualityRange) document.documentElement.classList.toggle("cyt-audio-mode", enabled);
        if (!player?.setPlaybackQualityRange) return;
        updateAudioThumbnail(player);

        const backup = GM_getValue(QUALITY_BACKUP_KEY, false);
        if (enabled) {
            if (!backup) GM_setValue(QUALITY_BACKUP_KEY, {
                preferred: player.getPreferredQuality?.() || "auto",
                quality: player.getPlaybackQuality?.(),
                storage: wind.localStorage.getItem(QUALITY_STORAGE_KEY),
            });
            writeQualityPreference(144);
            if (player.getPlaybackQuality?.() === "tiny") return;
            if (getVideo(player)?.paused) lockQuality(player, "tiny", generation, false);
            else scheduleDowngrade(player, generation);
            return;
        }

        if (backup) {
            const target = restoreTarget(player, backup);
            if (player.getPlaybackQuality?.() === "tiny") {
                const done = target ? await lockQuality(player, target, generation, true) : true;
                if (!done || generation !== switchGeneration) return;
                if (backup.preferred === "auto" || !target) player.setPlaybackQualityRange("auto", "auto");
            }
            // setPlaybackQualityRange writes localStorage, so restore the backup last.
            restoreQualityStorage(backup.storage);
            GM_setValue(QUALITY_BACKUP_KEY, false);
        }
        if (generation === switchGeneration) document.documentElement.classList.remove("cyt-audio-mode");
    }

    // Add a option to settings panel
    function addSettingOption(text, idName, callback) {
        const onClick = function () {
            GM_setValue(idName, !GM_getValue(idName));
            this.setAttribute("aria-checked", GM_getValue(idName));
            callback(GM_getValue(idName));
        };
        const elem = document.getElementById(idName);
        if (elem) {
            elem.onclick = onClick;
            return;
        }
        const menu = document.querySelector("#movie_player .ytp-panel-menu");
        if (!menu) return;
        const divMenuItemElem = document.createElement("div");
        const divIconElem = document.createElement("div");
        const divLabelElem = document.createElement("div");
        const divContentElem = document.createElement("div");
        divMenuItemElem.classList.add("ytp-menuitem");
        divIconElem.classList.add("ytp-menuitem-icon");
        divLabelElem.classList.add("ytp-menuitem-label");
        divContentElem.classList.add("ytp-menuitem-content");
        const checkboxElem = document.createElement("div");
        checkboxElem.classList.add("ytp-menuitem-toggle-checkbox");
        divContentElem.appendChild(checkboxElem);
        divLabelElem.innerText = text;
        divMenuItemElem.id = idName;
        divMenuItemElem.setAttribute("role", "menuitemcheckbox");
        divMenuItemElem.setAttribute("aria-checked", GM_getValue(idName));
        divMenuItemElem.onclick = onClick;
        divMenuItemElem.appendChild(divIconElem);
        divMenuItemElem.appendChild(divLabelElem);
        divMenuItemElem.appendChild(divContentElem);
        menu.appendChild(divMenuItemElem);
    }

    // Listener to load options
    wind.addEventListener("yt-navigate-finish", function () {
        if (!document.getElementById("movie_player")) return;
        addSettingOption("Audio Mode", AUDIO_MODE_KEY, applyAudioMode);
        applyAudioMode(!!GM_getValue(AUDIO_MODE_KEY));
    });

    // The player computes idle time as Date.now() - window._lact. Refreshing it stops the idle pause prompt.
    setInterval(() => {
        wind._lact = Date.now();
    }, 60 * 1000);

    // Wraps only XMLHttpRequest.prototype.open and send, and overrides response getters only on
    // /youtubei/v1/* and blocked logging requests. Other requests such as /api/timedtext stay native,
    // so other scripts like kiss-translator can still hook them. See issue #6.
    function applyNetworkHook() {
        const origFetch = wind.fetch;
        const proto = wind.XMLHttpRequest.prototype;
        const origOpen = proto.open, origSend = proto.send;
        /** Per-request state, only for requests this script handles. */
        const states = new WeakMap();
        const OVERRIDDEN_KEYS = ["readyState", "status", "response", "responseText"];

        /** Reads a property from the prototype chain, skipping the instance's own override. */
        function protoGet(xhr, key) {
            for (let p = Object.getPrototypeOf(xhr); p; p = Object.getPrototypeOf(p)) {
                const desc = Object.getOwnPropertyDescriptor(p, key);
                if (desc) return desc.get ? desc.get.call(xhr) : desc.value;
            }
        }

        const isTextType = xhr => ["", "text"].includes(xhr.responseType);

        /** Lazily computes the modified response once the request is done. */
        function resolveMock(xhr, state) {
            if (state.done || protoGet(xhr, "readyState") !== 4) return;
            state.done = true;
            const result = handleXMLResponse(xhr, state, protoGet);
            if (result !== undefined) state.mock = result;
        }

        function defineOverrides(xhr, state) {
            const define = (key, get) => Object.defineProperty(xhr, key, { configurable: true, enumerable: false, get });
            if (state.blocked) {
                define("readyState", () => state.finished ? 4 : protoGet(xhr, "readyState"));
                ["response", "responseText"].forEach(key =>
                    define(key, () => state.finished && isTextType(xhr) ? "" : protoGet(xhr, key)));
                return;
            }
            define("status", () => {
                resolveMock(xhr, state);
                return state.mockStatus !== undefined ? state.mockStatus : protoGet(xhr, "status");
            });
            ["response", "responseText"].forEach(key => define(key, () => {
                resolveMock(xhr, state);
                return state.mock !== undefined && isTextType(xhr) ? state.mock : protoGet(xhr, key);
            }));
        }

        proto.open = function (_method, url, async) {
            if (states.has(this)) {
                states.delete(this);
                OVERRIDDEN_KEYS.forEach(key => delete this[key]);
            }
            const result = origOpen.apply(this, arguments);
            try {
                let fullUrl = String(url);
                if (fullUrl.startsWith("//")) fullUrl = `https:${fullUrl}`;
                const parsedUrl = new URL(fullUrl, location.origin);
                let state = null;
                if (!handleRequest(parsedUrl))
                    state = { blocked: true, sync: arguments.length > 2 && !async, finished: false };
                else if (parsedUrl.pathname.startsWith("/youtubei/v1/"))
                    state = { blocked: false, url, body: null, done: false, mock: undefined, mockStatus: undefined };
                if (state) {
                    states.set(this, state);
                    defineOverrides(this, state);
                }
            } catch (e) {
                console.error("[Comfortable YT]", "xhr open hook error:", e);
            }
            return result;
        };

        proto.send = function (body) {
            const state = states.get(this);
            if (state?.blocked) {
                // Pretend the request finished without sending it
                const finish = () => {
                    if (states.get(this) !== state) return;  // Reopened meanwhile
                    state.finished = true;
                    this.dispatchEvent(new Event("readystatechange"));
                    ["load", "loadend"].forEach(type => this.dispatchEvent(new ProgressEvent(type)));
                };
                if (state.sync) finish();
                else setTimeout(finish);
                return;
            }
            if (state) state.body = body ?? null;
            return origSend.apply(this, arguments);
        };

        const fetchHook = async function (input, init) {
            let url, request = null;
            try {
                url = new URL(input instanceof Request ? input.url : String(input), location.origin);
                if (!handleRequest(url)) return new Response();
                if (url.pathname.startsWith("/youtubei/v1/offline"))
                    request = input instanceof Request ? input.clone() : new Request(input, init);
            } catch (e) {
                console.error("[Comfortable YT]", "fetch hook error:", e);
            }

            const response = await origFetch.apply(this, arguments);
            if (!url || !url.pathname.startsWith("/youtubei/v1/") || ["error", "opaqueredirect"].includes(response.type) || response.status === 0) return response;
            return await handleFetchResponse(url, request, response);
        }

        // Blocks beacons to YouTube and Google hosts only
        const origSendBeacon = wind.navigator.sendBeacon;
        const sendBeaconHook = function (url) {
            try {
                if (isYouTubeOrGoogleHost(new URL(String(url), location.href))) return true;
            } catch (e) {
                // Invalid URL: let the native method throw its own error
            }
            return origSendBeacon.apply(this, arguments);
        };

        wind.fetch = fetchHook;
        if (typeof origSendBeacon === "function") wind.navigator.sendBeacon = sendBeaconHook;
        console.info("[Comfortable YT]", "Network hook applied.");
    }

    function isYouTubeOrGoogleHost(url) {
        return /(^|\.)(youtube|google)\.com$/.test(url.hostname);
    }

    /** Returns false for logging requests that should be blocked. */
    function handleRequest(url) {
        if (!isYouTubeOrGoogleHost(url)) return true;
        const path = url.pathname;
        // "/log" (e.g. play.google.com/log), "/log_*" and "/log/*", but not "/login", "/logout", "/logo*", ...
        return !(path.startsWith("/youtubei/v1/log_event") || /^\/log(?:$|[_/])/.test(path));
    }

    // Handle xml response. Reads the underlying values through protoGet, bypassing the instance overrides.
    function handleXMLResponse(xhr, state, protoGet) {
        const responseURL = xhr.responseURL;
        if (!responseURL) return;
        try {
            const url = new URL(responseURL);
            if (!url.pathname.startsWith("/youtubei/v1/")) return;
            const isOffline = url.pathname === "/youtubei/v1/offline";
            if (isOffline && protoGet(xhr, "status") !== 401) return;
            if (!["", "text"].includes(xhr.responseType)) return;
            const text = protoGet(xhr, "responseText");
            if (!text || !"{[".includes(text.trimStart()[0])) return;
            const json = handleApiResponse(url.pathname, JSON.parse(text), () => ({
                url: state.url,
                body: JSON.parse(state.body)
            }));
            if (json === undefined || json instanceof Promise) return;
            if (isOffline) state.mockStatus = 200;
            return JSON.stringify(json);
        } catch (e) {
            console.error("[Comfortable YT]", "handleXMLResponse", `URL(${responseURL})`, "Error:", e);
        }
    }

    /** Parses a request body as JSON. YouTube gzips some youtubei request bodies, such as the offline endpoints. */
    async function readRequestJson(request) {
        const bytes = new Uint8Array(await request.arrayBuffer());
        const stream = new Blob([bytes]).stream();
        const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
        return JSON.parse(await new Response(gzipped ? stream.pipeThrough(new DecompressionStream("gzip")) : stream).text());
    }

    // Handle fetch response
    async function handleFetchResponse(url, request, resp) {
        try {
            if (!url.pathname.startsWith("/youtubei/v1/")) return resp;
            if (!(resp.headers.get("Content-Type") || "").includes("application/json")) return resp;
            const isOffline = url.pathname === "/youtubei/v1/offline";
            if (isOffline && resp.status !== 401) return resp;

            const requestBody = request ? await readRequestJson(request) : null;
            const json = await handleApiResponse(url.pathname, await resp.clone().json(), () => ({
                url: request.url,
                body: requestBody
            }));
            if (json === undefined) return resp;
            return createFetchResponse(json, resp, isOffline ? 200 : undefined);
        } catch (e) {
            console.error("[Comfortable YT]", "handleFetchResponse", `URL(${resp.url})`, "Error:", e);
        }
        return resp;
    }

    // Handle fetch response body
    function createFetchResponse(json, data, customStatus) {
        const headers = new Headers(data.headers);
        // The body is re-serialized and no longer encoded, so the original length / encoding do not apply
        headers.delete("Content-Length");
        headers.delete("Content-Encoding");
        const response = new Response(JSON.stringify(json), {
            status: customStatus || data.status,
            statusText: data.statusText,
            headers,
        });
        // "ok" is left native so that it follows the (possibly custom) status
        return keepResponseMeta(response, { redirected: data.redirected, type: data.type, url: data.url });
    }

    /** Copies read-only response metadata onto a constructed Response, and onto its clones. */
    function keepResponseMeta(response, meta) {
        Object.entries(meta).forEach(([key, value]) => {
            Object.defineProperty(response, key, { configurable: true, value });
        });
        Object.defineProperty(response, "clone", {
            configurable: true,
            writable: true,
            value: function () {
                return keepResponseMeta(Response.prototype.clone.call(this), meta);
            },
        });
        return response;
    }

    function hookInitialData(name) {
        Object.defineProperty(wind, name, {
            configurable: true,
            set: function (json) {
                delete wind[name];
                runStep(`clean ${name}`, () => cleanJson(json));
                wind[name] = json;
            },
        });
    }

    // Init
    hookInitialData("ytInitialPlayerResponse");
    hookInitialData("ytInitialData");
    applyNetworkHook();
})();
