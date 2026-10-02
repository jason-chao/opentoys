# Development

opentoys is a static web app. The browser talks to the device through Web Bluetooth, and there is no backend.

## Run and check

Node.js 20.19 or later in the 20 series, or 22.12 or newer.

```sh
npm install
npx playwright install chromium   # once, for the browser tests
npm run dev                       # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run lint` | Prettier and ESLint |
| `npm run check` | message keys, placeholders, empty and unused messages, semicolons, then type checks |
| `npm test` | unit tests (Vitest) |
| `npm run build` | the static site in `apps/web/build/` |
| `npm run check:privacy` | scans the source and the build for addresses that are not on its short allowlist, and checks each built page's Content-Security-Policy |
| `npm run test:e2e` | browser tests (Playwright), phone and desktop |
| `npm run verify` | all of the above, in order |

## Layout

```
packages/core/      engines and patterns for the DG-LAB Coyote 3.0 and the Bananasome Dragon S1
packages/devices/   device models, drivers, output loops, simulated devices, page lifecycle (hide, close, wake lock)
packages/web-ble/   the Web Bluetooth transport
apps/web/           the SvelteKit app (static), with the screens for each device
deploy/docker/      a container with nginx and the security headers
i18n/glossary.md    the fixed terms in each language
tools/              repository checks (messages, privacy)
```

- **Engines** are pure: they take a time step and return what to send. `packages/core/test/fixtures` holds
  recorded output of the Python implementations the engines were ported from (not published), and the tests must
  reproduce it exactly. Treat those fixtures as the definition of current behaviour: a change that alters them
  needs a reason.
- **Output loops** (`packages/devices/src/controller`) tick an engine and write frames. Everything that ends
  output goes through one stop path. Simulated devices implement the same interfaces, so tests and the
  no-device preview run the same code as a real connection. Behaviour on hardware still has to be checked on a
  real device.
- **The app** keeps one session per device (`apps/web/src/lib/devices/<device>/`) under a manager that provides
  Stop for all, the session limit and the page lifecycle (`apps/web/src/lib/app/devices/`).

## Tests

- Unit tests cover the engines, protocol frames, drivers, output loops and settings.
- Browser tests fake `navigator.bluetooth` at GATT level (`apps/web/e2e/fake-bluetooth.ts`), so they run the real
  connection path and assert the bytes written: for example that Stop writes a zero frame and then the stop
  command, and that leaving the page stops e-stim.

Changes to anything that can end or limit output need a test.

## Text and languages

- All text lives in `apps/web/messages/{en,zh-Hant,zh-Hans}.json`. A key that is missing in a language or unused
  in the code fails `npm run check`.
- **Each language is written for its own readers.** Traditional Chinese uses words that read naturally in both
  Hong Kong and Taiwan. Simplified Chinese is written for Mainland readers and is never converted from the
  Traditional text. `i18n/glossary.md` fixes the key terms.
- **Wording is plain and direct.** Short sentences, one idea each. Say what a control does and which device it
  concerns. No semicolons (checked). Never promise that a device has certainly stopped: say what the app did and
  what to do if the device keeps going.
- **Device names are always written in full**, for example "DG-LAB Coyote 3.0". Text only: no maker logos or
  product photos.

To add a language: add its message file and its glossary terms, then add the locale to
`apps/web/project.inlang/settings.json`, the URL patterns in `apps/web/paraglide.config.js`, the names and
detection in `apps/web/src/lib/i18n/locales.ts`, and the prerender list in `apps/web/vite.config.ts`. Run
`npm run verify` and have a native speaker review the text.

## Adding a device

1. A model, driver, output loop and simulated device in `packages/devices`, with tests against recorded frames.
2. An engine in `packages/core` if the device needs its own.
3. A kind in `apps/web/src/lib/devices/<device>/` (settings block, session, card, set-up, screens) registered in
   `apps/web/src/lib/app/devices/registry.ts`.
4. Its safety notes, its set-up with a comfortable maximum, and its rule for when the page is left.
5. A GATT-level fake for the browser tests.

## Privacy rules for code

Scripts, fonts and every other asset are served from the site's own origin, and there are no usage analytics.
The Content-Security-Policy allows only that origin. `tools/check-privacy.mjs` scans the source and the build for
other addresses, and the browser tests check where requests go.
