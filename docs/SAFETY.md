# Safety

opentoys controls devices that act on the body. This page says what the app does to keep their output within
limits, and where those limits end.

**The limits are defaults in code that runs in a browser.** Anyone can read and change the code, a browser can suspend
or close a page, and a Bluetooth connection can drop. The measures below reduce risk. They do not guarantee
safety. You are responsible for your safety and use opentoys entirely at your own risk. Its developers accept no
liability. The device's own off switch is the last resort.

## Before playback

- **18+ confirmation** before the app can be used at all.
- **Safety notes and an agreement per device** before the app plays or calibrates anything on a real device. The
  notes say who must not use e-stim (a pacemaker or another implanted device, a heart condition, epilepsy) and,
  for electrode pads, where they must not go (the chest, head or neck, or anywhere that sends current across the
  chest). Connecting comes first, and the Bananasome Dragon S1 buzzes briefly on every connection.
- **A set-up with live output.** The DG-LAB Coyote 3.0 and the e-stim of the Bananasome Dragon S1 stay locked
  until the user has raised the level from zero, felt it, set a comfortable maximum and confirmed. A maximum can
  only be raised by repeating the set-up. Vibration can use its default range.
- **Imported files** never enable a device or e-stim, never approve a higher limit, and never raise a limit that
  was lowered in this browser.

## Limits while something plays

**Bananasome Dragon S1**

- Built-in and adjustable patterns are mapped onto the calibrated range, between the lowest level felt and the
  comfortable maximum. Zero stays off. Free control and recorded patterns use their own levels.
- Everything is cut to the user's maximum: 100 % for vibration and 80 % for e-stim by default. E-stim can be
  allowed up to 100 % only after a separate confirmation.
- Output fades in over the warm-up time (3 seconds by default; setting it to 0 turns the fade off).
- E-stim may rise by at most 25 percentage points per second by default. It may fall at once.

**DG-LAB Coyote 3.0**

- A channel that is off starts at intensity 0. The user raises it.
- Intensity is cut to the channel's confirmed maximum. The general limit is 100 on the device's 0–200 scale, or
  up to 200 after a separate confirmation. The maximum of a channel that is set up is also written into the
  device (see [DEVICES.md](DEVICES.md) for channels that are not).
- Pulse strength warms up from zero over the first seconds of output.
- A burst and the slow increase add to the intensity within the channel's maximum. The app ends a held burst
  after 15 seconds.

**Both**

- **Session limit:** the app ends all playback a set time after it started (60 minutes by default), by the clock.
  A suspended page can check late.
- **Screen wake lock:** the app asks the browser to keep the screen awake while something plays. The browser can
  refuse or release it.

## Stopping

- **Stop** (and Esc on a keyboard) ends playback in opentoys for every device. For the Bananasome Dragon S1 the
  app sends zero levels and then the stop command. For the DG-LAB Coyote 3.0 it sends zero frames and checks that
  the device reports 0.
- **Leaving the page** (another app or tab in front, or the screen locked): the app stops the DG-LAB Coyote 3.0
  and the ring's e-stim, and they stay off until turned on again. The ring's vibration continues unless
  "Stop vibration and e-stim" is chosen in Settings.
- **A lost connection or a closed tab** can prevent a stop from arriving. The ring was seen to hold its last
  levels when frames stopped, so the app warns that it may still be running. Press Stop before leaving or closing
  the page, and if a device keeps going, switch it off at the device.
- Playback never restarts by itself after a stop, a reconnection or a return to the page.

## Privacy

opentoys has no backend of its own. Usage history and settings are stored in the browser and can be exported or
deleted in Settings. The browser contacts the site's host to load the app and to check for updates, and nothing
else: the Content-Security-Policy allows only the site's own origin, and a build check scans the code for other
addresses.
