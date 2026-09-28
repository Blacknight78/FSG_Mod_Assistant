# Google Drive collection links

Collection sharing can use Google Drive to avoid very long embedded manifest links.
The app uploads the collection manifest JSON to the user's own Google Drive, makes
that manifest readable to anyone with the link, and copies a short link:

```text
fsgma://collection/drive/<google-drive-file-id>
```

## OAuth client

Create a Google OAuth client with application type `Desktop app`. The app uses
Google's installed-app flow with a local loopback callback on
`http://127.0.0.1:<random-port>` and PKCE. The Desktop client ID and matching
client secret are both needed for Google's token exchange.

The app requests only this Drive scope:

```text
https://www.googleapis.com/auth/drive.file
```

That scope limits FSG Mod Assistant to files it creates or files the user opens
with the app.

## Drive folder

When a short link is created, FSG Mod Assistant creates or reuses this Google
Drive folder:

```text
FSG Mod Assistant Collection Links
```

New Drive-backed collection manifest files are placed in that folder so they do
not clutter the user's Drive root. Existing shared links continue to work even
if they were created before this folder behavior was added.

## Development builds

Set this environment variable before running from source or building:

```powershell
$env:FSGMA_GOOGLE_DRIVE_CLIENT_ID = "your-desktop-client-id.apps.googleusercontent.com"
$env:FSGMA_GOOGLE_DRIVE_CLIENT_SECRET = "your-desktop-client-secret"
```

The older device-code fallback is still available for troubleshooting. It needs
`FSGMA_GOOGLE_DRIVE_DEVICE_CLIENT_ID` and
`FSGMA_GOOGLE_DRIVE_DEVICE_CLIENT_SECRET` at runtime, but those values should
not be packaged into the installer.

## Release builds

`test/write-build-info.js` may copy `FSGMA_GOOGLE_DRIVE_CLIENT_ID` into
`build-info.json` when the value is present. It may also copy
`FSGMA_GOOGLE_DRIVE_CLIENT_SECRET` for test builds that need Google Drive
linking to work from an installed package.

## Runtime override

For troubleshooting, the app also checks the `google_drive` Electron Store key
`clientID` and `clientSecret` before the environment variable and build info
values. For the device-code fallback only, it also checks `deviceClientID` and
`deviceClientSecret` before the matching environment variables.

## Test pattern

1. Open Share or Import a Collection.
2. Confirm the Google Drive panel says Drive is ready to link.
3. Click Link Drive. The app opens Google's consent screen in the system
   browser.
4. Approve access. If the default browser fails, return to the app and click
   Open sign-in in Edge.
5. Confirm the panel says Google Drive is linked.
6. Select a collection and click Copy link.
7. Confirm the copied link starts with `fsgma://collection/drive/`.
8. Paste that link into Import link and confirm the manifest review list appears.
