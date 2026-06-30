import { Link2, Users, UserPlus, WifiOff, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceRole } from '../../domain/project/types'
import { useProjectStore } from '../../store/project-store'
import { useModalA11y } from '../settings/useModalA11y'

const inviteRoles: Array<Exclude<WorkspaceRole, 'owner'>> = ['editor', 'viewer']

export function WorkspaceSharingModal() {
  const sharing = useProjectStore((state) => state.project.meta.sharing)
  const workspaceSyncConflicts = useProjectStore((state) => state.workspaceSyncConflicts)
  const networkStatus = useProjectStore((state) => state.ui.networkStatus)
  const closeWorkspaceSharing = useProjectStore((state) => state.closeWorkspaceSharing)
  const enableWorkspaceSharing = useProjectStore((state) => state.enableWorkspaceSharing)
  const disableWorkspaceSharing = useProjectStore((state) => state.disableWorkspaceSharing)
  const setWorkspaceAccessLevel = useProjectStore((state) => state.setWorkspaceAccessLevel)
  const inviteWorkspaceCollaborator = useProjectStore((state) => state.inviteWorkspaceCollaborator)
  const acceptWorkspaceInvite = useProjectStore((state) => state.acceptWorkspaceInvite)
  const revokeWorkspaceInvite = useProjectStore((state) => state.revokeWorkspaceInvite)
  const updateWorkspaceCollaboratorRole = useProjectStore((state) => state.updateWorkspaceCollaboratorRole)
  const removeWorkspaceCollaborator = useProjectStore((state) => state.removeWorkspaceCollaborator)
  const resolveWorkspaceSyncConflict = useProjectStore((state) => state.resolveWorkspaceSyncConflict)
  const dismissWorkspaceSyncConflict = useProjectStore((state) => state.dismissWorkspaceSyncConflict)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, 'owner'>>('editor')
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const dialogRef = useModalA11y<HTMLElement>()

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeWorkspaceSharing()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [closeWorkspaceSharing])

  const onlineCollaboratorCount = useMemo(
    () => sharing.collaborators.filter((collaborator) => collaborator.presence === 'online').length,
    [sharing.collaborators],
  )

  async function handleCopyLink() {
    if (!sharing.shareLink) {
      return
    }

    try {
      await navigator.clipboard.writeText(sharing.shareLink)
      setCopyMessage('Share link copied')
    } catch {
      setCopyMessage('Clipboard unavailable in this runtime')
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-sharing-title"
        tabIndex={-1}
        className="w-full max-w-5xl rounded-[2rem] border border-white/10 bg-[#101112] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.55)] outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-[#e0ff00]">Workspace Sharing</p>
            <h2 id="workspace-sharing-title" className="mt-2 font-display text-3xl font-semibold tracking-tight text-white">
              Invite editors, manage access, and keep a shared workspace link ready.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#9ca3af]">
              FluxNode keeps collaboration metadata inside the project so team roles, invites, and presence travel with the workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={closeWorkspaceSharing}
            aria-label="Close workspace sharing"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
          >
            <X size={18} />
          </button>
        </div>

        {networkStatus === 'offline' ? (
          <div className="mt-5 flex items-center gap-2 rounded-[1rem] border border-amber-300/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
            <WifiOff size={16} />
            Workspace sharing is offline. Existing collaborator data remains visible, but invite and sync actions are disabled until connectivity returns.
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_1.3fr]">
          <section className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
            <div className="flex items-center gap-3">
              <Users size={18} className="text-[#e0ff00]" />
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Workspace</h3>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <InfoCard label="Owner" value={sharing.ownerEmail ? `${sharing.ownerName} · ${sharing.ownerEmail}` : sharing.ownerName} />
              <InfoCard label="Access" value={sharing.accessLevel.replace('_', ' ')} />
              <InfoCard label="Members" value={`${sharing.collaborators.length} active / ${onlineCollaboratorCount} online`} />
              <InfoCard label="Last Sync" value={sharing.lastSyncedAt ? new Date(sharing.lastSyncedAt).toLocaleString() : 'pending'} />
            </div>

            <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Share Status</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={networkStatus === 'offline'}
                  aria-pressed={sharing.enabled}
                  onClick={sharing.enabled ? disableWorkspaceSharing : enableWorkspaceSharing}
                  className={`rounded-full px-4 py-2 text-sm ${
                    sharing.enabled
                      ? 'bg-[#e0ff00] font-semibold text-black'
                      : 'border border-white/10 bg-white/5 text-white'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {sharing.enabled ? 'Disable Sharing' : 'Enable Sharing'}
                </button>
                {(['private', 'team', 'public_view'] as const).map((accessLevel) => (
                  <button
                    key={accessLevel}
                    type="button"
                    disabled={!sharing.enabled || networkStatus === 'offline'}
                    aria-pressed={sharing.accessLevel === accessLevel}
                    aria-label={`Set access level to ${accessLevel.replace('_', ' ')}`}
                    onClick={() => setWorkspaceAccessLevel(accessLevel)}
                    className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] ${
                      sharing.accessLevel === accessLevel
                        ? 'border-[#3b82f6]/40 bg-[#3b82f6]/15 text-[#dbeafe]'
                        : 'border-white/10 bg-transparent text-white'
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    {accessLevel.replace('_', ' ')}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-[1rem] border border-white/8 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-[#7f8691]">Share Link</p>
                    <p className="mt-2 break-all text-sm text-white">{sharing.shareLink ?? 'Enable workspace sharing to generate a share link.'}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!sharing.shareLink}
                    onClick={() => void handleCopyLink()}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Link2 size={14} />
                    Copy
                  </button>
                </div>
                <p aria-live="polite" className="mt-2 text-xs text-[#9ca3af]">{copyMessage ?? ''}</p>
              </div>
            </div>

            <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
              <label className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Invite Collaborator</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="editor@studio.com"
                className="mt-3 w-full rounded-[1rem] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-[#7f8691]"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {inviteRoles.map((role) => (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={inviteRole === role}
                    aria-label={`Invite as ${role}`}
                    onClick={() => setInviteRole(role)}
                    className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] ${
                      inviteRole === role
                        ? 'border-[#e0ff00]/35 bg-[#e0ff00]/10 text-[#f5ffd5]'
                        : 'border-white/10 bg-transparent text-white'
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={!sharing.enabled || networkStatus === 'offline' || inviteEmail.trim().length === 0}
                onClick={() => {
                  inviteWorkspaceCollaborator(inviteEmail, inviteRole)
                  setInviteEmail('')
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UserPlus size={14} />
                Send Invite
              </button>
            </div>
          </section>

          <section className="space-y-4 rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Collaborators</p>
              <div className="mt-4 space-y-3">
                {sharing.collaborators.length === 0 ? (
                  <EmptyState text="No active collaborators yet. Accept an invite to seed the live workspace roster." />
                ) : (
                  sharing.collaborators.map((collaborator) => (
                    <div key={collaborator.id} className="rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{collaborator.name}</p>
                          <p className="mt-1 text-xs text-[#9ca3af]">{collaborator.email}</p>
                        </div>
                        <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[#cbd2dc]">
                          {collaborator.presence}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {inviteRoles.map((role) => (
                          <button
                            key={role}
                            type="button"
                            disabled={networkStatus === 'offline'}
                            aria-pressed={collaborator.role === role}
                            aria-label={`Set ${collaborator.name} role to ${role}`}
                            onClick={() => updateWorkspaceCollaboratorRole(collaborator.id, role)}
                            className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] ${
                              collaborator.role === role
                                ? 'border-[#e0ff00]/35 bg-[#e0ff00]/10 text-[#f5ffd5]'
                                : 'border-white/10 bg-transparent text-white'
                            } disabled:cursor-not-allowed disabled:opacity-45`}
                          >
                            {role}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={networkStatus === 'offline'}
                          onClick={() => removeWorkspaceCollaborator(collaborator.id)}
                          className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Pending Invites</p>
              <div className="mt-4 space-y-3">
                {sharing.invites.filter((invite) => invite.status === 'pending').length === 0 ? (
                  <EmptyState text="No pending invites. Send an invite to start collaboration." />
                ) : (
                  sharing.invites
                    .filter((invite) => invite.status === 'pending')
                    .map((invite) => (
                      <div key={invite.id} className="rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
                        <p className="text-sm font-medium text-white">{invite.email}</p>
                        <p className="mt-1 text-xs text-[#9ca3af]">
                          {invite.role} invited {new Date(invite.invitedAt).toLocaleString()}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={networkStatus === 'offline'}
                            onClick={() => acceptWorkspaceInvite(invite.id)}
                            className="rounded-full bg-[#e0ff00] px-4 py-2 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            Accept Invite
                          </button>
                          <button
                            type="button"
                            disabled={networkStatus === 'offline'}
                            onClick={() => revokeWorkspaceInvite(invite.id)}
                            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Sync Conflicts</p>
              <div className="mt-4 space-y-3">
                {workspaceSyncConflicts.length === 0 ? (
                  <EmptyState text="No workspace conflicts detected. Last-write-wins is standing by if simultaneous edits arrive." />
                ) : (
                  workspaceSyncConflicts.map((conflict) => (
                    <div key={conflict.id} className="rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
                      <p className="text-sm font-medium text-white">
                        {conflict.resolvedWith
                          ? `Resolved with ${conflict.resolvedWith}`
                          : `Auto-${conflict.autoResolution} resolution pending review`}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#9ca3af]">
                        Remote window {conflict.sourceWindowId} · Local {conflict.localUpdatedAt ?? 'unknown'} · Remote {conflict.remoteUpdatedAt ?? 'unknown'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => resolveWorkspaceSyncConflict(conflict.id, 'local')}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white"
                        >
                          Keep Local
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveWorkspaceSyncConflict(conflict.id, 'remote')}
                          className="rounded-full bg-[#e0ff00] px-4 py-2 text-xs font-semibold text-black"
                        >
                          Apply Remote
                        </button>
                        <button
                          type="button"
                          onClick={() => dismissWorkspaceSyncConflict(conflict.id)}
                          className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-xs text-white"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">{label}</p>
      <p className="mt-3 break-all text-sm leading-6 text-white">{value}</p>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-white/10 bg-[#111214] p-4 text-sm text-[#9ca3af]">
      {text}
    </div>
  )
}
