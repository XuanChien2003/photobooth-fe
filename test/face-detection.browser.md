Run the real face detection check from `Photo_FE`:

```powershell
# One-time download of Google's public MediaPipe test fixtures. No customer photos.
New-Item -ItemType Directory -Path .cache/face-detection -Force | Out-Null
Invoke-WebRequest https://storage.googleapis.com/mediapipe-assets/portrait.jpg -OutFile .cache/face-detection/portrait.jpg
Invoke-WebRequest https://storage.googleapis.com/mediapipe-assets/cat.jpg -OutFile .cache/face-detection/cat.jpg
npm run build
node test/face-detection.browser.mjs
```

The test uses the existing Playwright dependency in `Photo_BE` and headless Google
Chrome. Install the backend dependencies (`npm ci` in `Photo_BE`) and Chrome first.
Fixtures and diagnostic JSON files remain in the ignored `.cache/face-detection/`
directory. The browser test makes no external requests: all remote requests,
including MediaPipe's optional telemetry, are intercepted and blocked.

Checks cover an upright portrait, close-up and tight close-up images at
1920 × 2560, sideways and upside-down images, landmark coordinate mapping,
cat/blank negative examples, loading the built local WASM/model assets, and retry
after a simulated model download failure. It also renders blush/slimming with the
actual detected landmarks, checks cheek/jaw localization and neutral pixels, and
writes `beauty-effects-comparison.png` to the ignored fixture cache for visual
review. A coordinate-coded image measures the actual slimming displacement and
checks that both jaw edges move inward without cumulative over-deformation.
The production loader is served with
its Vite `?url` imports replaced by the actual asset filenames from `dist/assets`;
its detection and error handling code runs unchanged.

Google's [MediaPipe face landmarker tests](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/python/test/vision/face_landmarker_test.py)
use the same public portrait and cat fixtures. This test checks those fixtures;
it does not verify a specific customer's photo or every supported mobile browser.
