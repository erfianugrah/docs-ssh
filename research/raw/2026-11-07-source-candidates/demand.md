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

## Low-coverage searches (best row hits < 75% of query tokens), first 120, summarised per source

Work/Supabase-platform and unscoped personal rows were removed before commit. The verbatim
queries are not kept (personal search text). Typical shapes were
a chip pinout query, a bootloader or debug-lock query, a register-offset query, an API
endpoint-name query and a hardware-vendor product query. Columns: searches (repeats
included), distinct queries, source named in the call.
```
searches	distinct	source
49	17	github
39	8	nvapi
30	10	nordic
27	9	lidarr
19	7	kicad
15	5	libhmk
12	4	nuvoton-m480
12	4	searxng
9	3	nuvoton
9	3	windows-sdk
8	6	(no source)
8	4	jellyfin
7	1	duckdb
6	2	forgejo
6	2	frigate
6	1	home-assistant
6	2	nrf52840
6	2	starlight
4	1	zod
3	1	bitwarden
3	1	claude-code
3	1	fly
3	1	hlsjs
3	1	microsoft
3	1	powershell
3	1	python
3	1	rfc
3	1	suricata
3	1	vector
3	1	windows-server
2	2	astro
1	1	go
```
