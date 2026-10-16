# YouTube Video Progress Percentage Indicator (Brave Extension)

A lightweight, zero-dependency Manifest V3 browser extension for Brave that automatically displays the percentage of a YouTube video you have watched inside the top-right corner of the YouTube video player.

## Project Structure

```text
youtube-progress-indicator/
├── manifest.json
├── content.js
├── styles.css
└── README.md
```

## Features

- **Automatic Real-Time Calculation**: Computes `Progress (%) = (video.currentTime / video.duration) * 100` directly from the native HTML5 `<video>` element and formats to one decimal place (e.g., `Watched: 23.7%`).
- **Minimal Black & Red UI**: High-contrast black background (`#000000` with subtle opacity), bold bright red text (`#FF0000`), and a matching thin red horizontal progress bar underneath.
- **Anchored Inside the Player**: Attaches directly to YouTube's player container (`#movie_player` on watch pages and `#shorts-player` on Shorts) using `position: absolute` so it stays inside the top-right corner of the video rather than floating over the browser viewport.
- **Normal, Theater & Fullscreen Support**: Listens to `fullscreenchange` and `ResizeObserver` events to ensure the overlay remains inside the active fullscreen element and adapts cleanly when resizing or toggling Theater mode.
- **YouTube SPA & Shorts Compatible**: Handles YouTube's single-page navigation (`yt-navigate-finish`, `yt-page-data-updated`, `popstate`) and dynamic `<video>` replacement via a coalesced `MutationObserver` without creating duplicate overlays.
- **Graceful Live Stream Handling**: Detects infinite durations and YouTube live badges (`.ytp-live`) and displays `LIVE` instead of invalid percentages.
- **Zero Special Permissions**: Runs purely locally via content scripts on YouTube pages with `"permissions": []`.

## Step-by-Step Installation Instructions in Brave

1. **Create the extension folder**: Create a new folder on your computer named `youtube-progress-indicator`.
2. **Save the extension files**: Save `manifest.json`, `content.js`, `styles.css`, and `README.md` directly inside the `youtube-progress-indicator` folder.
3. **Open Brave Extensions**: Launch the Brave browser, type `brave://extensions/` in the address bar, and press **Enter**.
4. **Enable Developer mode**: Toggle the **Developer mode** switch in the top-right corner of the Extensions page to **On**.
5. **Load the unpacked extension**: Click the **Load unpacked** button in the top-left area of the page.
6. **Select the folder**: Choose your `youtube-progress-indicator` folder and click **Select Folder** (or **Open**).
7. **Open a YouTube video**: Navigate to any video on `https://www.youtube.com` and verify that the `Watched: X.X%` indicator appears automatically in the top-right corner of the video player.
8. **Test playback modes**: Test normal playback, scrubbing/seeking on the timeline, clicking another video in the sidebar, switching to Theater mode, and entering Fullscreen mode (`f` key).
9. **Reloading after code changes**: Whenever you edit `manifest.json`, `content.js`, or `styles.css`, return to `brave://extensions/`, click the circular **Reload** icon on the **YouTube Video Progress Percentage Indicator** card, and refresh your open YouTube tab.

## Testing Checklist

| Scenario | Expected Behavior |
| :--- | :--- |
| **Regular YouTube video** | Indicator appears automatically in the top-right corner of `#movie_player`. |
| **Percentage accuracy** | Displays `(currentTime / duration) * 100` rounded to 1 decimal place (e.g., `1:52:24 / 7:53:09` shows `Watched: 23.8%`, `1:52:00 / 7:53:00` shows `Watched: 23.7%`). |
| **Progress bar synchronization** | Red progress fill width matches the exact percentage shown in the text (`0.0%` at start, `100.0%` at end). |
| **Real-time playback updates** | Percentage and bar update smoothly via native `timeupdate` events without redundant DOM writes when the rounded value is unchanged. |
| **Seeking forward & backward** | Indicator updates immediately on `seeking` and `seeked` events. |
| **Pausing & resuming** | Indicator stays visible and accurate across `pause` and `play` events. |
| **Player resize & small screens** | Indicator stays anchored to the top-right corner and switches to a compact layout when the player width drops below `480px`. |
| **Theater mode** | Indicator remains inside the enlarged player container's top-right corner. |
| **Fullscreen mode** | Indicator remains visible inside the top-right corner of the fullscreen video area via `fullscreenchange` container verification. |
| **SPA navigation between videos** | Clicking a recommended video resets the percentage for the new video without requiring a full page reload. |
| **No duplicate overlays** | Only a single `#yt-watch-progress-indicator` element exists in the DOM across video switches and mode changes. |
| **YouTube Shorts** | Indicator detects the active reel video (`ytd-reel-video-renderer[is-active]`) and positions itself below top-right Shorts controls. |
| **Live streams** | Displays `LIVE` with a full bar instead of `NaN%`, `Infinity%`, or misleading DVR buffer percentages. |
| **Privacy & permissions** | Requires zero special browser permissions (`"permissions": []`) and makes zero external network requests. |
| **Console cleanliness** | Produces zero uncaught JavaScript errors in DevTools Console. |

## Implementation Overview & Known Limitations

### How It Works
- **DOM & SPA Lifecycle (`content.js`)**: Listens to YouTube's internal navigation custom events (`yt-navigate-start`, `yt-navigate-finish`, `yt-page-data-updated`) alongside a `requestAnimationFrame`-throttled `MutationObserver`. Whenever YouTube swaps or re-initializes the `<video class="html5-main-video">` element, old listeners are removed via `removeEventListener` before binding the 9 standard HTML5 media events (`loadedmetadata`, `durationchange`, `timeupdate`, `seeking`, `seeked`, `play`, `pause`, `ended`, `emptied`) to the new element.
- **DOM Write Memoization**: The script caches the last rendered text string, fill width, visibility flag, and responsive state so DOM mutations only occur when the displayed tenth-of-a-percent value (`0.1%`) actually changes.
- **Fullscreen Container Resolution**: On `fullscreenchange`, `resolvePlayerContainer()` inspects `document.fullscreenElement`. When `#movie_player` or one of its ancestors enters fullscreen, the overlay remains inside `#movie_player`; if another ancestor containing the `<video>` becomes the fullscreen root without `#movie_player`, the single overlay node is reparented into that fullscreen container without duplicating elements.

### Known Limitations
- **Video Ads**: Because YouTube plays pre-roll and mid-roll ads inside the same `<video class="html5-main-video">` element, the indicator reflects the ad's playback progress while an ad is actively playing, then automatically switches to the main video's progress as soon as the main video starts or resumes.
- **YouTube Shorts Controls Overlap**: On YouTube Shorts, YouTube renders native mute/menu icons near the top-right corner of the reel player; the extension automatically shifts its top offset down (`top: 56px`) on Shorts pages to avoid overlapping those buttons.
