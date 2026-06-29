import { NODE_PORT_DEFINITIONS } from './node-definitions'
import type { PortDefinition, WorkflowEdge, WorkflowNode, WorkflowState } from '../project/types'

export interface WorkflowValidationIssue {
  level: 'error' | 'warning'
  nodeId?: string
  edgeId?: string
  message: string
}

export interface WorkflowValidationReport {
  issues: WorkflowValidationIssue[]
  topologicalOrder: string[]
}

export interface ConnectionAttempt {
  sourceNodeId: string
  sourceHandle: string
  targetNodeId: string
  targetHandle: string
}

export function validateWorkflowGraph(workflow: WorkflowState): WorkflowValidationReport {
  const issues: WorkflowValidationIssue[] = []
  const outputNodes = workflow.nodes.filter((node) => node.type === 'output')

  if (outputNodes.length === 0) {
    issues.push({
      level: 'error',
      message: 'Workflow graph needs at least one output node.',
    })
  }

  for (const edge of workflow.edges) {
    const sourceNode = workflow.nodes.find((node) => node.id === edge.source)
    const targetNode = workflow.nodes.find((node) => node.id === edge.target)

    if (!sourceNode || !targetNode) {
      issues.push({
        level: 'error',
        edgeId: edge.id,
        message: `Edge ${edge.id} points to a missing node.`,
      })
    }
  }

  for (const node of workflow.nodes) {
    if (node.bypassed) {
      issues.push({
        level: 'warning',
        nodeId: node.id,
        message: `${node.label ?? node.id} is bypassed and will be skipped by workflow execution.`,
      })
      continue
    }

    if (node.executionError) {
      issues.push({
        level: 'error',
        nodeId: node.id,
        message: `${node.label ?? node.id} failed during ComfyUI execution.`,
      })
    }

    const definition = NODE_PORT_DEFINITIONS[node.type]

    for (const input of definition.inputs.filter((port) => port.required)) {
      const hasConnection = workflow.edges.some(
        (edge) => edge.target === node.id && edge.targetHandle === input.name,
      )

      if (!hasConnection) {
        issues.push({
          level: 'warning',
          nodeId: node.id,
          message: `${node.label ?? node.id} is missing required input "${input.name}".`,
        })
      }
    }
  }

  const topologicalOrder = getTopologicalOrder(workflow.nodes, workflow.edges)

  if (topologicalOrder.length !== workflow.nodes.length) {
    issues.push({
      level: 'error',
      message: 'Workflow graph contains a cycle and cannot produce a valid execution order.',
    })
  }

  const outputIds = outputNodes.map((node) => node.id)
  const reachableToOutput = getReachableToOutputs(outputIds, workflow.edges)

  for (const node of workflow.nodes) {
    if (node.type !== 'output' && !reachableToOutput.has(node.id)) {
      issues.push({
        level: 'warning',
        nodeId: node.id,
        message: `${node.label ?? node.id} is orphaned from any output path.`,
      })
    }
  }

  return {
    issues,
    topologicalOrder,
  }
}

export function validateConnectionAttempt(
  workflow: WorkflowState,
  attempt: ConnectionAttempt,
): { ok: true } | { ok: false; reason: string } {
  const sourceNode = workflow.nodes.find((node) => node.id === attempt.sourceNodeId)
  const targetNode = workflow.nodes.find((node) => node.id === attempt.targetNodeId)

  if (!sourceNode || !targetNode) {
    return { ok: false, reason: 'Both nodes must exist before connecting them.' }
  }

  if (sourceNode.bypassed || targetNode.bypassed) {
    return { ok: false, reason: 'Reconnect or re-enable bypassed nodes before creating new connections.' }
  }

  const sourcePort = NODE_PORT_DEFINITIONS[sourceNode.type].outputs.find(
    (port) => port.name === attempt.sourceHandle,
  )
  const targetPort = NODE_PORT_DEFINITIONS[targetNode.type].inputs.find(
    (port) => port.name === attempt.targetHandle,
  )

  if (!sourcePort || !targetPort) {
    return { ok: false, reason: 'The selected ports are not valid for these node types.' }
  }

  if (!arePortsCompatible(sourcePort, targetPort)) {
    return {
      ok: false,
      reason: `Cannot connect ${sourcePort.dataType} to ${targetPort.dataType}.`,
    }
  }

  if (attempt.sourceNodeId === attempt.targetNodeId) {
    return { ok: false, reason: 'A node cannot connect to itself.' }
  }

  const simulatedEdges = replaceTargetConnectionIfNeeded(workflow.edges, targetNode.id, targetPort, {
    id: 'validation-edge',
    source: sourceNode.id,
    sourceHandle: attempt.sourceHandle,
    target: targetNode.id,
    targetHandle: attempt.targetHandle,
  })

  if (wouldCreateCycle(workflow.nodes, simulatedEdges)) {
    return { ok: false, reason: 'This connection would create a cycle.' }
  }

  return { ok: true }
}

export function replaceTargetConnectionIfNeeded(
  edges: WorkflowEdge[],
  targetNodeId: string,
  targetPort: PortDefinition,
  nextEdge: WorkflowEdge,
) {
  const filtered = targetPort.multiple
    ? edges
    : edges.filter(
        (edge) => !(edge.target === targetNodeId && edge.targetHandle === targetPort.name),
      )

  return [...filtered, nextEdge]
}

function arePortsCompatible(source: PortDefinition, target: PortDefinition) {
  return (
    source.dataType === target.dataType ||
    source.dataType === 'any' ||
    target.dataType === 'any'
  )
}

function wouldCreateCycle(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  return getTopologicalOrder(nodes, edges).length !== nodes.length
}

function getTopologicalOrder(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]))

  for (const edge of edges) {
    if (!indegree.has(edge.target) || !outgoing.has(edge.source)) {
      continue
    }

    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)?.push(edge.target)
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId)

  const result: string[] = []

  while (queue.length > 0) {
    const current = queue.shift()

    if (!current) {
      break
    }

    result.push(current)

    for (const next of outgoing.get(current) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1
      indegree.set(next, nextDegree)
      if (nextDegree === 0) {
        queue.push(next)
      }
    }
  }

  return result
}

function getReachableToOutputs(outputIds: string[], edges: WorkflowEdge[]) {
  const reverse = new Map<string, string[]>()

  for (const edge of edges) {
    const existing = reverse.get(edge.target) ?? []
    existing.push(edge.source)
    reverse.set(edge.target, existing)
  }

  const visited = new Set<string>()
  const queue = [...outputIds]

  while (queue.length > 0) {
    const current = queue.shift()

    if (!current || visited.has(current)) {
      continue
    }

    visited.add(current)

    for (const previous of reverse.get(current) ?? []) {
      queue.push(previous)
    }
  }

  return visited
}
