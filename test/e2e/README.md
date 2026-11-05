# Desktop and Android runs

The checks that need a real Obsidian run by three commands of their own,
apart from `pnpm test`:

| Command                 | What it drives                          | Dropbox                              |
| ----------------------- | --------------------------------------- | ------------------------------------ |
| `pnpm test:e2e:desktop` | a desktop Obsidian with no network      | not used                             |
| `pnpm test:e2e:android` | Obsidian on an Android emulator         | the test account, one login per run  |
| `pnpm test:e2e:pair`    | both, syncing through one Remote folder | the test account, two logins per run |

Each command builds the plugin first (`pnpm build`) and ends by printing
which of the manual checks it covered. What the runs keep, the Obsidian
they start, the Android image and device and each run's settings and
vault, lives in the git-ignored `.e2e/` at the repository root.

## Linux only

The runs are supported on Linux only:

- The desktop Obsidian is the release's AppImage, which exists for Linux
  on x64 and arm64; on any other system the run stops with
  `no Obsidian AppImage for <arch>`.
- The desktop runs Obsidian with no network in a user and network
  namespace of its own (`unshare --user --net`), a Linux feature.
- The Android run starts the SDK's `emulator/emulator` and
  `platform-tools/adb` by those names, without Windows' `.exe`, and its
  system image is x86_64, which needs an x86_64 machine.
- The pair run needs both.

`pnpm test` has been run on Linux only. It cannot pass on Windows:
`support/process-group.test.ts` starts `sh` and `sleep` and signals POSIX
process groups.

## Common to all runs

- Node and pnpm as `mise.toml` and `package.json` give them, and
  `pnpm install` done.
- Network access to GitHub on the first run of a version: the run
  downloads the release of Obsidian that `obsidian` in `package.json`'s
  `devDependencies` names, from `obsidianmd/obsidian-releases`, and checks
  it against the sha256 the release states.
- `SEAMSYNC_DROPBOX_APP_KEY`, the plugin's Dropbox app key, in the
  environment or in `.env` at the repository root: `pnpm build` needs it,
  and the Android and pair runs use it to reach Dropbox with the plugin's
  login.

## Desktop run

Needs, besides the common part:

- Linux on x64 or arm64, in a graphical session. Before each call the run
  brings Obsidian's window to the front, as Obsidian renders only while
  its window has focus, so leave the machine alone while it runs.
- Unprivileged user namespaces allowed. The run starts Obsidian as this
  command does; if it fails, so does the run:

  ```sh
  unshare --user --map-user="$(id -u)" --map-group="$(id -g)" --net true
  ```

Nothing to set up by hand: the first run downloads the AppImage, extracts
it into `.e2e/obsidian-<version>-<arch>/` and writes its own settings, with
the Obsidian CLI turned on. Your own Obsidian, its settings and vaults are
not touched.

```sh
pnpm test:e2e:desktop
```

## Android run

Needs, besides the common part, an x86_64 machine that can run the
Android Emulator with hardware acceleration (KVM, `/dev/kvm` usable by
you), and the setup below, done once.

### 1. Android SDK

Install the SDK's `emulator` and `platform-tools` packages, through
Android Studio's SDK Manager or `sdkmanager "emulator" "platform-tools"`.
The image below needs the emulator 37.2.11 or later. Set
`ANDROID_SDK_ROOT` (or `ANDROID_HOME`) to the SDK folder, in the
environment or in `.env`. Check the acceleration:

```sh
"$ANDROID_SDK_ROOT/emulator/emulator" -accel-check
```

### 2. System image

The run uses the image without Google's apps, which is light enough to
keep the machine responsive, and whose only browser is the WebView shell
(`org.chromium.webview_shell`), where Dropbox's pages open. The run takes
it from `.e2e/android/sys-img/x86_64/`, not from the SDK. Download
`system-images;android-37.0;default;x86_64`, revision 6, from Google's
SDK repository and unpack it there:

```sh
mkdir -p .e2e/android/sys-img
curl -fLo /tmp/x86_64-37.0_r06.zip \
  https://dl.google.com/android/repository/sys-img/android/x86_64-37.0_r06.zip
echo "8842a57a6b146423debb46c1496a9c0986aa1b9e  /tmp/x86_64-37.0_r06.zip" | sha1sum -c
unzip -q /tmp/x86_64-37.0_r06.zip -d .e2e/android/sys-img
```

The SHA-1 is the one Google's repository manifest
(`sys-img/android/sys-img2-4.xml`) states for this zip. The zip is about
900 MB; unpacked, the image takes about 2.6 GB.

### 3. Virtual device

The device lives in `.e2e/android/avd/`, which the run passes to the
emulator as `ANDROID_AVD_HOME`. Pick a name, e.g. `seamsync-e2e`, and write
two files, with `<repo>` standing for the repository's absolute path.

`.e2e/android/avd/seamsync-e2e.ini`:

```ini
avd.ini.encoding=UTF-8
path=<repo>/.e2e/android/avd/seamsync-e2e.avd
target=android-37.0
```

`.e2e/android/avd/seamsync-e2e.avd/config.ini`:

```ini
avd.ini.encoding=UTF-8
AvdId=seamsync-e2e
avd.ini.displayname=seamsync-e2e
abi.type=x86_64
hw.cpu.arch=x86_64
tag.id=default
image.sysdir.1=<repo>/.e2e/android/sys-img/x86_64/
hw.ramSize=2048
hw.cpu.ncore=4
hw.lcd.width=1080
hw.lcd.height=2400
hw.lcd.density=420
hw.gpu.enabled=yes
hw.gpu.mode=auto
hw.keyboard=yes
hw.audioInput=no
hw.audioOutput=no
disk.dataPartition.size=6G
PlayStore.enabled=false
```

The device takes 2 GB of RAM and 4 cores while it runs. Name it to the
run by `SEAMSYNC_E2E_AVD=seamsync-e2e`, in the environment or in `.env`.

### 4. Dropbox test account

The run logs the plugin in by passing Dropbox's authorize page in the
device's browser, which works only while a Dropbox account is logged in
there. Use an account kept for tests, not your own: each run makes a
Remote folder `e2e-<time>` in it and deletes it at the end. Log it in
once, starting the device as the run does:

```sh
ANDROID_AVD_HOME="$PWD/.e2e/android/avd" "$ANDROID_SDK_ROOT/emulator/emulator" \
  -avd seamsync-e2e -sysdir .e2e/android/sys-img/x86_64 -port 5584 -no-audio -no-snapshot
```

When it has booted, open Dropbox in its browser and log in:

```sh
"$ANDROID_SDK_ROOT/platform-tools/adb" -s emulator-5584 shell \
  am start -a android.intent.action.VIEW -d https://www.dropbox.com/login
```

Then close the emulator: the run starts its own on the same port and
stops at once if one already runs there. The login stays on the
device's data partition.

### Running it

```sh
pnpm test:e2e:android
```

The run boots the device with no snapshot, installs the release's APK
(downloaded into `.e2e/android/` and checked against the release's
sha256) when the installed version is another, clears Obsidian's data,
makes a vault, loads the built plugin and closes the emulator at the end.
Every run logs in to Dropbox: run it when a check needs it, not in a
loop.

## Pair run

Needs everything the desktop and Android runs need. The desktop Obsidian
runs online here: it logs in through the emulator's browser too, so no
browser of yours opens.

```sh
pnpm test:e2e:pair
```
