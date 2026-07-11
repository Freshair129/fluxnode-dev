import { Users } from 'lucide-react'
import { useProjectStore } from '../../../store/project-store'
import { StatusPill } from '../shared/PanelPrimitives'
import { DrawerShell } from './DrawerShell'

/**
 * MERIDIAN item 9: relocated verbatim content from `SystemPanels.tsx`'s "Workspace sharing"
 * section. This is a STATUS SUMMARY only — the full sharing management surface is the existing
 * `WorkspaceSharingModal` (`features/workspace/WorkspaceSharingModal.tsx`), unchanged, already
 * reachable from the Header's "More workspace actions" menu; "Manage Workspace" here opens the
 * same modal via the same `openWorkspaceSharing` store action.
 */
export function WorkspaceSharingDrawer({ onClose }: { onClose: () => void }) {
  const workspaceSharing = useProjectStore((state) => state.project.meta.sharing)
  const workspaceSyncConflicts = useProjectStore((state) => state.workspaceSyncConflicts)
  const openWorkspaceSharing = useProjectStore((state) => state.openWorkspaceSharing)

  const pendingInvites = workspaceSharing.invites.filter((invite) => invite.status === 'pending').length

  return (
    <DrawerShell icon={Users} title="Workspace Sync" onClose={onClose}>
      <div className="space-y-3">
        <StatusPill label={workspaceSharing.enabled ? 'Sharing Enabled' : 'Private Workspace'} tone={workspaceSharing.enabled ? 'ok' : 'warn'} />
        <p className="text-xs leading-5 text-[#9ca3af]">
          Access {workspaceSharing.accessLevel.replace('_', ' ')} with {workspaceSharing.collaborators.length} collaborator
          {workspaceSharing.collaborators.length === 1 ? '' : 's'} and {pendingInvites} pending invite{pendingInvites === 1 ? '' : 's'}.
        </p>
        <p className="text-xs leading-5 text-[#9ca3af]">
          {workspaceSharing.lastSyncedAt
            ? `Last workspace sync ${new Date(workspaceSharing.lastSyncedAt).toLocaleString()}`
            : 'Workspace sync has not run yet. Use Manage Workspace below to enable sharing.'}
        </p>
        <p className="text-xs leading-5 text-[#9ca3af]">
          {workspaceSyncConflicts.length === 0
            ? 'No co-edit conflicts queued.'
            : `${workspaceSyncConflicts.length} co-edit conflict${workspaceSyncConflicts.length === 1 ? '' : 's'} queued for review.`}
        </p>
        <p className="break-all text-xs leading-5 text-[#7f8792]">
          {workspaceSharing.shareLink ?? 'Enable sharing to create a workspace link.'}
        </p>
      </div>
      <button
        type="button"
        onClick={openWorkspaceSharing}
        className="mt-4 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
      >
        Manage Workspace
      </button>
    </DrawerShell>
  )
}
