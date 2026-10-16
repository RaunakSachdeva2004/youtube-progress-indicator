/**
 * YouTube Video Progress Percentage Indicator
 * Content Script (Manifest V3)
 *
 * Calculates and renders real-time video playback progress (%) inside the
 * top-right corner of the active YouTube video player, supporting regular
 * videos, Theater mode, Fullscreen mode, YouTube Shorts, SPA navigation,
 * and live streams.
 */

(() => {
  'use strict';

  const OVERLAY_ID = 'yt-watch-progress-indicator';
  const COMPACT_PLAYER_WIDTH = 480;

  const VIDEO_EVENTS = [
    'loadedmetadata',
    'durationchange',
    'timeupdate',
    'seeking',
    'seeked',
    'play',
    'pause',
    'ended',
    'emptied'
  ];

  // State tracking to prevent duplicate listeners and redundant DOM writes
  let currentVideo = null;
  let currentContainer = null;
  let overlayElement = null;
  let textElement = null;
  let fillElement = null;
  let resizeObserver = null;
  let mutationRafId = null;
  let lastknownUrl = window.location.href;

  // Cached render values to avoid unnecessary DOM updates
  let lastRenderedText = '';
  let lastRenderedWidth = '';
  let lastRenderedHidden = true;
  let lastRenderedShorts = false;
  let lastRenderedCompact = false;

  /**
   * Checks whether the current URL is a page where a main or Shorts video plays.
   * Also supports channel/watch/shorts views whenever a primary player is active.
   */
  function isSupportedPageContext() {
    const path = window.location.pathname;
    if (
      path.startsWith('/watch') ||
      path.startsWith('/shorts') ||
      path.startsWith('/live') ||
      path.startsWith('/embed')
    ) {
      return true;
    }
    // Also allow if #movie_player is actively playing a video on a channel page
    const moviePlayer = document.getElementById('movie_player');
    if (moviePlayer && !moviePlayer.classList.contains('unstarted-mode')) {
      return true;
    }
    return false;
  }

  /**
   * Finds the primary active HTMLVideoElement on the page.
   * Prioritizes YouTube Shorts active reel when on /shorts, and #movie_player on /watch.
   */
  function findActiveVideoElement() {
    const path = window.location.pathname;

    // 1. YouTube Shorts page priority
    if (path.startsWith('/shorts')) {
      const shortsVideo =
        document.querySelector('ytd-reel-video-renderer[is-active] video.html5-main-video') ||
        document.querySelector('ytd-reel-video-renderer[is-active] video') ||
        document.querySelector('#shorts-player video.html5-main-video') ||
        document.querySelector('#shorts-player video');
      if (shortsVideo) {
        return shortsVideo;
      }
    }

    // 2. Standard YouTube Watch / Embed / Live player (#movie_player)
    const moviePlayerVideo =
      document.querySelector('#movie_player video.html5-main-video') ||
      document.querySelector('#movie_player video');
    if (moviePlayerVideo) {
      return moviePlayerVideo;
    }

    // 3. Fallback to any visible .html5-video-player video
    const candidateVideos = document.querySelectorAll('.html5-video-player video');
    for (const video of candidateVideos) {
      if (video.offsetWidth > 0 && video.offsetHeight > 0) {
        return video;
      }
    }

    return null;
  }

  /**
   * Resolves the appropriate player container element for positioning the overlay,
   * accounting for normal mode, theater mode, Shorts, and browser Fullscreen mode.
   */
  function resolvePlayerContainer(video) {
    if (!video) {
      return null;
    }

    // Standard player containers wrapping the video element
    const basePlayer =
      video.closest('#movie_player') ||
      video.closest('#shorts-player') ||
      video.closest('.html5-video-player') ||
      document.getElementById('movie_player') ||
      video.parentElement;

    const fullscreenEl =
      document.fullscreenElement || document.webkitFullscreenElement || null;

    if (!fullscreenEl) {
      return basePlayer;
    }

    // Fullscreen handling:
    // Ensure the indicator's container is inside the active fullscreen element tree.
    if (basePlayer && fullscreenEl.contains(basePlayer)) {
      return basePlayer;
    }

    // If the <video> element itself entered native fullscreen, it cannot render child nodes;
    // attach to its parent if inside fullscreen, otherwise basePlayer.
    if (fullscreenEl === video) {
      return video.parentElement || basePlayer;
    }

    // If another player ancestor/wrapper became fullscreen and contains the video,
    // attach directly inside that fullscreen element so the indicator remains visible.
    if (fullscreenEl.contains(video)) {
      return fullscreenEl;
    }

    return basePlayer;
  }

  /**
   * Creates the single overlay DOM structure or returns the existing one,
   * removing any accidental duplicate nodes.
   */
  function getOrCreateOverlay() {
    const existingNodes = document.querySelectorAll(`#${OVERLAY_ID}`);
    if (existingNodes.length > 1) {
      for (let i = 1; i < existingNodes.length; i++) {
        existingNodes[i].remove();
      }
    }

    if (overlayElement && document.contains(overlayElement)) {
      return overlayElement;
    }

    if (existingNodes.length === 1) {
      overlayElement = existingNodes[0];
      textElement = overlayElement.querySelector('.yt-progress-indicator__text');
      fillElement = overlayElement.querySelector('.yt-progress-indicator__fill');
      if (textElement && fillElement) {
        return overlayElement;
      }
      overlayElement.remove();
    }

    const container = document.createElement('div');
    container.id = OVERLAY_ID;
    container.className = 'yt-progress-indicator--hidden';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'off');
    container.setAttribute('aria-label', 'YouTube video watched percentage');

    const row = document.createElement('div');
    row.className = 'yt-progress-indicator__row';

    const text = document.createElement('span');
    text.className = 'yt-progress-indicator__text';
    text.textContent = 'Watched: 0.0%';

    const track = document.createElement('div');
    track.className = 'yt-progress-indicator__track';

    const fill = document.createElement('div');
    fill.className = 'yt-progress-indicator__fill';
    fill.style.width = '0.0%';

    row.appendChild(text);
    track.appendChild(fill);
    container.appendChild(row);
    container.appendChild(track);

    overlayElement = container;
    textElement = text;
    fillElement = fill;

    // Reset cache when creating fresh DOM nodes
    lastRenderedText = 'Watched: 0.0%';
    lastRenderedWidth = '0.0%';
    lastRenderedHidden = true;
    lastRenderedShorts = false;
    lastRenderedCompact = false;

    return overlayElement;
  }

  /**
   * Ensures the overlay is attached to the target player container and
   * observes container resize events.
   */
  function attachOverlayToContainer(targetContainer) {
    if (!targetContainer) {
      return;
    }

    const overlay = getOrCreateOverlay();

    // Ensure the target container establishes a positioning context if not already positioned
    const computedStyle = window.getComputedStyle(targetContainer);
    if (computedStyle.position === 'static') {
      targetContainer.style.position = 'relative';
    }

    if (overlay.parentElement !== targetContainer) {
      targetContainer.appendChild(overlay);
    }

    if (currentContainer !== targetContainer) {
      if (resizeObserver && currentContainer) {
        resizeObserver.unobserve(currentContainer);
      }
      currentContainer = targetContainer;
      if (resizeObserver) {
        resizeObserver.observe(currentContainer);
      }
    }

    updateContainerResponsiveState();
  }

  /**
   * Adjusts modifier classes on the overlay based on whether the player is a Shorts
   * container or a narrow/compact player.
   */
  function updateContainerResponsiveState() {
    if (!overlayElement || !currentContainer) {
      return;
    }

    const isShorts =
      window.location.pathname.startsWith('/shorts') ||
      currentContainer.id === 'shorts-player' ||
      Boolean(currentContainer.closest('ytd-reel-video-renderer'));

    if (isShorts !== lastRenderedShorts) {
      overlayElement.classList.toggle('yt-progress-indicator--shorts', isShorts);
      lastRenderedShorts = isShorts;
    }

    const playerWidth = currentContainer.clientWidth || 0;
    const isCompact = playerWidth > 0 && playerWidth < COMPACT_PLAYER_WIDTH;
    if (isCompact !== lastRenderedCompact) {
      overlayElement.classList.toggle('yt-progress-indicator--compact', isCompact);
      lastRenderedCompact = isCompact;
    }
  }

  /**
   * Determines whether the currently playing video is a live stream.
   */
  function isLiveStream(video, container) {
    if (!video) {
      return false;
    }

    // Native HTML5 infinite duration check
    if (video.duration === Infinity) {
      return true;
    }

    // YouTube player UI live stream indicators (MSE live streams often report a rolling buffer duration)
    const scope = container || document;
    const liveTimeDisplay = scope.querySelector('.ytp-time-display.ytp-live');
    if (liveTimeDisplay) {
      // If the user is watching a live stream (and it hasn't converted to a finished VOD replay)
      const liveBadge = liveTimeDisplay.querySelector('.ytp-live-badge');
      if (!liveBadge || !liveBadge.hasAttribute('disabled')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Hides the overlay without destroying it.
   */
  function hideOverlay() {
    if (!overlayElement) {
      return;
    }
    if (!lastRenderedHidden) {
      overlayElement.classList.add('yt-progress-indicator--hidden');
      lastRenderedHidden = true;
    }
  }

  /**
   * Shows the overlay and updates the text and progress bar fill only if changed.
   */
  function renderOverlayState(textValue, widthPercentString) {
    const overlay = getOrCreateOverlay();

    if (lastRenderedHidden) {
      overlay.classList.remove('yt-progress-indicator--hidden');
      lastRenderedHidden = false;
    }

    if (textElement && lastRenderedText !== textValue) {
      textElement.textContent = textValue;
      lastRenderedText = textValue;
    }

    if (fillElement && lastRenderedWidth !== widthPercentString) {
      fillElement.style.width = widthPercentString;
      lastRenderedWidth = widthPercentString;
    }
  }

  /**
   * Calculates current playback progress and updates the indicator.
   */
  function updateProgress() {
    if (!isSupportedPageContext() || !currentVideo || !document.contains(currentVideo)) {
      hideOverlay();
      return;
    }

    const targetContainer = resolvePlayerContainer(currentVideo);
    if (!targetContainer) {
      hideOverlay();
      return;
    }

    attachOverlayToContainer(targetContainer);

    const hasSource = Boolean(currentVideo.currentSrc || currentVideo.src);
    if (!hasSource && currentVideo.readyState === 0) {
      hideOverlay();
      return;
    }

    // Check for live streams first
    if (isLiveStream(currentVideo, targetContainer)) {
      renderOverlayState('LIVE', '100%');
      return;
    }

    const duration = currentVideo.duration;
    const currentTime = currentVideo.currentTime;

    // Safely handle zero, invalid, NaN, or non-finite durations
    if (!Number.isFinite(duration) || duration <= 0 || Number.isNaN(currentTime)) {
      hideOverlay();
      return;
    }

    let percentage = 0;
    if (currentVideo.ended) {
      percentage = 100;
    } else {
      percentage = (currentTime / duration) * 100;
    }

    // Clamp percentage between 0 and 100
    const clampedPercentage = Math.min(100, Math.max(0, percentage));
    const formattedPercentage = clampedPercentage.toFixed(1);

    const displayString = `Watched: ${formattedPercentage}%`;
    const widthString = `${formattedPercentage}%`;

    renderOverlayState(displayString, widthString);
  }

  /**
   * Detaches event listeners from the previously tracked HTMLVideoElement.
   */
  function detachVideoListeners(video) {
    if (!video) {
      return;
    }
    for (const eventName of VIDEO_EVENTS) {
      video.removeEventListener(eventName, handleVideoEvent);
    }
  }

  /**
   * Attaches playback and metadata event listeners to the active HTMLVideoElement.
   */
  function attachVideoListeners(video) {
    if (!video) {
      return;
    }
    for (const eventName of VIDEO_EVENTS) {
      video.addEventListener(eventName, handleVideoEvent, { passive: true });
    }
  }

  /**
   * Unified event handler for HTMLVideoElement events.
   */
  function handleVideoEvent(event) {
    if (event.type === 'emptied') {
      hideOverlay();
      return;
    }
    updateProgress();
  }

  /**
   * Synchronizes the extension with the currently active video and player container.
   * Called on initial load, SPA navigation, fullscreen transitions, and DOM mutations.
   */
  function syncPlayerAndVideo() {
    if (!isSupportedPageContext()) {
      if (currentVideo) {
        detachVideoListeners(currentVideo);
        currentVideo = null;
      }
      hideOverlay();
      return;
    }

    const detectedVideo = findActiveVideoElement();

    if (!detectedVideo) {
      if (currentVideo) {
        detachVideoListeners(currentVideo);
        currentVideo = null;
      }
      hideOverlay();
      return;
    }

    // If the underlying video element changed, clean up old listeners and bind new ones
    if (detectedVideo !== currentVideo) {
      if (currentVideo) {
        detachVideoListeners(currentVideo);
      }
      currentVideo = detectedVideo;
      attachVideoListeners(currentVideo);
    }

    const targetContainer = resolvePlayerContainer(currentVideo);
    if (targetContainer) {
      attachOverlayToContainer(targetContainer);
    }

    updateProgress();
  }

  /**
   * Handles SPA navigation changes when switching between YouTube videos or Shorts.
   */
  function handleNavigation() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastknownUrl) {
      lastknownUrl = currentUrl;
      // Reset cached text so the new video state updates cleanly
      lastRenderedText = '';
      lastRenderedWidth = '';
    }
    syncPlayerAndVideo();
  }

  /**
   * Handles browser fullscreen changes to guarantee the indicator stays inside
   * the active fullscreen element.
   */
  function handleFullscreenChange() {
    syncPlayerAndVideo();
    updateContainerResponsiveState();
  }

  /**
   * Coalesces DOM mutation callbacks into a single requestAnimationFrame pass
   * to keep CPU usage minimal during heavy YouTube page updates.
   */
  function scheduleMutationSync() {
    if (mutationRafId !== null) {
      return;
    }
    mutationRafId = window.requestAnimationFrame(() => {
      mutationRafId = null;
      if (window.location.href !== lastknownUrl) {
        handleNavigation();
      } else {
        syncPlayerAndVideo();
      }
    });
  }

  /**
   * Initializes observers and global event listeners.
   */
  function initialize() {
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateContainerResponsiveState();
      });
    }

    // YouTube SPA navigation and history events
    window.addEventListener('yt-navigate-start', handleNavigation, { passive: true });
    window.addEventListener('yt-navigate-finish', handleNavigation, { passive: true });
    window.addEventListener('yt-page-data-updated', handleNavigation, { passive: true });
    window.addEventListener('popstate', handleNavigation, { passive: true });
    window.addEventListener('resize', updateContainerResponsiveState, { passive: true });

    // Fullscreen change events (standard + webkit fallback)
    document.addEventListener('fullscreenchange', handleFullscreenChange, { passive: true });
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange, { passive: true });

    // Observe dynamic DOM changes (player replacement, Shorts scrolling, theater mode toggles)
    const observerTarget = document.body || document.documentElement;
    if (observerTarget) {
      const observer = new MutationObserver(scheduleMutationSync);
      observer.observe(observerTarget, {
        childList: true,
        subtree: true
      });
    }

    // Initial detection pass
    syncPlayerAndVideo();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();