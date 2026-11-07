# Demand evidence (2026-11-07)

## docs_search/grep calls naming a source that does not exist (query log 2026-10-22..11-07, 6565 logged ops)
```
nordic	33
lidarr	27
nuvoton-m480	14
nuvoton	12
windows-sdk	9
frigate	8
rfc	7
aws	7
supa	6
nrf52840	6
microsoft	6
suricata	5
fly	4
windows	3
vector	3
supabase-js	3
jlc	3
hlsjs	3
claude-code	3
research	2
qmk	2
nrf	2
discord	2
claude	2
build123d	2
win	1
wiki	1
wch	1
supabase/guides/realtime	1
supabase/guides/platform/manage-your-usage	1
```

## Agent web fetches by host (pi + Claude Code session files, last ~30d, 3382 fetches) - top docs-like hosts
```
69	learn.microsoft.com
37	forgejo.org
26	code.claude.com
13	developers.cloudflare.com
11	en.wikipedia.org
11	docs.darktable.org
10	docs.frigate.video
7	docs.nordicsemi.com
6	docs.github.com
6	claude.com
5	chipwhisperer.readthedocs.io
5	developer.dhl.com
5	docs.immich.app
4	docs.openaq.org
4	deepwiki.com
3	dev-docs.kicad.org
3	fault-injection-library.readthedocs.io
3	infocenter.nordicsemi.com
3	docs.gitea.com
3	learn.chatgpt.com
3	platform.claude.com
2	developer.mozilla.org
2	docs.suricata.io
2	docs.pyvista.org
2	build123d.readthedocs.io
2	docs.nvidia.com
2	docs.firefly-iii.org
2	docs.bekencorp.com
2	developers.google.com
2	docs.unity3d.com
```

## Low-coverage searches (best row hits < 75% of query tokens), first 120; work/Supabase-platform and unscoped personal rows removed before commit
```
0/1	x3	github	ghidra
0/1	x3	github	ghidramcp
0/1	x3	github	rentry
0/1	x3	github	vapid
0/1	x3	kicad	kicad-cli
0/1	x3	kicad	netlist
0/1	x3	lidarr	trackfile
0/1	x3	nvapi	pstates20_info_v2
0/1	x3	nvapi	vfpoint
0/1	x4	zod	optional
0/1	x6	home-assistant	clickaction
0/1	x10	nvapi	pstates20
0/2	x3	forgejo	sync upstream
0/2	x3	github	faultier crowbar
0/2	x3	github	firmware dump
0/2	x3	github	mouse firmware
0/2	x3	github	op1 firmware
0/2	x3	github	op1 schematic
0/2	x3	github	usbfile cs_createupgradefile
0/2	x3	github	webhid firefox
0/2	x3	github	webpush vapid
0/2	x3	github	wlink ch32v305
0/2	x3	github	wlink wch-linke
0/2	x3	libhmk	analog mux
0/2	x3	lidarr	download clients
0/2	x3	lidarr	lidarr album
0/2	x3	lidarr	renametracks import
0/2	x3	nvapi	pstates20 clock_entry
0/2	x3	python	hextree faultier
0/2	x3	searxng	mouse switch
0/2	x3	searxng	singapore soldering
0/2	x3	starlight	finalmouse company
0/2	x3	windows-sdk	cm_locate_devnodew cfgmgr32
0/2	x3	windows-server	ntquerysysteminformation systemprocessorperformanceinformation
0/2	x7	duckdb	median quantile_cont
0/2	x7	nvapi	get-winevent convertto-json
0/2	x7	nvapi	pstates20 curve
0/3	x3		iaudioclient3 audioclient vtable
0/3	x3	bitwarden	sshkey privatekey keyfingerprint
0/3	x3	forgejo	secret_key rotate encryption
0/3	x3	frigate	frigate camera detection
0/3	x3	github	endgame gear op1
0/3	x3	github	libretiny bekenbinary bkcrypt
0/3	x3	hlsjs	hls.js buffer abr
0/3	x3	jellyfin	syncplay speed skip
0/3	x3	libhmk	at32f405 adc channel
0/3	x3	libhmk	keymap keycodes advanced
0/3	x3	lidarr	album api endpoint
0/3	x3	lidarr	config endpoint renametracks
0/3	x3	lidarr	trackfile status missing
0/3	x3	nordic	nrf52820 bootloader mbr
0/3	x3	nordic	nrf52820 ficr deviceaddr
0/3	x3	nuvoton-m480	sblock icelock config0
0/3	x3	powershell	wasapi audio latency
0/3	x3	searxng	glass carafe fridge
0/3	x3	windows-sdk	openscmanagerw openservicew queryserviceconfigw
0/3	x3	windows-sdk	regopenkeyexw regqueryvalueexw advapi32
0/4	x3	fly	udp fly-global-services destination address
0/4	x3	frigate	frigate camera recommended hardware
0/4	x3	jellyfin	resume percentage minimum duration
0/4	x3	kicad	custom design rules diff_pair_uncoupled
0/4	x3	kicad	custom rules evaluated order
0/4	x3	kicad	kicad-cli drc custom rules
0/4	x3	kicad	s-expression string escape quote
0/4	x3	libhmk	usb vid pid bootloader
0/4	x3	lidarr	download client import queue
0/4	x3	nordic	nrf52840 watchdog wdt reload
0/4	x3	nordic	usbd endpoint stop easydma
0/4	x3	nvapi	eld hdmi audio display
0/4	x3	nvapi	hdmi audio display disabled
0/4	x3	rfc	update apex soa ns
0/4	x3	searxng	pcbite omnifixo helping hands
0/4	x3	starlight	finalmouse orbital works mouse
0/4	x3	suricata	pass action rule flow
0/5	x3	claude-code	sessionstart compact matcher additionalcontext precompact
0/5	x3	libhmk	at32 dfu bootloader vid pid
0/5	x3	lidarr	album release foreignid mediumformat barcode
0/5	x3	nordic	nrf52820 peripheral radio register offsets
0/5	x3	nordic	nrf52840 rtc frequency 32768 app_timer
0/5	x3	nordic	nrf52840 usbd intenset register semantics
0/5	x3	nordic	nrf52840 usbd tasks_stopepin endpoint status
0/5	x3	nrf52840	nrf52840 spim intenset end bit
0/5	x3	nrf52840	nrf52840 spim tasks registers offset
0/5	x3	nuvoton	nuvoton icp nu-link programming tool
0/5	x3	nuvoton	nuvoton m480 config security lock
0/5	x3	vector	loki sink compression default snappy
0/6	x3	microsoft	low latency audio wasapi 128 samples
0/6	x3	nordic	nrf52840 nvmc flash erase write endurance
0/6	x3	nordic	nrf52840 power management sleep wfi dc-dc
0/6	x3	nuvoton-m480	m483 sblock fmc ice debug lock
0/6	x3	nuvoton-m480	m483 security lock sblock ice config
0/7	x3	nuvoton-m480	sblock config0 boot ice debug lock m483
0/9	x3	nuvoton	m483 lqfp-64 pin 33 pf.0 swdio pin 34 pf.1
1/7	x1		nrf52840 spim0 events_end register offset 0x108 0x118
1/7	x1	kicad	rotation angle positive counter-clockwise pcb file format
1/6	x1		nrf52840 interrupt numbers gpiote spis1 usbd
1/6	x1		nrf52840 usbd eventcause register offset endepin
1/6	x1	go	go time.parse fractional seconds rfc3339 optional
1/5	x1		nrf52 usbd easydma stopepin buffer
1/5	x1		nrf52840 usbd easydma endepin buffer
1/5	x1	astro	content security policy csp hashes
1/5	x1	astro	content security policy inline scripts
1/5	x1	github	nrf52840 bootloader dfu usb recovery
1/5	x1	jellyfin	isinrole administrator role claim claimsidentity
1/5	x1	jellyfin	sessions playing playstate playnow playcommand
```
