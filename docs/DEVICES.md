# Devices

What opentoys knows about each supported device, and what has been tested on real hardware. Each fact says where
it comes from: the maker's published protocol, or observation on a device.

## DG-LAB Coyote 3.0

An e-stim unit with two channels, A and B, used with electrode pads. opentoys implements DG-LAB's
[published V3 Bluetooth protocol](https://github.com/dungeonlab-open/dglab-bluetooth-protocol/blob/main/coyote/v3/README.md).

- **Bluetooth:** advertised name starting `47L121000`. Commands go to service `0x180C` (write `0x150A`, notify
  `0x150B`). Battery, firmware version and address are read from service `0x180A`.
- **Output:** one frame every 100 ms carries both channels: an intensity of 0–200 per channel and four 25 ms slots
  of pulse timing and strength. By the protocol, a frame is valid for its 100 ms only, so output ends when frames
  stop arriving. Do not rely on that to stop the device: press Stop.
- **Pulse timing:** the protocol's 10–1000 value is the gap between pulses in milliseconds. opentoys shows it as
  pulses per second.
- **Wheels:** the device has a wheel per channel and reports its intensity. opentoys follows what it reports.
- **Device-side maximum:** the protocol defines a maximum per channel that the device keeps after power-off and
  applies to its wheels too. opentoys writes the user's maximum for each channel that is set up, when connecting
  and when it changes. A channel that is not set up or not used is locked in opentoys only: the device gets the
  general limit for it (100, or up to 200 after confirmation), never 0, so its wheel is not left dead. Other apps
  write their own values when they connect.
- **No display.** The device shows no numbers of its own.

**Tested (firmware 7, Chrome on Android, October 2026):** connecting, battery and firmware reading, the set-up,
playing patterns, raising and lowering intensity, Stop, following a wheel turn, and stopping when the page is
left. Not yet checked: that the device-side maximum stops a wheel turned past it, and other firmware versions.

DG-LAB asks that its published protocol content not be used for any commercial purpose without its authorisation. See [NOTICE](../NOTICE).

Not supported yet: PawPrints accessories, storing waveforms on the device, and other DG-LAB devices.

## Bananasome Dragon S1

A ring with vibration and e-stim. The notes below come from observing one device with firmware 1.

- **Bluetooth:** advertised name `YLS01`. Service `0xAE3A`, write `0xAE3B` (without response), notify `0xAE3C`.
- **Replies:** the ring is silent until written to. Each write produced the same status reply, which includes the
  battery level, within 60–100 ms.
- **Output:** one frame sets both levels, each as one byte. A level of 0 turns that output off. The ring kept its
  levels when frames stopped, so opentoys writes on every change, refreshes once a second, and treats three
  seconds without a reply as a lost connection.
- **Stopping:** the ring's own stop command stopped vibration only. opentoys sends a zero-level frame first, then
  the stop command.
- **Connections:** a clean disconnect stopped both outputs. Every new connection made the ring buzz briefly.
- **The motor** needs about 40 ms to spin up or stop, so built-in patterns keep full on-off steps at 100 ms or
  longer.

**Tested (firmware 1, Chrome on Android, September 2026):** connecting, battery reading, calibration, the e-stim
set-up, patterns, Stop and leaving the page. In these tests the ring stopped a few seconds after the tab was
closed. Press Stop before closing the tab, and switch the ring off if it keeps going. Not yet measured: how long
vibration continues with the screen locked, and how quickly a ring going out of range is noticed.

## Reporting a device

If you try opentoys with another firmware version or phone, an issue saying what worked and what did not is
useful. Please include the device, your browser and operating system, and the firmware version if Settings shows
one (it does for the DG-LAB Coyote 3.0).
