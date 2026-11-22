/**
 * Upstream access registry: every host that has refused, filtered or
 * challenged the fetcher, with the evidence, the date, and the workaround in
 * use. One entry per host, so the next person adding a source from that host
 * reads the verdict instead of re-probing it (st.com was rediscovered as
 * blocked three times between 2026-11-11 and 2026-11-22).
 *
 * Probe from the build runner, not the dev box: jobs run on the router in
 * ghcr.io/catthehacker/ubuntu:act-22.04 on network forgejo_forgejo, behind
 * the same WAN IP as the nightly fetch. Use the fetcher's real UA
 * (src/ingestors/http-client.ts): downloads.mysql.com 403s it but 200d a
 * made-up bot UA on 2026-11-22.
 *
 * Enforced by tests/unit/application/upstream-access.test.ts: no source
 * fetches live from a `blocked`/`challenge` host (pinned Wayback captures or a
 * mirror instead, or a fallbackDiscoveryUrl off that host), `ua-filtered`
 * hosts get a userAgent, `header-filtered` hosts skip markdown negotiation.
 * The nightly check-sources run re-requests every entry with a `probe` URL
 * and warns when one answers 2xx: the block lifted, so update the entry.
 */

import type { DocSource } from "../domain/DocSource.js";

export type AccessStatus =
  /** Every request from our egress fails (IP/ASN block): 403, reset or stall, any UA. */
  | "blocked"
  /** Non-browser User-Agents refused; userAgent: BROWSER_UA passes. */
  | "ua-filtered"
  /** One request header refused (openvpn.net and `Accept: text/markdown`). */
  | "header-filtered"
  /** JS challenge page (AWS WAF 202) instead of content, any UA. */
  | "challenge"
  /** Documents behind a vendor account login. */
  | "login"
  /** Broken IPv6 route that hangs undici (curl -4 works). */
  | "ipv6-broken"
  /** A recorded block that no longer reproduces; kept so nobody re-researches it. */
  | "lifted";

export interface UpstreamAccess {
  readonly status: AccessStatus;
  /** First recorded (the commit that documented it), YYYY-MM-DD, or YYYY-MM when only the month is known. */
  readonly since: string;
  /** Last verified from the build runner, YYYY-MM-DD. */
  readonly checked: string;
  /** What the request saw. */
  readonly evidence: string;
  /** What sources do instead (or "none: <why>"). */
  readonly fallback: string;
  /** URL the nightly probe requests the way the block refused it; omit for no re-probe. */
  readonly probe?: string;
}

export const UPSTREAM_ACCESS: Readonly<Record<string, UpstreamAccess>> = {
  "www.st.com": {
    status: "blocked",
    since: "2026-11-11",
    checked: "2026-11-22",
    evidence:
      "Akamai (e40218.a.akamaiedge.net): TLS completes, then HTTP/2 stream reset INTERNAL_ERROR or a silent stall over HTTP/1.1; any UA, browser headers too; dev box and servarr the same",
    fallback: "pinned Wayback captures of the resource/en/... PDFs (vendor-docs.ts fetch column); SVDs from a GitHub mirror",
    probe: "https://www.st.com/resource/en/datasheet/usblc6-2.pdf",
  },
  "docs.redhat.com": {
    status: "blocked",
    since: "2026-11-07",
    checked: "2026-11-22",
    evidence: "Akamai 403 for any UA, PDFs too; access.redhat.com redirects here",
    fallback: "rhel9-* sources list pinned Wayback captures (pageConcurrency 1, minRefetchSeconds 30d)",
    probe: "https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9",
  },
  "downloads.mysql.com": {
    status: "blocked",
    since: "2026-08",
    checked: "2026-11-22",
    evidence: "Oracle CDN 403 for the fetcher UA and a browser UA (a made-up bot UA got 200 once on 2026-11-22: not UA-keyed in any stable way)",
    fallback: "mysql: fallbackDiscoveryUrl = pinned Wayback capture of mysql-8.4.info.zip",
    probe: "https://downloads.mysql.com/docs/mysql-8.4.info.zip",
  },
  "docs.nordicsemi.com": {
    status: "blocked",
    since: "2026-11-07",
    checked: "2026-11-22",
    evidence: "403 for the fetcher UA and a browser UA (JS doc portal behind a WAF)",
    fallback: "nordic-nrf52820/nordic-nrf52840 come from the nrfx SVDs on GitHub; PS PDFs need captures (docs-ssh#41)",
    probe: "https://docs.nordicsemi.com/bundle/ps_nrf52840/page/keyfeatures_html5.html",
  },
  "leginfo.legislature.ca.gov": {
    status: "blocked",
    since: "2026-10-08",
    checked: "2026-11-22",
    evidence: "403 for every UA",
    fallback: "privacy-laws-us pins a Wayback capture of the CCPA page",
    probe: "https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?division=3.&part=4.&lawCode=CIV&title=1.81.5",
  },
  "www.legisquebec.gouv.qc.ca": {
    status: "blocked",
    since: "2026-10-06",
    checked: "2026-11-22",
    evidence: "403 for the fetcher UA, 502 for a browser UA (it 403d only the bot UA before 2026-10)",
    fallback: "privacy-laws-ca pins a Wayback capture of Law 25",
    probe: "https://www.legisquebec.gouv.qc.ca/en/document/cs/P-39.1",
  },
  "www.legifrance.gouv.fr": {
    status: "blocked",
    since: "2026-08-20",
    checked: "2026-11-22",
    evidence: "403 for every UA",
    fallback: "privacy-laws-eu pins a 2021 Wayback capture of Loi 78-17",
    probe: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000886460/",
  },
  "codes.ohio.gov": {
    status: "blocked",
    since: "2026-08-20",
    checked: "2026-11-22",
    evidence: "connection stalls (no response in 20 s), any UA",
    fallback: "privacy-laws-us pins Wayback captures of ORC ch. 1354",
    probe: "https://codes.ohio.gov/ohio-revised-code/chapter-1354",
  },
  "www.oregonlegislature.gov": {
    status: "blocked",
    since: "2026-08-20",
    checked: "2026-11-22",
    evidence: "connection stalls (no response in 20 s), any UA",
    fallback: "privacy-laws-us takes OCPA from oregon.public.law (unofficial, current)",
    probe: "https://www.oregonlegislature.gov/bills_laws/ors/ors646a.html",
  },
  "eur-lex.europa.eu": {
    status: "challenge",
    since: "2026-08-20",
    checked: "2026-11-22",
    evidence: "AWS WAF JS challenge: HTTP 202 with a challenge page, any UA",
    fallback: "pinned Wayback captures",
    probe: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  },
  "www.legislation.gov.uk": {
    status: "challenge",
    since: "2026-08-20",
    checked: "2026-11-22",
    evidence: "AWS WAF JS challenge: HTTP 202 with a challenge page, any UA",
    fallback: "pinned Wayback captures",
    probe: "https://www.legislation.gov.uk/ukpga/2018/12/contents",
  },
  "www.planalto.gov.br": {
    status: "ua-filtered",
    since: "2026-08-20",
    checked: "2026-11-22",
    evidence:
      "fetcher UA: connection reset/stall; browser UA: 200 with the law text (310 KB, 2026-11-22). Between 2026-11-11 and then the law page 302d to an F5 captcha wall for any client (privacy-laws-brazil comment)",
    fallback: "privacy-laws-brazil pins a 2026-10-27 Wayback capture (later captures are the 'Acesso Negado' page) and keeps userAgent: BROWSER_UA",
    probe: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm",
  },
  "sso.agc.gov.sg": {
    status: "ua-filtered",
    since: "2026-08-20",
    checked: "2026-11-22",
    evidence: "fetcher UA: 403; browser UA: 200",
    fallback: "userAgent: BROWSER_UA",
    probe: "https://sso.agc.gov.sg/Act/PDPA2012",
  },
  "www.riksdagen.se": {
    status: "ipv6-broken",
    since: "2026-08-20",
    checked: "2026-11-22",
    evidence: "IPv6 connect times out (curl -6 too), IPv4 answers; undici hangs on the AAAA route",
    fallback: "privacy-laws-eu uses rkrattsbaser.gov.se (official consolidated statutes)",
  },
  "www.nxp.com": {
    status: "login",
    since: "2026-11-11",
    checked: "2026-11-11",
    evidence: "i.MX RT reference manuals, HDUGs, EVK schematics and most app notes need an NXP account (checked by hand 2026-11-11)",
    fallback: "datasheets/errata via Wayback; SVDs from imxrt-ral; the rest not mirrored",
  },
  "openvpn.net": {
    status: "lifted",
    since: "2026-08-11",
    checked: "2026-11-22",
    evidence: "WAF 503d any request carrying Accept: text/markdown; on 2026-11-22 it answers 200 with and without it",
    fallback: "openvpn keeps skipMarkdownNegotiation (negotiated output never compared)",
  },
  "wiki.archlinux.org": {
    status: "lifted",
    since: "2026-11-05",
    checked: "2026-11-22",
    evidence: "refused our WAN IP at the TLS handshake after two full scrapes ~26 h apart (docs-ssh#20); 200 again on 2026-11-22",
    fallback: "archwiki ingests the arch-wiki-docs package from an Arch mirror (zero load on the wiki); do not go back to scraping",
  },
  "techdocs.akamai.com": {
    status: "lifted",
    since: "2026-06-30",
    checked: "2026-11-22",
    evidence: "Bot Manager 403s came and went; 200 on 2026-11-22",
    fallback: "none: akamai source removed 2026-10-19 (9.7k pages never fit the deadline)",
  },
};

/** Statuses under which a source must not fetch the host live. */
export const NO_LIVE_FETCH: ReadonlySet<AccessStatus> = new Set(["blocked", "challenge"]);

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** URLs a source requests directly (not the page URLs a discovery step finds). */
export function directFetchUrls(source: DocSource): string[] {
  if (source.type === "rsync") return [];
  if (source.type === "git") return [source.url];
  const out = [...source.urls];
  if (source.discovery !== "none" && source.discoveryUrl) out.push(...source.discoveryUrl.split(/\s+/).filter(Boolean));
  if (out.length === 0) out.push(source.url);
  return out;
}

/** One line per source that ignores its host's registry entry. */
export function accessViolations(
  sources: readonly DocSource[],
  registry: Readonly<Record<string, UpstreamAccess>> = UPSTREAM_ACCESS,
): string[] {
  const out: string[] = [];
  for (const s of sources) {
    for (const url of directFetchUrls(s)) {
      const host = hostOf(url);
      const entry = registry[host];
      if (!entry) continue;
      if (NO_LIVE_FETCH.has(entry.status)) {
        const fb = s.fallbackDiscoveryUrl;
        const covered = fb !== undefined && hostOf(fb) !== host && s.discoveryUrl?.includes(url) === true;
        if (!covered) out.push(`${s.name}: fetches ${url} live but ${host} is ${entry.status} (${entry.fallback})`);
      } else if (entry.status === "ua-filtered" && !s.userAgent) {
        out.push(`${s.name}: ${host} is ua-filtered, set userAgent: BROWSER_UA`);
      } else if (entry.status === "header-filtered" && !s.skipMarkdownNegotiation) {
        out.push(`${s.name}: ${host} is header-filtered, set skipMarkdownNegotiation: true`);
      }
    }
  }
  return out;
}
