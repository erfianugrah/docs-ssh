# docs-ssh#16: embed rate 146 pages/min vs 667 measured (2026-10-31)

Cause: the router CPU has been capped at ~400 MHz on every core since
2026-10-30 13:35 UTC, about 4h20m into embed-backfill run 139. Not the
pages, not the code.

## Evidence

- probe.py on the router (--cpus 12, nice 19, 512 pages per set), 2026-10-31 ~16:10-16:30 +08:
  - every page is 512 tokens after fastembed's tokenizer (all three sets, 100% at 512),
    so content cannot change the per-page cost
  - default threads: random 146, pending 150, pending-sorted 140 pages/min
  - threads=12: random 162, pending 163, pending-sorted 163 pages/min
  - the random-corpus set runs as slowly as the pending set: nothing about
    the remaining pages is special
- Prometheus node_cpu_scaling_frequency_hertz, instance 10.0.71.1:9100:
  - 5-min max over all cores 13:00-13:30 UTC 10-30: 2120-3800 MHz;
    13:35 onward: 400 MHz, every sample through 2026-10-31 08:30 UTC
  - daily max single-core 09-01 .. 10-29: ~3810 MHz every day
  - coretemp max 90-94 C with package throttle events at 13:00-13:30, then
    falling to 56 C by 15:00 with zero throttle events: the cap outlived the heat
- openssl speed sha256 (16 KB, 1 thread) on an idle router: 225 MB/s;
  same command on the dev box (Ryzen 7800X3D): 2,178 MB/s
- OS side shows no cap: intel_pstate active, scaling_max_freq 5.2 GHz,
  max_perf_pct 100, Processor cooling devices 0/3, intel_powerclamp 0/100,
  thermald inactive, RAPL PL1/PL2 60/80 W, no kernel log line 21:30-21:40 +08
  -> the limit sits below the OS (firmware/EC, PROCHOT or similar): needs an
  MSR read (turbostat --debug, root) to name it

## Consequences for earlier numbers

rate.py's 667/min was measured before the cap. Every router neighbour timing
(697 s at 114k old code, 545.8 s at 131k new code) was taken under it.
