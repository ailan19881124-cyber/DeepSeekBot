# Linux and Android package builds

Push a commit to `p1-bot-kind` to run both GitHub Actions workflows. You can also open **Actions**, select **Linux desktop package** or **Android APK**, and use **Run workflow** on a branch once the workflow is available for manual dispatch. Download the package from the run's **Artifacts** section.

- `desktop-linux-x64` contains the Electron AppImage for x86-64 Linux with the runtime built from that checkout. Make it executable with `chmod +x <file>.AppImage`. FUSE is needed to mount it normally.
- `android-apk-release` contains an APK signed with the configured keystore. The build checks the APK's certificate before uploading it.
- `android-apk-debug` contains a debug APK when any signing secret is missing. It is an Expo development client. To load the app's JavaScript, start Metro from `apps/mobile` with `pnpm exec expo start --dev-client` and connect the installed APK to it.

## Android repository secrets

Set these in **Settings → Secrets and variables → Actions → Repository secrets**.

| Secret                      | Value                                       |
| --------------------------- | ------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | Base64-encoded JKS or PKCS#12 keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | Password for the keystore                   |
| `ANDROID_KEY_ALIAS`         | Alias of the signing key                    |
| `ANDROID_KEY_PASSWORD`      | Password for the signing key                |

Populate all four secrets for signed release APKs. Keep the source keystore and passwords outside Git. The workflow decodes the keystore into a temporary runner file and removes it when the build step exits.
