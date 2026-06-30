import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, Cloud, Copy, Cpu, Link2, Move, Network, Plus, Search, Trash2, X } from 'lucide-react'
import { NODE_PORT_DEFINITIONS } from '../../domain/workflow/node-definitions'
import { validateConnectionAttempt } from '../../domain/workflow/validation'
import type { NodeType, WorkflowNode, WorkflowState } from '../../domain/project/types'
import { buildNodePreviewSource, useProjectStore } from '../../store/project-store'
import { useModalA11y } from '../settings/useModalA11y'

const PORT_COLOR_MAP = {
  video: '#e0ff00',
  audio: '#3b82f6',
  image: '#a78bfa',
  mask: '#f97316',
  number: '#6b7280',
  color: '#f43f5e',
  any: '#ffffff',
} as const

const WORKFLOW_NODE_TYPES: NodeType[] = [
  'media_source',
  'camera',
  'shader',
  'compositor',
  'transform',
  'color_correct',
  'ai_generate',
  'ai_upscale',
  'output',
]

const CANVAS_EDGE_RENDER_THRESHOLD = 200

type CanvasPoint = { x: number; y: number }

type DragState = {
  nodeIds: string[]
  origin: CanvasPoint
  initialPositions: Record<string, CanvasPoint>
}

type ConnectionDraft = {
  sourceNodeId: string
  sourceHandle: string
  sourceDataType: keyof typeof PORT_COLOR_MAP
  pointer: CanvasPoint
}

type ConnectionFeedback = {
  message: string
  tone: 'error' | 'success'
}

type PortCandidateState = 'idle' | 'compatible' | 'incompatible' | 'active'

type MarqueeSelection = {
  origin: CanvasPoint
  current: CanvasPoint
  additive: boolean
}

type InvalidConnectionFlash = {
  source: CanvasPoint
  target: CanvasPoint
  color: string
}

type EdgeRenderSegment = {
  id: string
  source: CanvasPoint
  target: CanvasPoint
  stroke: string
}

type WorkflowGroupFrame = {
  id: string
  label: string
  nodeIds: string[]
  color: string
  left: number
  top: number
  width: number
  height: number
}

export function WorkflowView() {
  const workflow = useProjectStore((state) => state.project.workflow)
  const project = useProjectStore((state) => state.project)
  const selectedNodeIds = useProjectStore((state) => state.ui.selectedNodeIds)
  const showNodePicker = useProjectStore((state) => state.ui.showNodePicker)
  const workflowClipboard = useProjectStore((state) => state.ui.workflowClipboard)
  const workflowValidationIssues = useProjectStore((state) => state.workflowValidationIssues)
  const projectValidationIssues = useProjectStore((state) => state.projectValidationIssues)
  const workflowExecutionOrder = useProjectStore((state) => state.workflowExecutionOrder)
  const networkStatus = useProjectStore((state) => state.ui.networkStatus)
  const workflowConnectionFeedback = useProjectStore((state) => state.ui.workflowConnectionFeedback)
  const addNodeOfType = useProjectStore((state) => state.addNodeOfType)
  const workflowBenchmarkMetric = useProjectStore((state) => state.ui.workflowBenchmarkMetric)
  const recordWorkflowBenchmarkMetric = useProjectStore((state) => state.recordWorkflowBenchmarkMetric)
  const createLargeCanvasBenchmarkScene = useProjectStore((state) => state.createLargeCanvasBenchmarkScene)
  const nudgeFirstNode = useProjectStore((state) => state.nudgeFirstNode)
  const openNodePicker = useProjectStore((state) => state.openNodePicker)
  const closeNodePicker = useProjectStore((state) => state.closeNodePicker)
  const selectNode = useProjectStore((state) => state.selectNode)
  const setWorkflowSelection = useProjectStore((state) => state.setWorkflowSelection)
  const selectAllWorkflowNodes = useProjectStore((state) => state.selectAllWorkflowNodes)
  const selectOutputNode = useProjectStore((state) => state.selectOutputNode)
  const createTimelineClipFromSelectedNode = useProjectStore((state) => state.createTimelineClipFromSelectedNode)
  const showSelectedNodeInTimeline = useProjectStore((state) => state.showSelectedNodeInTimeline)
  const toggleSelectedNodeBypass = useProjectStore((state) => state.toggleSelectedNodeBypass)
  const setSelectedNodeComputeSource = useProjectStore((state) => state.setSelectedNodeComputeSource)
  const simulateSelectedNodeExecutionFailure = useProjectStore((state) => state.simulateSelectedNodeExecutionFailure)
  const clearSelectedNodeExecutionFailure = useProjectStore((state) => state.clearSelectedNodeExecutionFailure)
  const copySelectedNodes = useProjectStore((state) => state.copySelectedNodes)
  const pasteWorkflowClipboard = useProjectStore((state) => state.pasteWorkflowClipboard)
  const groupSelectedWorkflowNodes = useProjectStore((state) => state.groupSelectedWorkflowNodes)
  const duplicateSelected = useProjectStore((state) => state.duplicateSelected)
  const deleteSelected = useProjectStore((state) => state.deleteSelected)
  const connectSelectedNodeToOutput = useProjectStore((state) => state.connectSelectedNodeToOutput)
  const disconnectSelectedNodeEdges = useProjectStore((state) => state.disconnectSelectedNodeEdges)
  const loadPreviewFrameForSelectedNode = useProjectStore((state) => state.loadPreviewFrameForSelectedNode)
  const requestNodePreview = useProjectStore((state) => state.requestNodePreview)
  const nodePreviewFrames = useProjectStore((state) => state.nodePreviewFrames)
  const moveWorkflowNodes = useProjectStore((state) => state.moveWorkflowNodes)
  const connectWorkflowPorts = useProjectStore((state) => state.connectWorkflowPorts)
  const panWorkflowViewport = useProjectStore((state) => state.panWorkflowViewport)
  const adjustWorkflowZoom = useProjectStore((state) => state.adjustWorkflowZoom)
  const fitWorkflowViewport = useProjectStore((state) => state.fitWorkflowViewport)
  const validateWorkflow = useProjectStore((state) => state.validateWorkflow)
  const showWorkflowConnectionFeedback = useProjectStore((state) => state.showWorkflowConnectionFeedback)
  const clearWorkflowConnectionFeedback = useProjectStore((state) => state.clearWorkflowConnectionFeedback)
  const openDetachedPanel = useProjectStore((state) => state.openDetachedPanel)
  const [contextMenu, setContextMenu] = useState<
    | { type: 'node'; x: number; y: number }
    | { type: 'canvas'; x: number; y: number }
    | null
  >(null)
  const [nodeSearch, setNodeSearch] = useState('')
  const [isHandToolActive, setIsHandToolActive] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dragPreview, setDragPreview] = useState<Record<string, CanvasPoint>>({})
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null)
  const [connectionFeedback, setConnectionFeedback] = useState<ConnectionFeedback | null>(null)
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelection | null>(null)
  const [invalidConnectionFlash, setInvalidConnectionFlash] = useState<InvalidConnectionFlash | null>(null)
  const panOriginRef = useRef<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const denseEdgeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const filteredNodeTypes = useMemo(
    () =>
      WORKFLOW_NODE_TYPES.filter((type) =>
        type.replace('_', ' ').toLowerCase().includes(nodeSearch.trim().toLowerCase()),
      ),
    [nodeSearch],
  )
  const combinedIssues = [...projectValidationIssues, ...workflowValidationIssues]
  const selectedNode = workflow.nodes.find((node) => node.id === (selectedNodeIds[0] ?? null)) ?? null
  const selectedNodePreviewSource = useMemo(
    () => (selectedNode ? buildNodePreviewSource(workflow, selectedNode.id) : null),
    [selectedNode, workflow],
  )
  const selectedNodePreviewFrame =
    selectedNodePreviewSource ? nodePreviewFrames[selectedNodePreviewSource] ?? null : null

  useEffect(() => {
    if (!selectedNode || !selectedNodePreviewSource) {
      return
    }

    void requestNodePreview(selectedNode.id)
    // Re-request only when the upstream preview signature changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id, selectedNodePreviewSource, requestNodePreview])

  useEffect(() => {
    function closeMenu() {
      setContextMenu(null)
    }

    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === 'Space') {
        setIsHandToolActive(true)
      }
      if (event.key === 'Escape') {
        setConnectionDraft(null)
        setDragState(null)
        setDragPreview({})
        setMarqueeSelection(null)
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') {
        setIsHandToolActive(false)
        setIsPanning(false)
        panOriginRef.current = null
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useEffect(() => {
    if (!connectionFeedback) {
      return
    }

    const timer = window.setTimeout(() => setConnectionFeedback(null), 2200)
    return () => window.clearTimeout(timer)
  }, [connectionFeedback])

  useEffect(() => {
    if (!invalidConnectionFlash) {
      return
    }

    const timer = window.setTimeout(() => setInvalidConnectionFlash(null), 420)
    return () => window.clearTimeout(timer)
  }, [invalidConnectionFlash])

  useEffect(() => {
    if (!workflowConnectionFeedback.visibleUntil) {
      return
    }

    const delay = Math.max(0, Date.parse(workflowConnectionFeedback.visibleUntil) - Date.now())
    const timer = window.setTimeout(() => clearWorkflowConnectionFeedback(), delay)
    return () => window.clearTimeout(timer)
  }, [clearWorkflowConnectionFeedback, workflowConnectionFeedback.visibleUntil])

  useEffect(() => {
    if (!dragState) {
      return
    }

    const currentDragState = dragState

    function finalizeDrag() {
      const delta = getDragDelta(currentDragState, dragPreview)

      if (delta) {
        moveWorkflowNodes(currentDragState.nodeIds, delta.x, delta.y)
      }

      setDragState(null)
      setDragPreview({})
    }

    window.addEventListener('mouseup', finalizeDrag)
    return () => window.removeEventListener('mouseup', finalizeDrag)
  }, [dragPreview, dragState, moveWorkflowNodes])

  const runContextAction = (action: () => void) => () => {
    action()
    setContextMenu(null)
  }

  const measureBenchmarkFitView = () => {
    if (!workflowBenchmarkMetric.sceneLabel) {
      return
    }

    const startedAt = performance.now()
    fitWorkflowViewport()
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        recordWorkflowBenchmarkMetric({
          fitViewDurationMs: Number((performance.now() - startedAt).toFixed(1)),
          fitViewMeasuredAt: new Date().toISOString(),
        })
      })
    })
  }
  const measureBenchmarkPanAndZoom = async () => {
    if (!workflowBenchmarkMetric.sceneLabel) {
      return
    }

    const waitForAnimationFrames = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve())
        })
      }
    }

    const panSteps: Array<[number, number]> = [
      [140, 0],
      [0, 110],
      [140, 0],
      [0, 110],
    ]
    const startedPanAt = performance.now()
    for (const [deltaX, deltaY] of panSteps) {
      panWorkflowViewport(deltaX, deltaY)
      await waitForAnimationFrames(1)
    }
    const panTraversalDurationMs = Number((performance.now() - startedPanAt).toFixed(1))

    const zoomSteps = [0.08, 0.08, -0.08, -0.08]
    const startedZoomAt = performance.now()
    for (const delta of zoomSteps) {
      adjustWorkflowZoom(delta)
      await waitForAnimationFrames(1)
    }
    const zoomSweepDurationMs = Number((performance.now() - startedZoomAt).toFixed(1))

    recordWorkflowBenchmarkMetric({
      panTraversalDurationMs,
      zoomSweepDurationMs,
      interactionMeasuredAt: new Date().toISOString(),
    })
  }
  const activateWithKeyboard = (event: React.KeyboardEvent<HTMLElement>, action: () => void) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    action()
  }

  const displayedNodePositions = useMemo(
    () =>
      Object.fromEntries(
        workflow.nodes.map((node) => [node.id, dragPreview[node.id] ?? node.position]),
      ),
    [dragPreview, workflow.nodes],
  )
  const workflowGroupFrames = useMemo(
    () =>
      workflow.groups
        .map((group) => {
          const groupedNodes = group.nodeIds
            .map((nodeId) => workflow.nodes.find((node) => node.id === nodeId))
            .filter((node): node is WorkflowNode => Boolean(node))

          if (groupedNodes.length < 2) {
            return null
          }

          const bounds = groupedNodes.map((node) => {
            const position = displayedNodePositions[node.id] ?? node.position
            const metrics = getNodeMetrics(node, workflow.viewport.zoom)
            return {
              left: position.x - 18,
              top: position.y - 26,
              right: position.x + metrics.width + 18,
              bottom: position.y + metrics.height + 22,
            }
          })

          return {
            id: group.id,
            label: group.label,
            nodeIds: group.nodeIds,
            color: group.color,
            left: Math.min(...bounds.map((bound) => bound.left)),
            top: Math.min(...bounds.map((bound) => bound.top)) - 20,
            width: Math.max(...bounds.map((bound) => bound.right)) - Math.min(...bounds.map((bound) => bound.left)),
            height: Math.max(...bounds.map((bound) => bound.bottom)) - Math.min(...bounds.map((bound) => bound.top)) + 20,
          } satisfies WorkflowGroupFrame
        })
        .filter((group): group is WorkflowGroupFrame => Boolean(group)),
    [displayedNodePositions, workflow.groups, workflow.nodes, workflow.viewport.zoom],
  )
  const edgeSegments = useMemo(
    () =>
      workflow.edges.flatMap((edge) => {
        const source = workflow.nodes.find((node) => node.id === edge.source)
        const target = workflow.nodes.find((node) => node.id === edge.target)

        if (!source || !target) {
          return []
        }

        const sourcePoint = getPortAnchor(
          source,
          displayedNodePositions[source.id] ?? source.position,
          workflow.viewport.zoom,
          'output',
          edge.sourceHandle,
        )
        const targetPoint = getPortAnchor(
          target,
          displayedNodePositions[target.id] ?? target.position,
          workflow.viewport.zoom,
          'input',
          edge.targetHandle,
        )

        if (!sourcePoint || !targetPoint) {
          return []
        }

        return [{
          id: edge.id,
          source: sourcePoint,
          target: targetPoint,
          stroke:
            PORT_COLOR_MAP[
              NODE_PORT_DEFINITIONS[source.type].outputs.find((port) => port.name === edge.sourceHandle)
                ?.dataType ?? 'any'
            ],
        } satisfies EdgeRenderSegment]
      }),
    [displayedNodePositions, workflow.edges, workflow.nodes, workflow.viewport.zoom],
  )
  const usesCanvasEdgeRenderer = edgeSegments.length >= CANVAS_EDGE_RENDER_THRESHOLD
  const outputNode = workflow.nodes.find((node) => node.type === 'output') ?? null
  const outputAudioEdge =
    outputNode
      ? workflow.edges.find((edge) => edge.target === outputNode.id && edge.targetHandle === 'audio') ?? null
      : null
  const outputAudioSource =
    outputAudioEdge
      ? workflow.nodes.find((node) => node.id === outputAudioEdge.source) ?? null
      : null
  const audioMixNode = workflow.nodes.find((node) => node.type === 'audio_mix') ?? null
  const audioMixInputCount =
    audioMixNode
      ? workflow.edges.filter((edge) => edge.target === audioMixNode.id && edge.targetHandle === 'input').length
      : 0
  const connectedAudioClipCount = project.timeline.tracks
    .filter((track) => track.type === 'audio')
    .flatMap((track) => track.clips)
    .filter((clip) => clip.workflowNodeId && workflow.nodes.some((node) => node.id === clip.workflowNodeId))
    .length

  useEffect(() => {
    if (!usesCanvasEdgeRenderer || !denseEdgeCanvasRef.current) {
      return
    }

    const canvas = denseEdgeCanvasRef.current
    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.lineWidth = 3
    context.lineCap = 'round'
    context.globalAlpha = 0.9

    for (const edge of edgeSegments) {
      drawBezierCurve(context, edge.source, edge.target, edge.stroke)
    }
  }, [edgeSegments, usesCanvasEdgeRenderer])

  function beginConnection(sourceNode: WorkflowNode, sourceHandle: string, sourceDataType: keyof typeof PORT_COLOR_MAP) {
    const canvasAnchor = getPortAnchor(
      sourceNode,
      displayedNodePositions[sourceNode.id] ?? sourceNode.position,
      workflow.viewport.zoom,
      'output',
      sourceHandle,
    )

    if (!canvasAnchor) {
      return
    }

    setConnectionDraft({
      sourceNodeId: sourceNode.id,
      sourceHandle,
      sourceDataType,
      pointer: canvasAnchor,
    })
    clearWorkflowConnectionFeedback()
    setConnectionFeedback({
      message: `Connecting ${sourceHandle}. Choose a compatible input.`,
      tone: 'success',
    })
  }

  function completeConnection(targetHandle: string, targetNodeId: string) {
    if (!connectionDraft) {
      return
    }

    const sourceNode = workflow.nodes.find((node) => node.id === connectionDraft.sourceNodeId)
    const targetNode = workflow.nodes.find((node) => node.id === targetNodeId)
    const result = connectWorkflowPorts(
      connectionDraft.sourceNodeId,
      connectionDraft.sourceHandle,
      targetNodeId,
      targetHandle,
    )

    setConnectionDraft(null)

    if (!result.ok) {
      const sourcePoint =
        sourceNode
          ? getPortAnchor(
              sourceNode,
              displayedNodePositions[sourceNode.id] ?? sourceNode.position,
              workflow.viewport.zoom,
              'output',
              connectionDraft.sourceHandle,
            )
          : null
      const targetPoint =
        targetNode
          ? getPortAnchor(
              targetNode,
              displayedNodePositions[targetNode.id] ?? targetNode.position,
              workflow.viewport.zoom,
              'input',
              targetHandle,
            )
          : connectionDraft.pointer

      if (sourcePoint && targetPoint) {
        setInvalidConnectionFlash({
          source: sourcePoint,
          target: targetPoint,
          color: PORT_COLOR_MAP[connectionDraft.sourceDataType],
        })
      }

      showWorkflowConnectionFeedback({
        targetNodeId,
        targetHandle,
        reason: result.reason,
        tone: 'error',
        visibleUntil: new Date(Date.now() + 2_200).toISOString(),
      })

      setConnectionFeedback({
        message: result.reason,
        tone: 'error',
      })
      return
    }

    clearWorkflowConnectionFeedback()
    setConnectionFeedback({
      message: 'Workflow edge connected.',
      tone: 'success',
    })
  }

  function handleCanvasMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (isPanning && panOriginRef.current) {
      const deltaX = panOriginRef.current.x - event.clientX
      const deltaY = panOriginRef.current.y - event.clientY
      panOriginRef.current = { x: event.clientX, y: event.clientY }
      panWorkflowViewport(deltaX / workflow.viewport.zoom, deltaY / workflow.viewport.zoom)
      return
    }

    if (dragState) {
      const canvasPoint = toCanvasPoint(event.clientX, event.clientY, canvasRef.current, workflow.viewport)
      const deltaX = canvasPoint.x - dragState.origin.x
      const deltaY = canvasPoint.y - dragState.origin.y

      setDragPreview(
        Object.fromEntries(
          dragState.nodeIds.map((nodeId) => {
            const initial = dragState.initialPositions[nodeId]
            return [
              nodeId,
              {
                x: Number(Math.max(0, initial.x + deltaX).toFixed(0)),
                y: Number(Math.max(0, initial.y + deltaY).toFixed(0)),
              },
            ]
          }),
        ),
      )
      return
    }

    if (marqueeSelection) {
      const canvasPoint = toCanvasPoint(event.clientX, event.clientY, canvasRef.current, workflow.viewport)
      setMarqueeSelection({
        ...marqueeSelection,
        current: canvasPoint,
      })
      return
    }

    if (connectionDraft) {
      const canvasPoint = toCanvasPoint(event.clientX, event.clientY, canvasRef.current, workflow.viewport)
      setConnectionDraft({
        ...connectionDraft,
        pointer: canvasPoint,
      })
    }
  }

  function handleCanvasMouseUp() {
    if (isPanning) {
      setIsPanning(false)
      panOriginRef.current = null
      return
    }

    if (!dragState) {
      if (marqueeSelection) {
        const selectedIds = getNodesInMarquee(
          workflow.nodes,
          displayedNodePositions,
          workflow.viewport.zoom,
          marqueeSelection,
        )
        const nextSelection = marqueeSelection.additive
          ? Array.from(new Set([...selectedNodeIds, ...selectedIds]))
          : selectedIds

        setWorkflowSelection(nextSelection)
        setMarqueeSelection(null)
      }
      return
    }

    const delta = getDragDelta(dragState, dragPreview)

    if (delta) {
      moveWorkflowNodes(dragState.nodeIds, delta.x, delta.y)
    }

    setDragState(null)
    setDragPreview({})
  }

  return (
    <section
      aria-label="Workflow editor"
      className="flex h-full flex-col gap-4 rounded-[2rem] border border-white/10 bg-[#101113]/85 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-white/8 bg-black/20 p-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[#7f8691]">Workflow Mode</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">Node graph foundation</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#98a1ad]">
            Node positions, edges, and compute mode are stored in the same project document as the timeline.
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-[#7f8691]">
            Hold Space to pan • Scroll to zoom • Drag nodes • Click output then input to connect
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={nudgeFirstNode}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            <Network size={16} />
            Nudge Node
          </button>
          <button
            type="button"
            onClick={openNodePicker}
            className="inline-flex items-center gap-2 rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black"
          >
            <Plus size={16} />
            Add Node
          </button>
          <button
            type="button"
            onClick={fitWorkflowViewport}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            <Move size={16} />
            Fit View
          </button>
          <button
            type="button"
            onClick={selectOutputNode}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            <ArrowRight size={16} />
            Select Output
          </button>
          <button
            type="button"
            onClick={connectSelectedNodeToOutput}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            <Link2 size={16} />
            Connect to Output
          </button>
          <button
            type="button"
            onClick={copySelectedNodes}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            <Copy size={16} />
            Copy
          </button>
          <button
            type="button"
            onClick={pasteWorkflowClipboard}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            <Copy size={16} />
            Paste
          </button>
          <button
            type="button"
            onClick={duplicateSelected}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            <Copy size={16} />
            Duplicate
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            className="inline-flex items-center gap-2 rounded-full border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm text-red-100"
          >
            <Trash2 size={16} />
            Delete
          </button>
          <button
            type="button"
            onClick={validateWorkflow}
            className="inline-flex items-center gap-2 rounded-full border border-[#e0ff00]/25 bg-[#e0ff00]/10 px-4 py-2 text-sm text-[#f5ffd5]"
          >
            <CheckCircle2 size={16} />
            Validate Graph
          </button>
        </div>
      </div>

      <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div
          ref={canvasRef}
          tabIndex={0}
          role="region"
          aria-label="Workflow canvas"
          aria-description="Pan with space plus drag, zoom with the mouse wheel, and use the node toolbar to add graph nodes."
          className={`relative overflow-hidden rounded-[1.5rem] border border-white/8 bg-[#0c0d0f] ${
            isHandToolActive ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : dragState ? 'cursor-grabbing' : 'cursor-default'
          }`}
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return
            }

            if (isHandToolActive) {
              event.preventDefault()
              panOriginRef.current = { x: event.clientX, y: event.clientY }
              setIsPanning(true)
              return
            }

            const target = event.target as HTMLElement
            if (target.closest('article') || target.closest('button')) {
              return
            }

            const canvasPoint = toCanvasPoint(event.clientX, event.clientY, canvasRef.current, workflow.viewport)
            setMarqueeSelection({
              origin: canvasPoint,
              current: canvasPoint,
              additive: event.ctrlKey || event.metaKey,
            })
          }}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={() => {
            setIsPanning(false)
            panOriginRef.current = null
          }}
          onWheel={(event) => {
            event.preventDefault()
            adjustWorkflowZoom(event.deltaY < 0 ? 0.08 : -0.08)
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) {
              return
            }

            if (connectionDraft) {
              setConnectionDraft(null)
              setConnectionFeedback({
                message: 'Connection preview cancelled.',
                tone: 'error',
              })
              return
            }

            if (marqueeSelection) {
              return
            }

            selectNode(null)
          }}
          onContextMenu={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault()
              setContextMenu({ type: 'canvas', x: event.clientX, y: event.clientY })
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') {
              return
            }

            event.preventDefault()

            if (connectionDraft) {
              setConnectionDraft(null)
              setConnectionFeedback({
                message: 'Connection preview cancelled.',
                tone: 'error',
              })
              return
            }

            selectNode(null)
          }}
        >
          <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
            {WORKFLOW_NODE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => addNodeOfType(type)}
                aria-label={`Add ${type.replace('_', ' ')} node`}
                className="rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[#d6dce5] backdrop-blur"
              >
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>
          {connectionFeedback ? (
            <div
              aria-live="polite"
              className={`absolute right-4 top-4 z-10 rounded-full border px-4 py-2 text-xs ${
                connectionFeedback.tone === 'error'
                  ? 'border-red-400/20 bg-red-500/15 text-red-100'
                  : 'border-[#e0ff00]/25 bg-[#e0ff00]/10 text-[#f5ffd5]'
              }`}
            >
              {connectionFeedback.message}
            </div>
          ) : null}
          {workflow.nodes.length === 0 ? (
            <EmptyWorkflowState onAddNode={openNodePicker} />
          ) : (
            <div className="relative h-full overflow-auto">
              <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:26px_26px] opacity-25" />
              <div
                className="relative h-[720px] min-w-[980px]"
                style={{
                  transform: `translate(${-workflow.viewport.x}px, ${-workflow.viewport.y}px) scale(${workflow.viewport.zoom})`,
                  transformOrigin: 'top left',
                }}
              >
                {usesCanvasEdgeRenderer ? (
                  <canvas
                    ref={denseEdgeCanvasRef}
                    width={980}
                    height={720}
                    className="pointer-events-none absolute inset-0 h-full w-full"
                  />
                ) : null}
                <svg className="pointer-events-none absolute inset-0 h-full w-full">
                  {!usesCanvasEdgeRenderer
                    ? edgeSegments.map((edge) => (
                        <path
                          key={edge.id}
                          d={buildBezierPath(edge.source, edge.target)}
                          fill="none"
                          stroke={edge.stroke}
                          strokeWidth="3"
                          strokeLinecap="round"
                          opacity="0.9"
                        />
                      ))
                    : null}
                  {connectionDraft ? (
                    (() => {
                      const sourceNode = workflow.nodes.find((node) => node.id === connectionDraft.sourceNodeId)

                      if (!sourceNode) {
                        return null
                      }

                      const sourcePoint = getPortAnchor(
                        sourceNode,
                        displayedNodePositions[sourceNode.id] ?? sourceNode.position,
                        workflow.viewport.zoom,
                        'output',
                        connectionDraft.sourceHandle,
                      )

                      if (!sourcePoint) {
                        return null
                      }

                      return (
                        <path
                          d={buildBezierPath(sourcePoint, connectionDraft.pointer)}
                          fill="none"
                          stroke={PORT_COLOR_MAP[connectionDraft.sourceDataType]}
                          strokeDasharray="10 8"
                          strokeWidth="3"
                          strokeLinecap="round"
                          opacity="0.8"
                        />
                      )
                    })()
                  ) : null}
                  {invalidConnectionFlash ? (
                    <path
                      d={buildBezierPath(invalidConnectionFlash.source, invalidConnectionFlash.target)}
                      fill="none"
                      stroke={invalidConnectionFlash.color}
                      strokeDasharray="10 8"
                      strokeWidth="4"
                      strokeLinecap="round"
                      opacity="0.95"
                      className="fluxnode-invalid-edge"
                    />
                  ) : null}
                </svg>
                {marqueeSelection ? (
                  <div
                    className="pointer-events-none absolute border border-[#e0ff00]/70 bg-[#e0ff00]/10"
                    style={getMarqueeStyle(marqueeSelection)}
                  />
                ) : null}
                {workflowGroupFrames.map((group) => {
                  const groupSelected = group.nodeIds.every((nodeId) => selectedNodeIds.includes(nodeId))

                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setWorkflowSelection(group.nodeIds)
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setWorkflowSelection(group.nodeIds)
                        setContextMenu({ type: 'node', x: event.clientX, y: event.clientY })
                      }}
                      className={`absolute rounded-[1.5rem] border border-dashed bg-transparent text-left transition ${
                        groupSelected ? 'shadow-[0_0_0_1px_rgba(224,255,0,0.18)]' : ''
                      }`}
                      style={{
                        left: group.left,
                        top: group.top,
                        width: group.width,
                        height: group.height,
                        borderColor: `${group.color}${groupSelected ? 'dd' : '88'}`,
                        boxShadow: groupSelected ? `0 0 0 1px ${group.color}40` : 'none',
                      }}
                    >
                      <span
                        className="absolute left-4 top-3 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em]"
                        style={{
                          backgroundColor: `${group.color}22`,
                          color: group.color,
                          border: `1px solid ${group.color}44`,
                        }}
                      >
                        {group.label}
                      </span>
                    </button>
                  )
                })}

                {workflow.nodes.map((node) => {
                  const position = displayedNodePositions[node.id] ?? node.position
                  const metrics = getNodeMetrics(node, workflow.viewport.zoom)
                  const compact = metrics.compact

                  return (
                    <article
                      key={node.id}
                      onClick={(event) => {
                        if (dragState) {
                          return
                        }
                        selectNode(node.id, event.ctrlKey || event.metaKey)
                      }}
                      onKeyDown={(event) => {
                        activateWithKeyboard(event, () => selectNode(node.id, event.ctrlKey || event.metaKey))
                      }}
                      onMouseDown={(event) => {
                        if (isHandToolActive || event.button !== 0) {
                          return
                        }

                        if ((event.target as HTMLElement).closest('button')) {
                          return
                        }

                        const nextNodeIds =
                          selectedNodeIds.includes(node.id) && selectedNodeIds.length > 0
                            ? selectedNodeIds
                            : [node.id]

                        if (!selectedNodeIds.includes(node.id)) {
                          selectNode(node.id, false)
                        }

                        const canvasPoint = toCanvasPoint(
                          event.clientX,
                          event.clientY,
                          canvasRef.current,
                          workflow.viewport,
                        )
                        const initialPositions = Object.fromEntries(
                          nextNodeIds.map((nodeId) => [
                            nodeId,
                            displayedNodePositions[nodeId] ??
                              workflow.nodes.find((item) => item.id === nodeId)?.position ?? {
                                x: 0,
                                y: 0,
                              },
                          ]),
                        )

                        setDragState({
                          nodeIds: nextNodeIds,
                          origin: canvasPoint,
                          initialPositions,
                        })
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        selectNode(node.id, event.ctrlKey || event.metaKey)
                        setContextMenu({ type: 'node', x: event.clientX, y: event.clientY })
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Workflow node ${node.label ?? node.id}, type ${node.type.replace('_', ' ')}`}
                      className={`absolute cursor-pointer rounded-[1.4rem] border bg-[#17181b]/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl transition ${
                        selectedNodeIds.includes(node.id)
                          ? node.executionError
                            ? 'border-red-400/70 shadow-[0_0_0_1px_rgba(248,113,113,0.2),0_20px_60px_rgba(0,0,0,0.45)]'
                            : 'border-[#e0ff00]/70 shadow-[0_0_0_1px_rgba(224,255,0,0.2),0_20px_60px_rgba(0,0,0,0.45)]'
                          : node.executionError
                            ? 'border-red-400/40'
                            : 'border-white/10'
                      }`}
                      style={{
                        left: position.x,
                        top: position.y,
                        width: metrics.width,
                        minHeight: metrics.height,
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.25em] text-[#7f8691]">{node.type.replace('_', ' ')}</p>
                          <h3 className="mt-2 text-lg font-semibold text-white">{node.label ?? node.id}</h3>
                          {compact ? (
                            <p className="mt-2 text-xs text-[#96a0ac]">
                              {NODE_PORT_DEFINITIONS[node.type].inputs.length} input(s) / {NODE_PORT_DEFINITIONS[node.type].outputs.length} output(s)
                            </p>
                          ) : null}
                          {isAiNode(node) ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[#cbd2dc]">
                                Compute {getEffectiveNodeComputeSource(node, workflow.computeMode)}
                              </span>
                              {node.executionError ? (
                                <span className="rounded-full border border-red-300/20 bg-red-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-red-100">
                                  Comfy Failed
                                </span>
                              ) : null}
                              {nodeRequiresInternet(node, workflow.computeMode) && networkStatus === 'offline' ? (
                                <span className="rounded-full border border-amber-300/20 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-50">
                                  Requires internet
                                </span>
                              ) : null}
                              {node.bypassed ? (
                                <span className="rounded-full border border-red-300/20 bg-red-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-red-100">
                                  Bypassed
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                          {!isAiNode(node) && node.bypassed ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <span className="rounded-full border border-red-300/20 bg-red-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-red-100">
                                Bypassed
                              </span>
                            </div>
                          ) : null}
                          {!isAiNode(node) && node.executionError ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <span className="rounded-full border border-red-300/20 bg-red-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-red-100">
                                Comfy Failed
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[#cbd2dc]">
                          {selectedNodeIds.includes(node.id) ? 'selected' : node.id}
                        </div>
                      </div>

                      {compact ? (
                        <div className="mt-4 rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2 text-xs text-[#9ca3af]">
                          Zoomed-out LOD view. Zoom in for per-port details.
                        </div>
                      ) : (
                        <div className="mt-4 grid gap-3 text-sm">
                          <PortGroup
                            workflow={workflow}
                            node={node}
                            side="input"
                            ports={NODE_PORT_DEFINITIONS[node.type].inputs}
                            connectionDraft={connectionDraft}
                            workflowConnectionFeedback={workflowConnectionFeedback}
                            onCompleteConnection={completeConnection}
                          />
                          <PortGroup
                            workflow={workflow}
                            node={node}
                            side="output"
                            ports={NODE_PORT_DEFINITIONS[node.type].outputs}
                            connectionDraft={connectionDraft}
                            workflowConnectionFeedback={workflowConnectionFeedback}
                            onBeginConnection={(portName, dataType) => beginConnection(node, portName, dataType)}
                          />
                        </div>
                      )}

                      {!compact && selectedNodeIds[0] === node.id && selectedNodePreviewFrame ? (
                        <div className="mt-4 overflow-hidden rounded-[1rem] border border-white/10 bg-black/40">
                          <img
                            src={selectedNodePreviewFrame.dataUrl}
                            alt={`Rendered preview of ${node.label ?? node.id}`}
                            className="block h-auto w-full object-cover"
                            draggable={false}
                          />
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <aside aria-label="Workflow status and actions" className="rounded-[1.5rem] border border-white/8 bg-[#17181b] p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-[#7f8691]">Workflow Status</p>
          <div className="mt-4 grid gap-3">
            <StatusCard
              icon={workflow.computeMode === 'local' ? Cpu : Cloud}
              label="Compute"
              value={workflow.computeMode === 'local' ? 'Local ComfyUI ready state' : 'Cloud pipeline selected'}
            />
            <StatusCard label="Nodes" value={`${workflow.nodes.length} configured`} />
            <StatusCard label="Edges" value={`${workflow.edges.length} active connections`} />
            <StatusCard
              label="Audio Route"
              value={
                outputAudioSource
                  ? `${outputAudioSource.label ?? outputAudioSource.id} -> output (${audioMixInputCount} input${audioMixInputCount === 1 ? '' : 's'})`
                  : 'No audio connected to output'
              }
            />
            <StatusCard
              label="Audio Sources"
              value={`${connectedAudioClipCount} linked audio clip(s) / ${audioMixInputCount} workflow input(s)`}
            />
            <StatusCard
              label="Edge Renderer"
              value={usesCanvasEdgeRenderer ? `Canvas fallback (${edgeSegments.length} edges)` : `SVG (${edgeSegments.length} edges)`}
            />
            <StatusCard
              label="Benchmark"
              value={
                workflowBenchmarkMetric.sceneLabel
                  ? `${workflowBenchmarkMetric.nodeCount} nodes / ${workflowBenchmarkMetric.edgeCount} edges`
                  : 'No benchmark scene loaded'
              }
            />
            <StatusCard label="Selection" value={`${selectedNodeIds.length} node(s) selected`} />
            <StatusCard label="Viewport" value={`${workflow.viewport.zoom.toFixed(1)}x @ ${workflow.viewport.x}, ${workflow.viewport.y}`} />
            <StatusCard
              label="Execution Order"
              value={workflowExecutionOrder.length > 0 ? workflowExecutionOrder.join(' -> ') : 'No valid order yet'}
            />
          </div>

          <div className="mt-5 rounded-[1.25rem] border border-white/8 bg-black/20 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Validation</p>
            <div aria-live="polite" className="mt-3 space-y-3">
              {combinedIssues.length === 0 ? (
                <p className="text-sm text-[#d7f9a7]">No current validation issues.</p>
              ) : (
                combinedIssues.map((issue, index) => (
                  <div
                    key={`${issue.message}-${index}`}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      issue.level === 'error'
                        ? 'border-red-400/20 bg-red-500/10 text-red-100'
                        : 'border-amber-300/20 bg-amber-500/10 text-amber-50'
                    }`}
                  >
                    {issue.message}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="mt-5 rounded-[1.25rem] border border-white/8 bg-black/20 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Node Actions</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionPill label="Select All" onClick={selectAllWorkflowNodes} />
              <ActionPill label="Copy" onClick={copySelectedNodes} />
              <ActionPill label="Paste" onClick={pasteWorkflowClipboard} />
              <ActionPill label="Group" onClick={groupSelectedWorkflowNodes} />
              <ActionPill label="Load 120-Node Benchmark" onClick={createLargeCanvasBenchmarkScene} />
              <ActionPill label="Measure Fit View" onClick={measureBenchmarkFitView} />
              <ActionPill label="Measure Pan + Zoom" onClick={() => void measureBenchmarkPanAndZoom()} />
              <ActionPill label="Connect to Output" onClick={connectSelectedNodeToOutput} />
              <ActionPill label="Disconnect Edges" onClick={disconnectSelectedNodeEdges} />
              <ActionPill label="Create Timeline Clip" onClick={createTimelineClipFromSelectedNode} />
              <ActionPill label="Show in Timeline" onClick={showSelectedNodeInTimeline} />
              <ActionPill label="Duplicate" onClick={duplicateSelected} />
              <ActionPill label="Delete" onClick={deleteSelected} tone="danger" />
            </div>
            <p className="mt-3 text-xs leading-5 text-[#8f97a2]">
              Clipboard {workflowClipboard.nodes.length} node{workflowClipboard.nodes.length === 1 ? '' : 's'} / {workflowClipboard.edges.length} edge{workflowClipboard.edges.length === 1 ? '' : 's'}
            </p>
            {workflowBenchmarkMetric.sceneLabel ? (
              <p className="mt-3 text-xs leading-5 text-[#8f97a2]">
                {workflowBenchmarkMetric.sceneLabel}
                {workflowBenchmarkMetric.generationMs !== null ? ` generated in ${workflowBenchmarkMetric.generationMs.toFixed(1)} ms` : ''}
                {workflowBenchmarkMetric.canvasRendererExpected ? ' and should force Canvas edge rendering.' : ''}
                {workflowBenchmarkMetric.fitViewDurationMs !== null ? ` Fit-to-view measured at ${workflowBenchmarkMetric.fitViewDurationMs.toFixed(1)} ms.` : ''}
                {workflowBenchmarkMetric.panTraversalDurationMs !== null ? ` Pan traversal measured at ${workflowBenchmarkMetric.panTraversalDurationMs.toFixed(1)} ms.` : ''}
                {workflowBenchmarkMetric.zoomSweepDurationMs !== null ? ` Zoom sweep measured at ${workflowBenchmarkMetric.zoomSweepDurationMs.toFixed(1)} ms.` : ''}
              </p>
            ) : null}
          </div>
        </aside>
      </div>
      {contextMenu ? (
        <div
          role="menu"
          aria-label={contextMenu.type === 'node' ? 'Workflow node actions' : 'Workflow canvas actions'}
          className="fixed z-30 min-w-56 rounded-[1rem] border border-white/10 bg-[#101113]/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.type === 'node' ? (
            <div className="space-y-1">
              <ContextAction label="Duplicate Node" onClick={runContextAction(duplicateSelected)} />
              <ContextAction label="Delete Node" onClick={runContextAction(deleteSelected)} tone="danger" />
              <ContextDivider />
              <ContextAction
                label={selectedNode?.bypassed ? 'Enable Node' : 'Bypass Node'}
                onClick={runContextAction(toggleSelectedNodeBypass)}
                disabled={!selectedNode || selectedNode.type === 'output' || selectedNode.type === 'media_source'}
              />
              <ContextAction
                label={selectedNode?.executionError ? 'Clear Comfy Failure' : 'Simulate Comfy Failure'}
                onClick={runContextAction(
                  selectedNode?.executionError ? clearSelectedNodeExecutionFailure : simulateSelectedNodeExecutionFailure,
                )}
                disabled={!selectedNode}
              />
              <ContextAction
                label="Preview Output"
                onClick={runContextAction(() => void loadPreviewFrameForSelectedNode())}
                disabled={!selectedNode}
              />
              <ContextAction label="Connect to Output" onClick={runContextAction(connectSelectedNodeToOutput)} />
              <ContextAction label="Disconnect Edges" onClick={runContextAction(disconnectSelectedNodeEdges)} />
              {isAiNode(selectedNode) ? (
                <>
                  <ContextDivider />
                  <ContextAction
                    label="Compute: Project"
                    onClick={runContextAction(() => setSelectedNodeComputeSource('project'))}
                  />
                  <ContextAction
                    label="Compute: Local"
                    onClick={runContextAction(() => setSelectedNodeComputeSource('local'))}
                  />
                  <ContextAction
                    label={networkStatus === 'offline' ? 'Compute: Cloud (offline)' : 'Compute: Cloud'}
                    onClick={runContextAction(() => setSelectedNodeComputeSource('cloud'))}
                    disabled={networkStatus === 'offline'}
                  />
                </>
              ) : null}
              <ContextDivider />
              <ContextAction
                label="Create Timeline Clip"
                onClick={runContextAction(createTimelineClipFromSelectedNode)}
                disabled={!selectedNode || selectedNode.type !== 'media_source'}
              />
              <ContextAction label="Show in Timeline" onClick={runContextAction(showSelectedNodeInTimeline)} />
              <ContextAction label="Copy Nodes" onClick={runContextAction(copySelectedNodes)} />
              <ContextAction label="Group Selected Nodes" onClick={runContextAction(groupSelectedWorkflowNodes)} />
              <ContextAction label="Properties" onClick={runContextAction(() => void openDetachedPanel('inspector'))} />
            </div>
          ) : (
            <div className="space-y-1">
              {WORKFLOW_NODE_TYPES.map((type) => (
                <ContextAction
                  key={type}
                  label={`Add ${type.replace('_', ' ')}`}
                  onClick={runContextAction(() => addNodeOfType(type))}
                />
              ))}
              <ContextAction label="Paste Nodes" onClick={runContextAction(pasteWorkflowClipboard)} />
              <ContextDivider />
              <ContextAction label="Select All Nodes" onClick={runContextAction(selectAllWorkflowNodes)} />
              <ContextAction label="Fit to View" onClick={runContextAction(fitWorkflowViewport)} />
              <ContextAction label="Validate Graph" onClick={runContextAction(validateWorkflow)} />
            </div>
          )}
        </div>
      ) : null}
      {showNodePicker ? (
        <WorkflowNodePicker
          nodeSearch={nodeSearch}
          onSearchChange={setNodeSearch}
          filteredNodeTypes={filteredNodeTypes}
          onAddNode={addNodeOfType}
          onClose={closeNodePicker}
        />
      ) : null}
    </section>
  )
}

function WorkflowNodePicker({
  nodeSearch,
  onSearchChange,
  filteredNodeTypes,
  onAddNode,
  onClose,
}: {
  nodeSearch: string
  onSearchChange: (value: string) => void
  filteredNodeTypes: NodeType[]
  onAddNode: (type: NodeType) => void
  onClose: () => void
}) {
  const dialogRef = useModalA11y<HTMLElement>()

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-node-picker-title"
        tabIndex={-1}
        className="w-full max-w-3xl rounded-[1.75rem] border border-white/10 bg-[#111214] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.55)] outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#7f8691]">Node Picker</p>
            <h3 id="workflow-node-picker-title" className="mt-2 text-2xl font-semibold text-white">Search and add a workflow node</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close node picker"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
          >
            <X size={16} />
          </button>
        </div>
        <label className="mt-4 flex items-center gap-3 rounded-[1.2rem] border border-white/10 bg-black/20 px-4 py-3">
          <Search size={16} className="text-[#7f8691]" />
          <input
            value={nodeSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search nodes like shader, output, ai..."
            aria-label="Search workflow node types"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-[#7f8691]"
            autoFocus
          />
        </label>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredNodeTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onAddNode(type)}
              aria-label={`Add ${type.replace('_', ' ')} node`}
              className="rounded-[1.2rem] border border-white/10 bg-black/20 p-4 text-left transition hover:border-[#e0ff00]/35 hover:bg-white/[0.04]"
            >
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Node Type</p>
              <p className="mt-2 text-base font-semibold text-white">{type.replace('_', ' ')}</p>
              <p className="mt-2 text-sm leading-6 text-[#9ca3af]">
                Inputs {NODE_PORT_DEFINITIONS[type].inputs.length} / Outputs {NODE_PORT_DEFINITIONS[type].outputs.length}
              </p>
            </button>
          ))}
        </div>
        {filteredNodeTypes.length === 0 ? (
          <p className="mt-4 text-sm text-[#9ca3af]">No node types matched this search.</p>
        ) : null}
      </section>
    </div>
  )
}

function EmptyWorkflowState({ onAddNode }: { onAddNode: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-[1.25rem] border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
      <ArrowRight size={28} className="text-[#e0ff00]" />
      <h3 className="mt-4 text-xl font-semibold text-white">Press N to add a node</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[#8f97a2]">
        Build an AI/VFX graph by adding nodes and wiring their typed ports together. Every edit is undoable.
      </p>
      <button
        type="button"
        onClick={onAddNode}
        className="mt-5 rounded-full bg-[#e0ff00] px-5 py-3 text-sm font-semibold text-black"
      >
        Add Shader Node
      </button>
    </div>
  )
}

function PortGroup({
  workflow,
  node,
  side,
  ports,
  connectionDraft,
  workflowConnectionFeedback,
  onBeginConnection,
  onCompleteConnection,
}: {
  workflow: WorkflowState
  node: WorkflowNode
  side: 'input' | 'output'
  ports: Array<{ name: string; dataType: keyof typeof PORT_COLOR_MAP; required: boolean; multiple: boolean }>
  connectionDraft: ConnectionDraft | null
  workflowConnectionFeedback: {
    targetNodeId: string | null
    targetHandle: string | null
    reason: string | null
    tone: 'warning' | 'error' | null
    visibleUntil: string | null
    shakeKey: number
  }
  onBeginConnection?: (portName: string, dataType: keyof typeof PORT_COLOR_MAP) => void
  onCompleteConnection?: (targetHandle: string, targetNodeId: string) => void
}) {
  return (
    <div className="rounded-[1rem] border border-white/8 bg-black/20 p-3">
      <p className="text-[11px] uppercase tracking-[0.25em] text-[#7f8691]">{side === 'input' ? 'Inputs' : 'Outputs'}</p>
      <div className="mt-3 space-y-2">
        {ports.length === 0 ? (
          <p className="text-xs text-[#8f97a2]">No ports</p>
        ) : (
          ports.map((port) => {
            const candidateState =
              side === 'input'
                ? getInputCandidateState(workflow, node.id, port.name, connectionDraft)
                : getOutputCandidateState(node.id, port.name, connectionDraft)
            const showInvalidFeedback =
              side === 'input' &&
              workflowConnectionFeedback.targetNodeId === node.id &&
              workflowConnectionFeedback.targetHandle === port.name &&
              workflowConnectionFeedback.reason
            const shakeClass = showInvalidFeedback ? 'fluxnode-invalid-port' : ''

            return (
              <div key={`${port.name}-${workflowConnectionFeedback.shakeKey}`} className="relative">
                <button
                  type="button"
                  aria-label={`${side === 'output' ? 'Output' : 'Input'} port ${port.name}, ${port.dataType}${port.required ? ', required' : ''}${side === 'output' ? '. Start a connection from this port.' : connectionDraft ? '. Complete the pending connection on this port.' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation()

                    if (side === 'output') {
                      onBeginConnection?.(port.name, port.dataType)
                      return
                    }

                    if (!connectionDraft) {
                      return
                    }

                    onCompleteConnection?.(port.name, node.id)
                  }}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${getPortClasses(candidateState)} ${shakeClass}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PORT_COLOR_MAP[port.dataType] }} />
                    <span>{port.name}</span>
                    {port.required ? <span className="text-[10px] uppercase tracking-[0.2em] text-[#98a1ad]">req</span> : null}
                  </div>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[#9ca3af]">{port.dataType}</span>
                </button>
                {showInvalidFeedback ? (
                  <div className="pointer-events-none absolute left-0 top-full z-10 mt-2 max-w-64 rounded-xl border border-red-400/20 bg-[#2a1014]/95 px-3 py-2 text-xs leading-5 text-red-100 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                    {workflowConnectionFeedback.reason}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function StatusCard({
  icon: Icon,
  label,
  value,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-black/20 p-4">
      <div className="flex items-center gap-3">
        {Icon ? <Icon size={18} className="text-[#e0ff00]" /> : null}
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">{label}</p>
      </div>
      <p className="mt-3 text-sm font-medium text-white">{value}</p>
    </div>
  )
}

function ActionPill({
  label,
  onClick,
  tone = 'default',
}: {
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-2 text-xs ${
        tone === 'danger'
          ? 'border-red-400/20 bg-red-500/10 text-red-100'
          : 'border-white/10 bg-white/5 text-white'
      }`}
    >
      {label}
    </button>
  )
}

function ContextAction({
  label,
  onClick,
  tone = 'default',
  disabled = false,
}: {
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`block w-full rounded-xl px-3 py-2 text-left text-sm ${
        tone === 'danger'
          ? 'bg-red-500/10 text-red-100 hover:bg-red-500/15'
          : 'text-white hover:bg-white/5'
      } ${disabled ? 'cursor-not-allowed opacity-45 hover:bg-transparent' : ''}`}
    >
      {label}
    </button>
  )
}

function ContextDivider() {
  return <div role="separator" className="my-1 border-t border-white/8" />
}

function toCanvasPoint(
  clientX: number,
  clientY: number,
  canvasElement: HTMLDivElement | null,
  viewport: WorkflowState['viewport'],
): CanvasPoint {
  if (!canvasElement) {
    return { x: 0, y: 0 }
  }

  const bounds = canvasElement.getBoundingClientRect()
  return {
    x: Number((viewport.x + (clientX - bounds.left) / viewport.zoom).toFixed(2)),
    y: Number((viewport.y + (clientY - bounds.top) / viewport.zoom).toFixed(2)),
  }
}

function getDragDelta(
  dragState: DragState,
  dragPreview: Record<string, CanvasPoint>,
): CanvasPoint | null {
  const firstNodeId = dragState.nodeIds[0]
  const initial = dragState.initialPositions[firstNodeId]
  const preview = dragPreview[firstNodeId]

  if (!initial || !preview) {
    return null
  }

  const deltaX = Number((preview.x - initial.x).toFixed(0))
  const deltaY = Number((preview.y - initial.y).toFixed(0))

  if (deltaX === 0 && deltaY === 0) {
    return null
  }

  return { x: deltaX, y: deltaY }
}

function getNodeMetrics(node: WorkflowNode, zoom: number) {
  const compact = zoom < 0.72 || node.collapsed
  const width = compact ? 220 : 288
  const rowHeight = compact ? 28 : 36
  const inputCount = Math.max(1, NODE_PORT_DEFINITIONS[node.type].inputs.length)
  const outputCount = Math.max(1, NODE_PORT_DEFINITIONS[node.type].outputs.length)
  const inputStart = compact ? 98 : 126
  const outputStart = compact ? 132 : inputStart + inputCount * rowHeight + 46
  const height = compact ? 148 : outputStart + outputCount * rowHeight + 24

  return {
    compact,
    width,
    height,
    rowHeight,
    inputStart,
    outputStart,
  }
}

function isAiNode(node: WorkflowNode | null): node is WorkflowNode & { data: { computeSource: 'local' | 'cloud' | 'project' } } {
  return !!node && (node.type === 'ai_generate' || node.type === 'ai_upscale') && 'computeSource' in node.data
}

function getEffectiveNodeComputeSource(node: WorkflowNode, workflowComputeMode: WorkflowState['computeMode']) {
  if (!isAiNode(node)) {
    return workflowComputeMode
  }

  return node.data.computeSource === 'project' ? workflowComputeMode : node.data.computeSource
}

function nodeRequiresInternet(node: WorkflowNode | null, workflowComputeMode: WorkflowState['computeMode']) {
  if (!isAiNode(node)) {
    return false
  }

  return getEffectiveNodeComputeSource(node, workflowComputeMode) === 'cloud'
}

function getPortAnchor(
  node: WorkflowNode,
  position: CanvasPoint,
  zoom: number,
  side: 'input' | 'output',
  portName: string,
): CanvasPoint | null {
  const metrics = getNodeMetrics(node, zoom)
  const ports =
    side === 'input'
      ? NODE_PORT_DEFINITIONS[node.type].inputs
      : NODE_PORT_DEFINITIONS[node.type].outputs
  const portIndex = ports.findIndex((port) => port.name === portName)

  if (portIndex === -1) {
    return null
  }

  const y =
    position.y +
    (side === 'input' ? metrics.inputStart : metrics.outputStart) +
    portIndex * metrics.rowHeight +
    metrics.rowHeight / 2

  return {
    x: side === 'input' ? position.x : position.x + metrics.width,
    y,
  }
}

function buildBezierPath(source: CanvasPoint, target: CanvasPoint) {
  const deltaX = Math.max(80, Math.abs(target.x - source.x) * 0.45)
  return `M ${source.x} ${source.y} C ${source.x + deltaX} ${source.y}, ${target.x - deltaX} ${target.y}, ${target.x} ${target.y}`
}

function drawBezierCurve(
  context: CanvasRenderingContext2D,
  source: CanvasPoint,
  target: CanvasPoint,
  stroke: string,
) {
  const deltaX = Math.max(80, Math.abs(target.x - source.x) * 0.45)
  context.beginPath()
  context.moveTo(source.x, source.y)
  context.bezierCurveTo(
    source.x + deltaX,
    source.y,
    target.x - deltaX,
    target.y,
    target.x,
    target.y,
  )
  context.strokeStyle = stroke
  context.stroke()
}

function getInputCandidateState(
  workflow: WorkflowState,
  targetNodeId: string,
  targetHandle: string,
  connectionDraft: ConnectionDraft | null,
): PortCandidateState {
  if (!connectionDraft) {
    return 'idle'
  }

  const attempt = validateConnectionAttempt(workflow, {
    sourceNodeId: connectionDraft.sourceNodeId,
    sourceHandle: connectionDraft.sourceHandle,
    targetNodeId,
    targetHandle,
  })

  return attempt.ok ? 'compatible' : 'incompatible'
}

function getOutputCandidateState(
  nodeId: string,
  handle: string,
  connectionDraft: ConnectionDraft | null,
): PortCandidateState {
  if (!connectionDraft) {
    return 'idle'
  }

  if (connectionDraft.sourceNodeId === nodeId && connectionDraft.sourceHandle === handle) {
    return 'active'
  }

  return 'incompatible'
}

function getPortClasses(candidateState: PortCandidateState) {
  switch (candidateState) {
    case 'compatible':
      return 'border-[#e0ff00]/45 bg-[#e0ff00]/10 text-white'
    case 'incompatible':
      return 'border-white/5 bg-white/[0.02] text-[#7f8691] opacity-60'
    case 'active':
      return 'border-[#e0ff00]/60 bg-[#e0ff00]/14 text-white'
    default:
      return 'border-white/5 bg-white/[0.03] text-white'
  }
}

function getMarqueeStyle(selection: MarqueeSelection) {
  const left = Math.min(selection.origin.x, selection.current.x)
  const top = Math.min(selection.origin.y, selection.current.y)
  const width = Math.abs(selection.current.x - selection.origin.x)
  const height = Math.abs(selection.current.y - selection.origin.y)

  return {
    left,
    top,
    width,
    height,
  }
}

function getNodesInMarquee(
  nodes: WorkflowNode[],
  displayedNodePositions: Record<string, CanvasPoint>,
  zoom: number,
  selection: MarqueeSelection,
) {
  const selectionBounds = {
    left: Math.min(selection.origin.x, selection.current.x),
    right: Math.max(selection.origin.x, selection.current.x),
    top: Math.min(selection.origin.y, selection.current.y),
    bottom: Math.max(selection.origin.y, selection.current.y),
  }

  return nodes
    .filter((node) => {
      const position = displayedNodePositions[node.id] ?? node.position
      const metrics = getNodeMetrics(node, zoom)
      const nodeBounds = {
        left: position.x,
        right: position.x + metrics.width,
        top: position.y,
        bottom: position.y + metrics.height,
      }

      return !(
        nodeBounds.right < selectionBounds.left ||
        nodeBounds.left > selectionBounds.right ||
        nodeBounds.bottom < selectionBounds.top ||
        nodeBounds.top > selectionBounds.bottom
      )
    })
    .map((node) => node.id)
}
