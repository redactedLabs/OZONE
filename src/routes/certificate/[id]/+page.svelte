<script lang="ts">
	let { data } = $props();

	let copiedLink = $state(false);

	function copyLink() {
		navigator.clipboard.writeText(window.location.href);
		copiedLink = true;
		setTimeout(() => { copiedLink = false; }, 2000);
	}
</script>

<svelte:head>
	<title>{data.certId} — Ozone Certificate</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 pt-20 pb-16">
	{#if data.flagged}
		<!-- Flagged cert view -->
		<div class="cert-card rounded-2xl overflow-hidden" style="border-color: rgba(239,68,68,0.3);">
			<div class="p-1" style="background: linear-gradient(90deg, #ef4444, #dc2626);"></div>
			<div class="p-6 sm:p-8 text-center">
				<div class="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4" style="background: rgba(239,68,68,0.1); border: 2px solid rgba(239,68,68,0.3);">
					<span class="text-3xl" style="color: #ef4444;">&#10007;</span>
				</div>
				<h2 class="text-xl font-bold mb-1" style="color: #ef4444;">Address Flagged</h2>
				<p class="text-xs font-mono mb-2" style="color: var(--text-muted);">{data.address}</p>
				<p class="text-xs font-mono mb-4" style="color: var(--text-faint);">Certificate {data.certId}</p>
				<p class="text-sm" style="color: var(--text-secondary);">
					This address was flagged during compliance screening on {data.issuedAt ? new Date(data.issuedAt).toLocaleDateString() : 'unknown date'}.
				</p>
			</div>
		</div>
	{:else}
		<!-- Clean cert view -->
		<div class="cert-card cert-glow rounded-2xl overflow-hidden">
			<div class="p-1" style="background: linear-gradient(90deg, #10b981, #6366f1, #10b981);"></div>
			<div class="p-6 sm:p-10">
				<!-- Verified badge -->
				<div class="text-center mb-2">
					<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-4" style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);">
						<span class="inline-block h-2 w-2 rounded-full" style="background: #10b981;"></span>
						<span class="text-xs font-semibold" style="color: #10b981;">Verified Certificate</span>
					</div>
				</div>

				<!-- Header -->
				<div class="text-center mb-6">
					<div class="flex items-center justify-center gap-2 mb-3">
						<img src="/redacted-logo.svg" alt="Redacted" style="height: 18px; opacity: 0.7;" />
						<span class="text-[10px] font-mono" style="color: var(--text-faint);">REDACTED\OZONE</span>
					</div>
					<h2 class="text-2xl sm:text-3xl font-bold tracking-tight" style="color: var(--text);">Proof of Innocence</h2>
				</div>

				<!-- Certificate Body -->
				<div class="rounded-xl p-5 mb-6" style="background: rgba(16,185,129,0.03); border: 1px solid rgba(16,185,129,0.1);">
					<div class="text-center mb-4">
						<div class="inline-flex items-center justify-center w-14 h-14 rounded-full mb-3" style="background: rgba(16,185,129,0.1); border: 2px solid rgba(16,185,129,0.3);">
							<span class="text-2xl" style="color: #10b981;">&#10003;</span>
						</div>
						<div class="text-xs" style="color: var(--text-muted);">This certifies that the address</div>
						<div class="text-sm font-mono font-semibold mt-1 break-all" style="color: var(--text);">{data.address}</div>
					</div>
					<p class="text-xs text-center leading-relaxed" style="color: var(--text-secondary);">
						has been screened against all compliance databases maintained by Redacted Ozone
						and <span style="color: #10b981; font-weight: 600;">no matches were found</span>.
					</p>
				</div>

				<!-- Details Grid -->
				<div class="grid grid-cols-2 gap-3 mb-6">
					<div class="rounded-lg p-3" style="background: rgba(255,255,255,0.02); border: 1px solid var(--app-border);">
						<div class="text-[10px]" style="color: var(--text-faint);">Certificate ID</div>
						<div class="text-xs font-mono mt-0.5" style="color: var(--text);">{data.certId}</div>
					</div>
					<div class="rounded-lg p-3" style="background: rgba(255,255,255,0.02); border: 1px solid var(--app-border);">
						<div class="text-[10px]" style="color: var(--text-faint);">Issued</div>
						<div class="text-xs font-mono mt-0.5" style="color: var(--text);">{data.issuedAt ? new Date(data.issuedAt).toLocaleDateString() : '--'}</div>
					</div>
					<div class="rounded-lg p-3" style="background: rgba(255,255,255,0.02); border: 1px solid var(--app-border);">
						<div class="text-[10px]" style="color: var(--text-faint);">Databases Checked</div>
						<div class="text-xs font-mono mt-0.5" style="color: var(--text);">{data.sourcesChecked} sources</div>
					</div>
					<div class="rounded-lg p-3" style="background: rgba(255,255,255,0.02); border: 1px solid var(--app-border);">
						<div class="text-[10px]" style="color: var(--text-faint);">Result</div>
						<div class="text-xs font-semibold mt-0.5" style="color: #10b981;">CLEAR</div>
					</div>
				</div>

				<!-- Sources -->
				<div class="mb-6">
					<div class="text-[10px] mb-2" style="color: var(--text-faint);">SOURCES VERIFIED</div>
					<div class="flex flex-wrap gap-1.5">
						{#each ['OFAC SDN', 'EU Sanctions', 'Known Hacks', 'Tether Frozen', 'ScamSniffer', 'Eth Labels', 'Chainalysis', 'Manual Flags'] as src}
							<span class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px]" style="background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.15); color: #10b981;">
								&#10003; {src}
							</span>
						{/each}
					</div>
				</div>

				<!-- Actions -->
				<div class="flex items-center justify-center gap-3 mb-6">
					<button onclick={copyLink} class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">
						{copiedLink ? 'Link copied!' : 'Copy link'}
					</button>
					<a href="/certificate" class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">
						Screen another
					</a>
				</div>

				<!-- Footer -->
				<div class="text-center pt-4" style="border-top: 1px solid var(--app-border);">
					<p class="text-[9px] leading-relaxed" style="color: var(--text-ghost);">
						This certificate is generated automatically by Redacted Ozone and represents a point-in-time compliance check.
						It does not constitute legal advice. Re-screen periodically for continued compliance.
					</p>
					<div class="mt-3 flex items-center justify-center gap-2">
						<img src="/redacted-logo.svg" alt="" style="height: 12px; opacity: 0.3;" />
						<span class="text-[9px] font-mono" style="color: var(--text-ghost);">ozone.redacted.gg</span>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.cert-card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		backdrop-filter: blur(8px);
	}
	.cert-glow {
		box-shadow: 0 0 60px rgba(16, 185, 129, 0.06), 0 0 120px rgba(99, 102, 241, 0.04);
	}
</style>
