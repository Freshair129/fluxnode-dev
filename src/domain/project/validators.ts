import type { FluxNodeProject } from './types'

export interface ProjectValidationIssue {
  level: 'error' | 'warning'
  scope: 'project' | 'timeline' | 'workflow' | 'assets'
  message: string
}

export function validateProject(project: FluxNodeProject): ProjectValidationIssue[] {
  const issues: ProjectValidationIssue[] = []
  const clips = project.timeline.tracks.flatMap((track) => track.clips)

  if (!project.meta.name.trim()) {
    issues.push({
      level: 'error',
      scope: 'project',
      message: 'Project name is required.',
    })
  }

  if (project.meta.sharing.enabled && !project.meta.sharing.shareLink) {
    issues.push({
      level: 'warning',
      scope: 'project',
      message: 'Workspace sharing is enabled but no share link is available yet.',
    })
  }

  const collaboratorEmails = new Set<string>()
  for (const collaborator of project.meta.sharing.collaborators) {
    const normalizedEmail = collaborator.email.trim().toLowerCase()
    if (!normalizedEmail) {
      issues.push({
        level: 'error',
        scope: 'project',
        message: `Collaborator ${collaborator.name} is missing an email address.`,
      })
      continue
    }

    if (collaboratorEmails.has(normalizedEmail)) {
      issues.push({
        level: 'warning',
        scope: 'project',
        message: `Duplicate workspace collaborator email detected: ${collaborator.email}.`,
      })
    }

    collaboratorEmails.add(normalizedEmail)
  }

  if (project.timeline.tracks.length === 0) {
    issues.push({
      level: 'warning',
      scope: 'timeline',
      message: 'Timeline has no tracks yet. Use Add Track Above or Add Track Below in the Timeline view.',
    })
  }

  for (const track of project.timeline.tracks) {
    if (!track.visible) {
      issues.push({
        level: 'warning',
        scope: 'timeline',
        message: `${track.name} is hidden and will not appear in the timeline preview.`,
      })
    }

    for (const clip of track.clips) {
      const asset = project.assets.assets[clip.assetId]

      if (!asset) {
        issues.push({
          level: 'error',
          scope: 'assets',
          message: `Clip ${clip.id} references missing asset ${clip.assetId}.`,
        })
        continue
      }

      if (asset.status === 'missing') {
        issues.push({
          level: 'warning',
          scope: 'assets',
          message: `${asset.name} is offline. Use Replace Media or Batch Relink to fix it.`,
        })
      } else if (asset.status === 'corrupt') {
        issues.push({
          level: 'error',
          scope: 'assets',
          message: `${asset.name} cannot be decoded. Use Replace Media to relink it, or Delete the clip.`,
        })
      }

      if (clip.workflowNodeId) {
        const linkedNode = project.workflow.nodes.find((node) => node.id === clip.workflowNodeId)

        if (!linkedNode) {
          issues.push({
            level: 'error',
            scope: 'workflow',
            message: `Clip ${clip.id} points to missing workflow node ${clip.workflowNodeId}.`,
          })
          continue
        }

        const linkedTimelineClipId =
          'timelineClipId' in linkedNode.data && typeof linkedNode.data.timelineClipId === 'string'
            ? linkedNode.data.timelineClipId
            : null

        if (linkedTimelineClipId !== clip.id) {
          issues.push({
            level: 'warning',
            scope: 'workflow',
            message: `Clip ${clip.id} and workflow node ${linkedNode.id} are not linked atomically.`,
          })
        }
      }
    }
  }

  for (const node of project.workflow.nodes) {
    const linkedTimelineClipId =
      'timelineClipId' in node.data && typeof node.data.timelineClipId === 'string'
        ? node.data.timelineClipId
        : null

    if (!linkedTimelineClipId) {
      continue
    }

    const linkedClip = clips.find((clip) => clip.id === linkedTimelineClipId)

    if (!linkedClip) {
      issues.push({
        level: 'warning',
        scope: 'timeline',
        message: `Workflow node ${node.id} points to missing timeline clip ${linkedTimelineClipId}.`,
      })
      continue
    }

    if (linkedClip.workflowNodeId !== node.id) {
      issues.push({
        level: 'warning',
        scope: 'timeline',
        message: `Workflow node ${node.id} and clip ${linkedClip.id} are not linked atomically.`,
      })
    }
  }

  if (project.output.presets.length === 0) {
    issues.push({
      level: 'error',
      scope: 'project',
      message: 'At least one export preset is required.',
    })
  }

  return issues
}
