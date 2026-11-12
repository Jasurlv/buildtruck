# TimeTrack Android build (EAS)

How to build the worker app as an installable Android APK for testing, install it on
a phone, and ship updates later. The app is in `site-attendance-mobile/`.

| | |
|---|---|
| App name | TimeTrack |
| Android package / iOS bundle id | `com.globaltimetrack.timetrack` (never change it after the first install) |
| Version | `version` and `android.versionCode` in `app.json` (now `1.0.0` / `1`) |
| API | `https://api.globaltimetrack.com/api`, set per build profile in `eas.json` |
| Build profiles | `preview`: APK for direct install (testing). `production`: AAB for Google Play |

The API URL is built into the app. Changing it means a new build. `eas.json` holds no
secrets; do not add any there (use `eas env:create` if a secret is ever needed).

## 1. One-time setup

You need an Expo account (https://expo.dev/signup) and Node 20+ on your computer.

```bash
cd site-attendance-mobile
npm ci
npx eas-cli@latest login          # your Expo account
npx eas-cli@latest init           # first time only: creates the EAS project
```

`eas init` adds `extra.eas.projectId` (and `owner`) to `app.json`. Commit that change:
every later build must use the same project.

## 2. Build the test APK

```bash
cd site-attendance-mobile
npx eas-cli@latest build --platform android --profile preview
```

- The first build asks **"Generate a new Android Keystore?"**: answer **Yes**. EAS creates
  the signing key and stores it with the project (see section 5: never lose it).
- The build runs in Expo's cloud (about 10-20 minutes). When it finishes, the terminal
  prints a link and a QR code to the build page on expo.dev, with the `.apk` download.

## 3. Install the APK on a phone

1. On the phone, open the build link (or scan the QR code) and tap **Install** / download
   the `.apk`.
2. Android asks to allow installing apps from this source. Tap **Settings**, turn on
   **Allow from this source** for the browser (Chrome) or file manager, go back.
   (Path if it does not ask: Settings > Apps > Chrome > Install unknown apps.)
3. Tap **Install**. If Google Play Protect warns about an unknown app, choose
   **More details > Install anyway** (it does not know test builds).
4. Open TimeTrack. First launch: intro pages > Permissions screen > login.

Check after installing:

- [ ] The Permissions screen asks for location, then "Allow all the time" (opens the
      phone's settings), then notifications; Continue unlocks only when all three are
      green.
- [ ] Start a shift. A "TimeTrack shift tracking" notification stays visible while the
      shift runs (that is the foreground service that keeps location checks running).
- [ ] Lock the phone for 10+ minutes during a shift, then check the shift is still
      tracked (and see section 6 if it is not).
- [ ] Turn off location "all the time" in the phone's settings and return to the app:
      the Permissions screen opens again; after fixing it you are back where you were.

## 4. Release an update

1. In `site-attendance-mobile/app.json`, raise **both**:
   - `expo.version`: what people see, e.g. `1.0.0` -> `1.0.1`;
   - `expo.android.versionCode`: a whole number that must go up every build: `1` -> `2`.
   Android refuses to install an APK whose versionCode is not higher than the
   installed one.
2. Build again with the same command (`--profile preview` for testers,
   `--profile production` for Google Play).
3. Install the new APK over the old one. Workers keep their login and data, **only if**
   the package name and signing key are the same as before.

Every change to the app (including text and JavaScript) needs a new build: over-the-air
updates (EAS Update) are not set up.

For Google Play later: `npx eas-cli@latest build --platform android --profile production`
gives an `.aab` to upload in Play Console. Play also requires the background-location
declaration (with a short video of the in-app disclosure and the feature), a privacy
policy URL and the Data safety form.

## 5. Signing key: never lose it

The keystore that signs the app is what lets a new version install over the old one.

- It is stored by EAS with the project. Do not delete the EAS project or the Expo
  account that owns it.
- Download a backup now and keep it with the passwords in a password manager:
  `npx eas-cli@latest credentials --platform android` > choose the build profile >
  **Download existing keystore**.
- If it is lost, existing installs cannot be updated: every worker must uninstall and
  reinstall (and log in again). On Google Play, use Play App Signing so a lost upload
  key can be reset by Google.

## 6. Battery optimization: advice for workers

Many Android phones stop apps in the background to save battery, which stops shift
tracking. The app's Permissions screen has an **Open battery settings** button; the
exact steps per brand are below. Set TimeTrack to **Unrestricted / No restrictions /
Not optimized**, and keep the "TimeTrack shift tracking" notification on.

| Phone | Steps |
|---|---|
| Samsung | Settings > Apps > TimeTrack > Battery > **Unrestricted**. Then Settings > Battery > Background usage limits: make sure TimeTrack is not in "Sleeping apps" or "Deep sleeping apps". |
| Xiaomi / Redmi / POCO | Settings > Apps > Manage apps > TimeTrack > Battery saver > **No restrictions**. Same page: turn on **Autostart**. In the recent apps view, pull TimeTrack down to lock it. |
| Huawei / Honor | Settings > Battery > App launch > TimeTrack > **Manage manually**, turn on Auto-launch, Secondary launch and Run in background. |
| OnePlus / OPPO / realme | Settings > Battery > (More settings >) Optimize battery use / App battery management > TimeTrack > **Don't optimize** / **Allow background activity**. |
| Google Pixel and others | Settings > Apps > TimeTrack > App battery usage > **Unrestricted**. |

Also tell workers not to swipe TimeTrack away from the recent apps during a shift and
not to turn on the phone's power-saving mode while working. https://dontkillmyapp.com
has up-to-date steps for each phone model.

## Troubleshooting

- **"Set EXPO_PUBLIC_API_URL to the deployed HTTPS API URL"** at login: the build was
  made without the `env` from `eas.json` (use `--profile preview` or `production`).
- **"The production API URL must use HTTPS"**: release builds only accept `https://`.
- **App opens but cannot reach the server**: check `https://api.globaltimetrack.com/api/health`
  in the phone's browser.
- **No "TimeTrack shift tracking" notification during a shift**: notifications or
  location "all the time" were turned off; open the app, the Permissions screen shows
  what is missing.
