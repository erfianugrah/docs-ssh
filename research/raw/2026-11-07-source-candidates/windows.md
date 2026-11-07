# Windows Documentation Source Candidates -- Research Findings (2026-11-07)

> Worker: docs-ssh source candidate evaluation
> Research date: 2026-11-07
> All repos probed live via `gh api` against their default branches.

---

## 1. Win32 API Reference -- MicrosoftDocs/sdk-api

**Repo**: https://github.com/MicrosoftDocs/sdk-api
**Default branch**: `docs`
**License**: CC-BY-4.0 (verified: LICENSE file)
**Size**: 1,184,970 KB (1.1 GB -- blobless sparse checkout avoids this)
**Format**: Standard markdown with YAML frontmatter (UID, title, description, ms.* metadata). No `:::code`, `[!include]`, or Liquid template patterns found in sampled files.
**Total .md files under `sdk-api-src/content/`**: 53,900 files across 1,186 header directories.

### Coverage for user's interest areas

| Header dir           | Files | Topic |
|----------------------|-------|-------|
| setupapi             | 385   | Device installation (SetupDiGetClassDevs, etc.) |
| cfgmgr32             | 259   | Configuration Manager (CM_Get_Device_ID_List, etc.) |
| audioclient          | 73    | IAudioClient, IAudioRenderClient, IAudioCaptureClient |
| mmdeviceapi          | 44    | IMMDevice, IMMDeviceEnumerator |
| endpointvolume       | 30    | IAudioEndpointVolume |
| audiopolicy          | 42    | IAudioSessionControl, IAudioSessionManager |
| devicetopology       | 97    | IDeviceTopology, IConnector, IPart |
| pdh                  | 113   | Performance Data Helper (PdhOpenQuery, PdhCollectQueryData) |
| sysinfoapi           | 47    | GetSystemInfo, GetNativeSystemInfo |
| devquery             | 16    | DevQuery (device property queries) |
| **SUBTOTAL**         | **1,106** | |

### MISSING from sdk-api (functions exist but no markdown files)

- **HID user-mode API**: `hidsdi` (HidD_GetHidGuid, HidD_GetPreparsedData, etc.) -- NOT IN REPO. The `_hid/` directory has only `index.md` and `config.json`.
- **HID parser API**: `hidpi` (HidP_GetCaps, HidP_GetButtonCaps, etc.) -- NOT IN REPO. `_hidpi/` has only `index.md` and `config.json`.
- **WinUSB**: `winusb` (WinUsb_Initialize, WinUsb_ReadPipe, etc.) -- NOT IN REPO.
- **Registry API**: `winreg` / `advapi32` (RegOpenKeyExW, RegQueryValueExW, etc.) -- NOT IN REPO. Zero files matching `RegOpenKey|RegQueryValue|RegCloseKey`.
- **Service Control Manager**: `winsvc` (OpenSCManagerW, OpenServiceW, QueryServiceConfigW, etc.) -- NOT IN REPO. Zero files.
- **User32 display config**: `winuser` (SetDisplayConfig, QueryDisplayConfig) -- NOT IN REPO.
- **ntdll/winternl**: No `winternl` directory exists. Closest matches: `nt*` prefixes (ntddkbd, ntddmou, etc.) -- all kernel-mode DDI focused.

### Verdict

Git ingestion of 1,106-file subset straightforward -- same MicrosoftDocs-git pattern as existing sources. But **key HID and registry APIs absent**.

---

## 2. Win32 Conceptual Docs -- MicrosoftDocs/win32

**Repo**: https://github.com/MicrosoftDocs/win32
**Default branch**: `docs`
**License**: CC-BY-4.0
**Size**: 426,380 KB
**Format**: Standard markdown with YAML frontmatter. No `:::code` includes.
**Total .md under `desktop-src/`**: 48,209 files

### Relevant counts

| Subdirectory    | Files | Topic |
|-----------------|-------|-------|
| CoreAudio       | 107   | WASAPI, audio endpoint devices, sessions, spatial audio |
| Services        | 64    | Service startup, SCM, service security |
| SysInfo         | 99    | System info, registry, handles, time, power |
| PerfCtrs        | 103   | Performance counters conceptual |
| Debug           | 121   | Debug help library, SEH |
| hidpi           | 10    | HID conceptual/design guide |
| **SUBTOTAL**    | **504** | |

Sampled file: clean markdown. Internal links use `.md`. Cross-refs to sdk-api use `/windows/desktop/api/...` (dead in mirror but self-contained).

**Verdict**: Feasible-now. Sparse-checkout `desktop-src/{CoreAudio,Services,SysInfo,PerfCtrs,hidpi}`.

---

## 3. Windows Driver Docs -- MicrosoftDocs/windows-driver-docs

**Repo**: https://github.com/MicrosoftDocs/windows-driver-docs
**Default branch**: `staging`
**License**: CC-BY-4.0
**Size**: 429,799 KB
**Format**: Standard markdown with YAML frontmatter.

| Subdirectory                    | Files | Topic |
|---------------------------------|-------|-------|
| windows-driver-docs-pr/audio    | 676   | WDM audio driver architecture, miniport, APO, port class, USB/Bluetooth audio |
| windows-driver-docs-pr/hid      | 57    | HID transport, minidrivers, collections, button drivers, virtual HID |

Sampled: clean markdown, standard MicrosoftDocs style.

**Verdict**: Feasible-now. Sparse-checkout `windows-driver-docs-pr/{audio,hid}`.

---

## 4. Windows Driver DDI Reference -- MicrosoftDocs/windows-driver-docs-ddi

**Repo**: https://github.com/MicrosoftDocs/windows-driver-docs-ddi
**Default branch**: `staging`
**License**: CC-BY-4.0
**Size**: 306,295 KB
**Format**: Standard markdown with YAML frontmatter (per-function DDI pages, same pattern as sdk-api).
**Total .md under `wdk-ddi-src/content/`**: 25,903 files.

| Subdirectory       | Files | Topic |
|--------------------|-------|-------|
| hidsdi             | 18    | HidD_* functions (HidD_GetHidGuid, HidD_GetPreparsedData, etc.) |
| hidclass           | 29    | HID class driver IOCTLs/callbacks |
| hidpi              | 43    | HidP_* functions (HidP_GetCaps, etc.) |
| hidport            | 21    | HID miniport driver interfaces |
| acxelements        | 88    | ACX audio class extensions |
| a2dpsidebandaudio  | 4     | A2DP sideband audio |
| **SUBTOTAL**       | **203** | |

**Key finding**: This is where the missing HID function docs live. sdk-api lacks HidD_*/HidP_* pages; driver-docs-ddi has them (WDK DDI set, not Win32 SDK -- but callable from user mode via hidsdi.h).

**Verdict**: Feasible-now. Sparse-checkout `wdk-ddi-src/content/{hidsdi,hidpi,hidclass,hidport,acxelements}`.

---

## 5. Home Assistant Companion App Docs

**Repo**: https://github.com/home-assistant/companion.home-assistant
**Default branch**: `master`
**License**: CC-BY-NC-SA-4.0 (LICENSE.md)
**Format**: Docusaurus markdown. 57 .md files under `docs/`.
12 notification-specific files including `docs/notifications/actionable.md` (clickAction reference).

License NC clause: docs-ssh is non-commercial public service, should be fine.

**Verdict**: Feasible-now. Git sparse-checkout of `docs/`.

---

## 6. mpv Manual

**Repo**: https://github.com/mpv-player/mpv
**Default branch**: `master`
**License**: GPL-2.0+ / LGPL-2.1+ (Copyright file). Docs under GPL-2.0+.
**Format**: RST (reStructuredText). 19 `.rst` files in `DOCS/man/`.

**Blocker**: No RST normaliser in docs-ssh. RST features used: `.. admonition::`, `.. note::`, backticks, `.. code-block::`, cross-references.

**HTML fallback**: https://mpv.io/manual/master/ is a single ~300KB Sphinx-rendered page. Turndown would produce 1 giant markdown file -- degraded experience (no per-section nav) but works.

**Better**: Write RstNormaliser (1-day effort, unlocks many RST sources across Python/ReadTheDocs/Sphinx ecosystems).

**Verdict**: Needs-new-ingestor (RST normaliser). HTML stopgap viable but degraded.

---

## Combined Subset Estimate

| Source | Subset | Files |
|--------|--------|-------|
| sdk-api | setupapi + cfgmgr32 + Core Audio (4) + pdh + sysinfoapi + devicetopology + devquery | ~1,106 |
| win32 | CoreAudio + Services + SysInfo + PerfCtrs + hidpi | ~504 |
| driver-docs | audio + hid | 733 |
| driver-docs-ddi | hidsdi + hidpi + hidclass + hidport + acxelements | ~203 |
| **TOTAL** | | **~2,546** |

Gap: Win32 registry API (RegOpenKeyExW, etc.) absent from all MicrosoftDocs repos.

---

## Summary Table

| Candidate | Format | ~Pages | License | Blocker | Verdict |
|-----------|--------|--------|---------|---------|---------|
| sdk-api (subset) | MD+YAML | 1,106 | CC-BY-4.0 | HID/reg/SCM/winusb absent | feasible-now |
| Win32 conceptual | MD+YAML | 504 | CC-BY-4.0 | None | feasible-now |
| Driver docs audio+HID | MD+YAML | 733 | CC-BY-4.0 | None | feasible-now |
| Driver DDI HID+audio | MD+YAML | 203 | CC-BY-4.0 | None (fills sdk-api HID gaps) | feasible-now |
| HA Companion app | MD | 57 | CC-BY-NC-SA-4.0 | NC clause, non-comm use | feasible-now |
| mpv manual | RST | 19 | GPL-2.0+ | No RST normaliser | needs-RST-normaliser |

### Proposed DocSource sketches

```ts
// sdk-api: Win32 API reference subset (device install, Core Audio, PDH, sysinfo)
new DocSource({
  name: "windows-sdk",
  type: "git",
  url: "https://github.com/MicrosoftDocs/sdk-api",
  format: "markdown",
  paths: [
    "sdk-api-src/content/setupapi", "sdk-api-src/content/cfgmgr32",
    "sdk-api-src/content/audioclient", "sdk-api-src/content/mmdeviceapi",
    "sdk-api-src/content/endpointvolume", "sdk-api-src/content/audiopolicy",
    "sdk-api-src/content/devicetopology", "sdk-api-src/content/pdh",
    "sdk-api-src/content/sysinfoapi", "sdk-api-src/content/devquery",
  ],
  rootPath: "sdk-api-src/content",
}),

// win32: conceptual docs (WASAPI, Services, PerfCtrs, SysInfo)
new DocSource({
  name: "windows-win32",
  type: "git",
  url: "https://github.com/MicrosoftDocs/win32",
  format: "markdown",
  paths: [
    "desktop-src/CoreAudio", "desktop-src/Services",
    "desktop-src/SysInfo", "desktop-src/PerfCtrs",
    "desktop-src/hidpi",
  ],
  rootPath: "desktop-src",
}),

// Driver docs: WDM audio architecture + HID minidrivers
new DocSource({
  name: "windows-driver-docs",
  type: "git",
  url: "https://github.com/MicrosoftDocs/windows-driver-docs",
  format: "markdown",
  paths: ["windows-driver-docs-pr/audio", "windows-driver-docs-pr/hid"],
  rootPath: "windows-driver-docs-pr",
}),

// Driver DDI: HID function refs (HidD_*, HidP_*) + ACX audio class extensions
new DocSource({
  name: "windows-driver-ddi",
  type: "git",
  url: "https://github.com/MicrosoftDocs/windows-driver-docs-ddi",
  format: "markdown",
  paths: [
    "wdk-ddi-src/content/hidsdi", "wdk-ddi-src/content/hidpi",
    "wdk-ddi-src/content/hidclass", "wdk-ddi-src/content/hidport",
    "wdk-ddi-src/content/acxelements",
  ],
  rootPath: "wdk-ddi-src/content",
}),

// Home Assistant Companion: notification docs, clickAction
new DocSource({
  name: "home-assistant-companion",
  type: "git",
  url: "https://github.com/home-assistant/companion.home-assistant",
  format: "markdown",
  paths: ["docs"],
  rootPath: "docs",
}),

// mpv -- requires RstNormaliser first:
new DocSource({
  name: "mpv",
  type: "git",
  url: "https://github.com/mpv-player/mpv",
  format: "rst",
  paths: ["DOCS/man"],
  rootPath: "DOCS/man",
}),
```

### Commands run

All counts via `gh api repos/<O>/<R>/git/trees/<BRANCH>?recursive=1 --jq '...'`. Sample files read via `gh api .../contents/<path> --jq '.content' | base64 -d`. License files verified via direct content reads. No mutations performed.
## Parent spot-check corrections (2026-11-07)

Two "absent" claims above are wrong. Checked with `gh api repos/MicrosoftDocs/sdk-api/contents/sdk-api-src/content/<dir> --jq length`:
winreg 91 files (incl. nf-winreg-regopenkeyexw.md), winsvc 96, winusb 34, setupapi 386, cfgmgr32 259, pdh 113, audioclient 73, mmdeviceapi 44.
Only the user-mode HID headers (hidsdi/hidpi) are missing from sdk-api (404); those live in windows-driver-docs-ddi as the worker found.
The registry/SCM gap does not exist; the sdk-api subset covers registry, services and WinUSB.
