import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Zap,
  Download,
  GitBranch,
  Package,
  RotateCcw,
  Check,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

// --- Types ---

type StepName = 'fetch' | 'checkout' | 'install' | 'restart'
type StepStatus = 'pending' | 'in_progress' | 'done' | 'error'

interface UpdateStep {
  step: StepName
  status: StepStatus
  message: string
}

interface UpdateState {
  active: boolean
  version: string | null
  steps: UpdateStep[]
  error: string | null
}

// --- Step metadata ---

const STEP_META: Record<StepName, { label: string; icon: typeof Download }> = {
  fetch: { label: 'Fetch', icon: Download },
  checkout: { label: 'Checkout', icon: GitBranch },
  install: { label: 'Install', icon: Package },
  restart: { label: 'Restart', icon: RotateCcw },
}

const STEP_ORDER: StepName[] = ['fetch', 'checkout', 'install', 'restart']

// --- Helpers ---

function getStepStatus(steps: UpdateStep[], name: StepName): StepStatus {
  const step = steps.find((s) => s.step === name)
  return step?.status ?? 'pending'
}

function getCurrentMessage(steps: UpdateStep[]): string {
  const active = steps.find((s) => s.status === 'in_progress')
  if (active) return active.message
  const errored = steps.find((s) => s.status === 'error')
  if (errored) return errored.message
  const lastDone = [...steps].reverse().find((s) => s.status === 'done')
  if (lastDone) return lastDone.message
  return 'Preparing update...'
}

function allStepsDone(steps: UpdateStep[]): boolean {
  return STEP_ORDER.every((name) => getStepStatus(steps, name) === 'done')
}

function restartInProgress(steps: UpdateStep[]): boolean {
  return getStepStatus(steps, 'restart') === 'in_progress'
}

function hasError(steps: UpdateStep[]): boolean {
  return steps.some((s) => s.status === 'error')
}

// --- Component ---

export default function UpdatePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const versionParam = searchParams.get('version')

  const [state, setState] = useState<UpdateState>({
    active: true,
    version: versionParam,
    steps: STEP_ORDER.map((step) => ({ step, status: 'pending', message: '' })),
    error: null,
  })

  const [serverReady, setServerReady] = useState(false)
  const [countdown, setCountdown] = useState(3)
  const eventSourceRef = useRef<EventSource | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // --- SSE connection ---

  const connectSSE = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const es = new EventSource('/api/version/update/progress')
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const data: UpdateState = JSON.parse(event.data)
        setState(data)
      } catch {
        // Ignore malformed messages
      }
    }

    es.onerror = () => {
      // Connection lost — server may be restarting
      es.close()
    }
  }, [])

  useEffect(() => {
    connectSSE()
    return () => {
      eventSourceRef.current?.close()
    }
  }, [connectSSE])

  // --- Poll for server restart ---

  useEffect(() => {
    const shouldPoll = allStepsDone(state.steps) || restartInProgress(state.steps)
    if (!shouldPoll || serverReady) return

    pollRef.current = setInterval(async () => {
      try {
        await api.get('/version')
        setServerReady(true)
        if (pollRef.current) clearInterval(pollRef.current)
      } catch {
        // Server not ready yet
      }
    }, 2000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [state.steps, serverReady])

  // --- Countdown and redirect ---

  useEffect(() => {
    if (!serverReady) return

    setCountdown(3)
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          navigate('/')
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [serverReady, navigate])

  // --- Retry handler ---

  const handleRetry = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      error: null,
      steps: STEP_ORDER.map((step) => ({ step, status: 'pending', message: '' })),
    }))
    setServerReady(false)
    setCountdown(3)

    try {
      await api.post('/version/update', {})
    } catch {
      // Server might restart immediately, which is fine
    }

    connectSSE()
  }, [connectSSE])

  // --- Derived state ---

  const version = state.version || versionParam || 'latest'
  const errorState = hasError(state.steps)
  const errorMessage = state.error || state.steps.find((s) => s.status === 'error')?.message

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950">
      {/* Subtle radial glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(59,130,246,0.06)_0%,_transparent_70%)]" />

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center gap-12 px-6">
        {/* Branding */}
        <div className="flex items-center gap-2.5">
          <Zap className="h-7 w-7 text-yellow-500" fill="currentColor" />
          <span className="text-2xl font-bold tracking-tight text-zinc-100">
            UltraDev
          </span>
        </div>

        {/* Version heading */}
        <div className="text-center">
          <h1 className="text-xl font-semibold text-zinc-100">
            {serverReady ? 'Update complete!' : `Updating to ${version}`}
          </h1>
          {serverReady && (
            <p className="mt-2 text-sm text-zinc-400">
              Redirecting in {countdown}s...
            </p>
          )}
        </div>

        {/* Progress indicator */}
        <div className="flex w-full items-start justify-center gap-0">
          {STEP_ORDER.map((stepName, index) => {
            const status = getStepStatus(state.steps, stepName)
            const meta = STEP_META[stepName]
            const Icon = meta.icon
            const isLast = index === STEP_ORDER.length - 1

            // Determine the line color between this step and the next
            const nextStatus = !isLast
              ? getStepStatus(state.steps, STEP_ORDER[index + 1])
              : 'pending'

            let lineColor = 'bg-zinc-700'
            if (status === 'done' && nextStatus === 'done') {
              lineColor = 'bg-emerald-500'
            } else if (status === 'done' && nextStatus === 'in_progress') {
              lineColor = 'bg-blue-500'
            } else if (status === 'done') {
              lineColor = 'bg-emerald-500'
            }

            return (
              <div key={stepName} className="flex flex-1 items-start">
                {/* Step circle + label */}
                <div className="flex flex-col items-center gap-2.5">
                  <div
                    className={cn(
                      'flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all duration-500',
                      status === 'pending' &&
                        'border-zinc-700 bg-zinc-900 text-zinc-600',
                      status === 'in_progress' &&
                        'border-blue-500 bg-blue-500/10 text-blue-400',
                      status === 'done' &&
                        'border-emerald-500 bg-emerald-500/10 text-emerald-400',
                      status === 'error' &&
                        'border-red-500 bg-red-500/10 text-red-400'
                    )}
                  >
                    {status === 'done' ? (
                      <Check className="h-5 w-5" />
                    ) : status === 'error' ? (
                      <AlertCircle className="h-5 w-5" />
                    ) : (
                      <Icon
                        className={cn(
                          'h-5 w-5 transition-all duration-500',
                          status === 'in_progress' && 'animate-pulse'
                        )}
                      />
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-xs font-medium transition-colors duration-500',
                      status === 'pending' && 'text-zinc-600',
                      status === 'in_progress' && 'text-blue-400',
                      status === 'done' && 'text-emerald-400',
                      status === 'error' && 'text-red-400'
                    )}
                  >
                    {meta.label}
                  </span>
                </div>

                {/* Connecting line */}
                {!isLast && (
                  <div className="mt-[22px] flex flex-1 items-center px-2">
                    <div
                      className={cn(
                        'h-0.5 w-full rounded-full transition-all duration-500',
                        lineColor
                      )}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Status message */}
        <div className="min-h-[24px] text-center">
          {serverReady ? (
            <div className="flex items-center justify-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20">
                <Check className="h-4 w-4 text-emerald-400" />
              </div>
              <span className="text-sm text-emerald-400">
                Server is back online
              </span>
            </div>
          ) : errorState ? (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-red-400">{errorMessage}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetry}
                className="gap-2 border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry Update
              </Button>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">
              {getCurrentMessage(state.steps)}
            </p>
          )}
        </div>

        {/* Subtle footer hint */}
        <p className="text-xs text-zinc-700">
          Do not close this page during the update.
        </p>
      </div>
    </div>
  )
}
