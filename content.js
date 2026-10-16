/**
 * YouTube Video Progress Percentage Indicator
 * Content Script (Manifest V3)
 *
 * Displays real-time watch percentage and a matching progress bar docked in the
 * YouTube masthead (left of the '+ Create' button) or placed anywhere on the page
 * via drag-and-drop.
 */

(() => {
  'use strict';

  const OVERLAY_ID = 'yt-watch-progress-indicator';
  const STORAGE_KEY = 'yt-progress-indicator-pos';

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

  // State tracking
  let currentVideo = null;
  let overlayElement = null;
  let textElement = null;
  let fillElement = null;
  let mutationRafId = null;
  let lastknownUrl = window.location.href;

  // Cached render values to avoid unnecessary DOM writes
  let lastRenderedText = '';
  let lastRenderedWidth = '';
  let lastRenderedHidden = true;

  // Drag-and-drop state
  let isPointerDown = false;
  let hasDragged = false;
  let startX = 0;
  let startY = 0;
  let elementStartX = 0;
  let elementStartY = 0;

  /**
   * Retrieves saved custom coordinates from localStorage, if any.
   */
  function getSavedPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return parsed;
      }
    } catch (e) {
      // Ignore JSON or storage errors
    }
    return null;
  }

  /**
   * Saves custom coordinates to localStorage.
   */
  function savePosition(x, y) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y }));
    } catch (e) {
      // Ignore storage errors
    }
  }

  /**
   * Clears saved custom position from localStorage.
   */
  function clearSavedPosition() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // Ignore storage errors
    }
  }

  /**
   * Checks whether the current URL is a page where a video plays.
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
    const moviePlayer = document.getElementById('movie_player');
    if (moviePlayer && !moviePlayer.classList.contains('unstarted-mode')) {
      return true;
    }
    return false;
  }

  /**
   * Finds the primary active HTMLVideoElement on the page.
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

    // 2. Standard YouTube Watch / Live player (#movie_player)
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
   * Finds the YouTube masthead insertion target (left of the Create button).
   */
  function findMastheadTarget() {
    const masthead = document.querySelector('ytd-masthead');
    if (!masthead) {
      return null;
    }

    const endSection = masthead.querySelector('#end');
    if (!endSection) {
      return null;
    }

    const buttonsContainer = endSection.querySelector('#buttons');

    // 1. Try to locate the Create button container directly
    const createButton =
      endSection.querySelector('ytd-button-renderer:has(button[aria-label*="Create" i])') ||
      endSection.querySelector('yt-button-view-model:has(button[aria-label*="Create" i])') ||
      endSection.querySelector('button[aria-label*="Create" i]')?.closest('ytd-button-renderer, yt-button-view-model, ytd-topbar-menu-button-renderer') ||
      endSection.querySelector('button[aria-label*="Create" i]');

    if (createButton) {
      return {
        parent: createButton.parentElement,
        referenceNode: createButton
      };
    }

    // 2. If #buttons exists, insert before its first child (which is usually the Create button)
    if (buttonsContainer) {
      return {
        parent: buttonsContainer,
        referenceNode: buttonsContainer.firstElementChild
      };
    }

    // 3. Fallback: prepend to #end
    return {
      parent: endSection,
      referenceNode: endSection.firstElementChild
    };
  }

  /**
   * Docks the overlay element into the YouTube masthead left of the Create button.
   */
  function dockOverlayToMasthead(overlay) {
    if (!overlay) {
      return false;
    }

    const target = findMastheadTarget();
    if (!target || !target.parent) {
      return false;
    }

    overlay.classList.remove('yt-progress-indicator--floating');
    overlay.classList.remove('yt-progress-indicator--dragging');
    overlay.style.left = '';
    overlay.style.top = '';

    if (target.referenceNode && target.referenceNode !== overlay) {
      if (
        overlay.nextElementSibling !== target.referenceNode ||
        overlay.parentElement !== target.parent
      ) {
        target.parent.insertBefore(overlay, target.referenceNode);
      }
    } else if (overlay.parentElement !== target.parent) {
      target.parent.insertBefore(overlay, target.parent.firstElementChild);
    }

    return true;
  }

  /**
   * Ensures the overlay is positioned correctly (either at custom floating coords or docked in the masthead).
   */
  function ensureOverlayPlacement() {
    const overlay = getOrCreateOverlay();
    if (!overlay) {
      return;
    }

    const savedPos = getSavedPosition();

    if (savedPos) {
      // Floating mode with saved custom position
      overlay.classList.add('yt-progress-indicator--floating');
      if (overlay.parentElement !== document.body) {
        document.body.appendChild(overlay);
      }
      const overlayWidth = overlay.offsetWidth || 76;
      const overlayHeight = overlay.offsetHeight || 36;
      const maxLeft = Math.max(0, window.innerWidth - overlayWidth);
      const maxTop = Math.max(0, window.innerHeight - overlayHeight);
      const clampedX = Math.max(0, Math.min(maxLeft, savedPos.x));
      const clampedY = Math.max(0, Math.min(maxTop, savedPos.y));
      overlay.style.left = `${clampedX}px`;
      overlay.style.top = `${clampedY}px`;
    } else {
      // Docked mode in masthead
      dockOverlayToMasthead(overlay);
    }
  }

  /**
   * Drag-and-drop pointer event handlers.
   */
  function onPointerDown(e) {
    if (e.button !== 0) {
      return; // Only left mouse button
    }

    isPointerDown = true;
    hasDragged = false;
    startX = e.clientX;
    startY = e.clientY;

    const rect = overlayElement.getBoundingClientRect();
    elementStartX = rect.left;
    elementStartY = rect.top;

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!isPointerDown) {
      return;
    }

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!hasDragged) {
      // Threshold check to distinguish intentional drag from a click
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDragged = true;
        overlayElement.classList.add('yt-progress-indicator--dragging');
        overlayElement.classList.add('yt-progress-indicator--floating');
        if (overlayElement.parentElement !== document.body) {
          document.body.appendChild(overlayElement);
        }
      } else {
        return;
      }
    }

    e.preventDefault();

    const overlayWidth = overlayElement.offsetWidth || 76;
    const overlayHeight = overlayElement.offsetHeight || 36;
    const maxLeft = Math.max(0, window.innerWidth - overlayWidth);
    const maxTop = Math.max(0, window.innerHeight - overlayHeight);

    const newLeft = Math.max(0, Math.min(maxLeft, elementStartX + dx));
    const newTop = Math.max(0, Math.min(maxTop, elementStartY + dy));

    overlayElement.style.left = `${newLeft}px`;
    overlayElement.style.top = `${newTop}px`;
  }

  function onPointerUp() {
    if (!isPointerDown) {
      return;
    }
    isPointerDown = false;

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    if (hasDragged) {
      overlayElement.classList.remove('yt-progress-indicator--dragging');
      const rect = overlayElement.getBoundingClientRect();
      savePosition(Math.round(rect.left), Math.round(rect.top));
    }
  }

  function onDoubleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    clearSavedPosition();
    dockOverlayToMasthead(overlayElement);
  }

  function handleWindowResize() {
    const savedPos = getSavedPosition();
    if (savedPos && overlayElement && overlayElement.classList.contains('yt-progress-indicator--floating')) {
      const overlayWidth = overlayElement.offsetWidth || 76;
      const overlayHeight = overlayElement.offsetHeight || 36;
      const maxLeft = Math.max(0, window.innerWidth - overlayWidth);
      const maxTop = Math.max(0, window.innerHeight - overlayHeight);
      const clampedX = Math.max(0, Math.min(maxLeft, savedPos.x));
      const clampedY = Math.max(0, Math.min(maxTop, savedPos.y));
      overlayElement.style.left = `${clampedX}px`;
      overlayElement.style.top = `${clampedY}px`;
    }
  }

  /**
   * Creates the single overlay DOM structure or returns the existing one.
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
    container.setAttribute('aria-label', 'YouTube video watch percentage');
    container.title = 'YouTube Progress • Drag to reposition • Double-click to dock to header';

    const text = document.createElement('span');
    text.className = 'yt-progress-indicator__text';
    text.textContent = '0.0%';

    const track = document.createElement('div');
    track.className = 'yt-progress-indicator__track';

    const fill = document.createElement('div');
    fill.className = 'yt-progress-indicator__fill';
    fill.style.width = '0.0%';

    track.appendChild(fill);
    container.appendChild(text);
    container.appendChild(track);

    // Bind dragging and reset listeners
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('dblclick', onDoubleClick);

    overlayElement = container;
    textElement = text;
    fillElement = fill;

    lastRenderedText = '0.0%';
    lastRenderedWidth = '0.0%';
    lastRenderedHidden = true;

    return overlayElement;
  }

  /**
   * Determines whether the video is a live stream.
   */
  function isLiveStream(video) {
    if (!video) {
      return false;
    }
    if (video.duration === Infinity) {
      return true;
    }
    const liveTimeDisplay = document.querySelector('.ytp-time-display.ytp-live');
    if (liveTimeDisplay) {
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

    ensureOverlayPlacement();

    const hasSource = Boolean(currentVideo.currentSrc || currentVideo.src);
    if (!hasSource && currentVideo.readyState === 0) {
      hideOverlay();
      return;
    }

    // Live streams
    if (isLiveStream(currentVideo)) {
      renderOverlayState('LIVE', '100%');
      return;
    }

    const duration = currentVideo.duration;
    const currentTime = currentVideo.currentTime;

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

    const clampedPercentage = Math.min(100, Math.max(0, percentage));
    const formattedPercentage = clampedPercentage.toFixed(1);

    const displayString = `${formattedPercentage}%`;
    const widthString = `${formattedPercentage}%`;

    renderOverlayState(displayString, widthString);
  }

  /**
   * Detaches event listeners from previously tracked HTMLVideoElement.
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
   * Attaches event listeners to the active HTMLVideoElement.
   */
  function attachVideoListeners(video) {
    if (!video) {
      return;
    }
    for (const eventName of VIDEO_EVENTS) {
      video.addEventListener(eventName, handleVideoEvent, { passive: true });
    }
  }

  function handleVideoEvent(event) {
    if (event.type === 'emptied') {
      hideOverlay();
      return;
    }
    updateProgress();
  }

  /**
   * Synchronizes the extension with active video and masthead/floating container.
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

    if (detectedVideo !== currentVideo) {
      if (currentVideo) {
        detachVideoListeners(currentVideo);
      }
      currentVideo = detectedVideo;
      attachVideoListeners(currentVideo);
    }

    ensureOverlayPlacement();
    updateProgress();
  }

  /**
   * Handles SPA navigation changes.
   */
  function handleNavigation() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastknownUrl) {
      lastknownUrl = currentUrl;
      lastRenderedText = '';
      lastRenderedWidth = '';
    }
    syncPlayerAndVideo();
  }

  /**
   * Coalesces DOM mutations into a single requestAnimationFrame pass.
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
   * Initializes listeners and observers.
   */
  function initialize() {
    // YouTube SPA navigation events
    window.addEventListener('yt-navigate-start', handleNavigation, { passive: true });
    window.addEventListener('yt-navigate-finish', handleNavigation, { passive: true });
    window.addEventListener('yt-page-data-updated', handleNavigation, { passive: true });
    window.addEventListener('popstate', handleNavigation, { passive: true });
    window.addEventListener('resize', handleWindowResize, { passive: true });

    // Observe dynamic DOM changes (header updates, video swaps)
    const observerTarget = document.body || document.documentElement;
    if (observerTarget) {
      const observer = new MutationObserver(scheduleMutationSync);
      observer.observe(observerTarget, {
        childList: true,
        subtree: true
      });
    }

    syncPlayerAndVideo();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();