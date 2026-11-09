# Setting up the frame

This page is the checklist for when the frame arrives. The detailed, device-specific steps are
in Wes Bos's repo. Many people are adding to it, so read the latest version there and don't rely
on a copy:
https://github.com/wesbos/photo-frame-dashboard

> **Before the frame touches Wi-Fi:** many of these frames (the **PF1007L / AiMOR** board in
> particular) ship a vendor app that gives the vendor's server a **root shell** and can install
> updates on its own. Read
> [aimor-remote-root-shell.md](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/aimor-remote-root-shell.md)
> and [app-updates.md](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/app-updates.md)
> before you join it to your network. If you can, put it on a guest/IoT network.

## 0. What you need

- A **USB-A to USB-C data cable**. On the PF1007L, USB-C to USB-C gives no power or data.
- A microSD card. Some routes write a patch from it.
- `adb`:

  ```bash
  brew install android-platform-tools
  ```

- A local clone of Wes's repo. It has the device scripts and the per-device notes:

  ```bash
  git clone https://github.com/wesbos/photo-frame-dashboard.git ~/GitHub/photo-frame-dashboard
  ```

## 1. Identify the board

Frames sold under the same Amazon listing come with different boards. On the frame, open
**Settings → About** and write down the model, the firmware string and the Android version.

| You see | Board | Start with |
| --- | --- | --- |
| Firmware has `A33` and `PF1007L` (often AiMOR) | Allwinner A33 | [pf1007l-start-here.md](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/pf1007l-start-here.md) |
| BIUFRAME / Synergy 10X1, ADB prompt shows on screen | Rockchip RK3126 (the frame in Wes's video) | [biuframe-setup-guide.md](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/biuframe-setup-guide.md) |
| Frameo, Dragon Touch, Uhale, Pastigio, others | varies | [devices.md](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/devices.md) |

Before you begin, check that repo's open issues and PRs for your firmware string. New variants
often show up there first.

## 2. Get ADB, in this order

1. **USB:** plug in, run `adb devices`, and accept any "Allow USB debugging" prompt on the
   screen.
2. **Network:** `adb connect <frame-ip>:5555`.
3. **Only then** the device-specific vendor-app trick or boot patch from your board's guide.

## 3. Back up before you write anything

Follow your board's guide. These rules come from that repo and are worth keeping:

- Make a verified backup (byte count + SHA-256) before **any** write.
- Make one change at a time, and write down how to undo it first.
- Stop at the first mismatch in a hash, model string or size.
- Keep dumps private. They contain Wi-Fi passwords and serials. `backups/`, `diagnostics/` and
  `frames/` are already in this project's `.gitignore`.
- **Prove the way back before you close the way in.** Before you disable the vendor app, check
  by hand on the panel that you can still reach Android Settings → Apps.

## 4. Root and remove the vendor app

This step differs for each board, so follow your board's guide. Most of these guides also cover
installing a fallback launcher and, on Android 6, a newer WebView (106) and CA roots.

## 5. Install the kiosk app and point it at this dashboard

Wes's repo includes a small full-screen WebView app, `dashboard/kiosk` (MIT licensed). It starts
at boot, retries when the network is down, and opens a hidden menu when you hold two fingers
still for 1.5 s.

Build it once (it needs JDK 17 and the Android command-line tools):

```bash
brew install --cask android-commandlinetools temurin@17
```

```bash
sdkmanager --sdk_root=/opt/homebrew/share/android-commandlinetools "build-tools;34.0.0" "platforms;android-34"
```

```bash
cd ~/GitHub/photo-frame-dashboard/dashboard && bash kiosk/build.sh
```

```bash
adb install -r ~/GitHub/photo-frame-dashboard/dashboard/kiosk/build/homehq.apk
```

Save your dashboard's URL. Use the `workers.dev` URL from `npm run deploy`:

```bash
adb shell am start -n com.wesbos.homehq/.MainActivity --es url https://frame-dashboard.YOUR-SUBDOMAIN.workers.dev/
```

To test against your Mac before deploying, run `npm run dev` here and use
`http://<your-mac-ip>:5173/`. Use the IP address: Android 6 can't resolve `.local` names.

## 6. Boot straight into the dashboard

Android 7+:

```bash
adb shell am start -n com.wesbos.homehq/.MainActivity --ez home true
```

```bash
adb shell cmd package set-home-activity com.wesbos.homehq/.Home
```

Wait about 30 seconds before rebooting so Android saves the setting.

On Android 6 (PF1007L, BIUFRAME) run the first command, then open the Home chooser and tap
**Home HQ → Always** on the frame:

```bash
adb shell am start -a android.intent.action.MAIN -c android.intent.category.HOME
```

Keep another launcher installed so the kiosk's **Open launcher** button has somewhere to go.

## 7. Nice extras from the post

These are optional, and your board's guide covers each one:

- Dim the screen when nobody is near, using the motion sensor (Skylight/BIUFRAME notes).
- Fix a dead onboard Wi-Fi chip with a USB dongle:
  [usb-wifi-dongle.md](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/usb-wifi-dongle.md)
- Swap and memory tuning for 1 GB boards.
- PF1007L after root: Wi-Fi MAC, clock after power cuts, faster DHCP:
  [pf1007l-boot-fixes.md](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/pf1007l-boot-fixes.md)

## 8. Give back

If your unit has a firmware string or route that isn't documented, Wes's repo asks for a PR
with your notes. Remove serials, MACs and Wi-Fi details first. Failed attempts are useful too.
