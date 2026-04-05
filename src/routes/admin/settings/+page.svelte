<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	const isOwner = $derived(data.user?.role === 'owner');

	let inviteEmail = $state('');
	let inviteName = $state('');
	let inviteRole = $state('admin');
	let inviting = $state(false);
	let inviteResult = $state<{ email: string; password: string } | null>(null);
	let inviteError = $state('');

	async function inviteUser() {
		if (!inviteEmail) return;
		inviting = true;
		inviteError = '';
		inviteResult = null;

		try {
			const res = await fetch('/api/admin/invite', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: inviteEmail, name: inviteName || inviteEmail.split('@')[0], role: inviteRole })
			});
			const result = await res.json();
			if (result.error) {
				inviteError = result.error;
			} else {
				inviteResult = result;
				inviteEmail = '';
				inviteName = '';
				await invalidateAll();
			}
		} catch (e: any) {
			inviteError = e?.message || 'Failed';
		} finally {
			inviting = false;
		}
	}

	async function removeUser(userId: string) {
		if (!confirm('Remove this user? They will no longer be able to log in.')) return;
		await fetch('/api/admin/invite', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId })
		});
		await invalidateAll();
	}

	function timeAgo(dateStr: string | null): string {
		if (!dateStr) return 'Never';
		const diff = Date.now() - new Date(dateStr).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'Just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	const listInfo: Record<string, { name: string; desc: string; color: string }> = {
		OFAC: { name: 'OFAC SDN', desc: 'US Treasury sanctions list', color: '#ef4444' },
		EU: { name: 'EU Sanctions', desc: 'European Union consolidated list', color: '#3b82f6' },
		HACK: { name: 'Known Hacks', desc: 'Curated exploit addresses', color: '#f59e0b' },
		TETHER: { name: 'Tether Frozen', desc: 'On-chain USDT blacklist', color: '#26a17b' },
		SCREEN: { name: 'Screener', desc: 'Address screening', color: '#6366f1' },
		SCAM: { name: 'ScamSniffer', desc: 'Phishing scam address database', color: '#ec4899' },
		MIDGARD: { name: 'Midgard', desc: 'THORChain members + L1', color: '#818cf8' },
	};

	const roleColors: Record<string, string> = {
		owner: 'background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3)',
		admin: 'background: rgba(99,102,241,0.15); color: #818cf8; border: 1px solid rgba(99,102,241,0.3)',
	};
</script>

<svelte:head>
	<title>Settings — Admin</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 pt-20 pb-12">
	<h1 class="text-2xl font-bold mb-2" style="color: #f1f5f9;">Settings</h1>
	<p class="text-sm mb-8" style="color: #64748b;">
		Logged in as <strong style="color: #f1f5f9;">{data.user?.email}</strong>
		<span class="ml-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={roleColors[data.user?.role || 'admin']}>{data.user?.role || 'admin'}</span>
	</p>

	<!-- Invite -->
	<div class="rounded-xl p-6 mb-8" style="background: #0d0d1f; border: 1px solid #1e293b;">
		<h2 class="text-lg font-semibold mb-1" style="color: #f1f5f9;">Invite Collaborator</h2>
		<p class="text-xs mb-4" style="color: #64748b;">A random password is generated. Share it securely — shown only once.</p>

		<div class="flex flex-wrap gap-3">
			<input bind:value={inviteEmail} placeholder="email@example.com" type="email" class="admin-input flex-1 min-w-48 rounded-lg px-3 py-2 text-sm" />
			<input bind:value={inviteName} placeholder="Name" class="admin-input w-36 rounded-lg px-3 py-2 text-sm" />
			{#if isOwner}
				<select bind:value={inviteRole} class="admin-input rounded-lg px-3 py-2 text-sm">
					<option value="admin">Admin</option>
					<option value="owner">Owner</option>
				</select>
			{/if}
			<button onclick={inviteUser} disabled={inviting || !inviteEmail} class="rounded-lg px-5 py-2 text-sm font-medium text-white disabled:opacity-50" style="background: #6366f1;">
				{inviting ? 'Creating...' : 'Invite'}
			</button>
		</div>

		{#if inviteResult}
			<div class="mt-4 rounded-lg p-4" style="background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2);">
				<p class="text-sm font-medium mb-2" style="color: #10b981;">User created! Share these credentials:</p>
				<div class="font-mono text-sm space-y-1" style="color: #f1f5f9;">
					<p>Email: <strong>{inviteResult.email}</strong></p>
					<p>Password: <strong>{inviteResult.password}</strong></p>
				</div>
				<p class="text-[10px] mt-2" style="color: #475569;">Shown only once. User should change password after first login.</p>
			</div>
		{/if}

		{#if inviteError}
			<p class="mt-3 text-sm" style="color: #ef4444;">{inviteError}</p>
		{/if}
	</div>

	<!-- Users -->
	<div class="rounded-xl p-6 mb-8" style="background: #0d0d1f; border: 1px solid #1e293b;">
		<h2 class="text-lg font-semibold mb-4" style="color: #f1f5f9;">Team ({data.adminUsers.length})</h2>
		<div class="space-y-2">
			{#each data.adminUsers as u}
				<div class="flex items-center gap-3 rounded-lg px-4 py-3" style="background: #060610; border: 1px solid #1e293b;">
					<span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {u.role === 'owner' ? '#f59e0b' : '#10b981'};"></span>
					<span class="text-sm font-medium" style="color: #f1f5f9;">{u.email}</span>
					<span class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={roleColors[u.role]}>{u.role}</span>
					<span class="text-xs" style="color: #475569;">{u.name}</span>
					<span class="ml-auto text-xs" style="color: #475569;">
						{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : ''}
					</span>
					{#if u.role !== 'owner' && (isOwner || data.user?.role === 'admin')}
						<button onclick={() => removeUser(u.id)} class="text-xs" style="color: #ef4444;">Remove</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Compliance Lists Status -->
	<div class="rounded-xl p-6" style="background: #0d0d1f; border: 1px solid #1e293b;">
		<h2 class="text-lg font-semibold mb-4" style="color: #f1f5f9;">Compliance Lists</h2>
		<div class="space-y-2">
			{#each data.syncStats as stat}
				{@const info = listInfo[stat.type] || { name: stat.type, desc: '', color: '#64748b' }}
				<div class="flex items-center gap-3 rounded-lg px-4 py-3" style="background: #060610; border: 1px solid #1e293b;">
					<span class="rounded px-2 py-0.5 text-[10px] font-bold" style="background: {info.color}22; color: {info.color}; border: 1px solid {info.color}44;">{stat.type}</span>
					<div class="flex-1 min-w-0">
						<span class="text-sm" style="color: #f1f5f9;">{info.name}</span>
						<span class="text-xs ml-2" style="color: #475569;">{info.desc}</span>
					</div>
					<div class="flex items-center gap-2 shrink-0">
						<span class="inline-block h-2 w-2 rounded-full" style="background: {stat.lastStatus === 'success' ? '#10b981' : '#ef4444'};"></span>
						<span class="text-xs" style="color: #64748b;">{timeAgo(stat.lastRun)}</span>
						<span class="text-[10px]" style="color: #475569;">{stat.totalRuns} runs</span>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.admin-input {
		background: #060610;
		border: 1px solid #1e293b;
		color: #f1f5f9;
		outline: none;
	}
	.admin-input:focus { border-color: #6366f1; }
	.admin-input::placeholder { color: #475569; }
</style>
